-- Run after soldier-supply.sql. All daily limits use midnight in Asia/Seoul.
begin;
create table if not exists public.soldier_daily_state (
  client_id uuid primary key references public.soldier_profiles(client_id) on delete cascade,
  roulette_day date,
  roulette_spins integer not null default 0 check(roulette_spins>=0),
  attendance_table integer check(attendance_table between 1 and 3),
  attendance_step integer not null default 0 check(attendance_step between 0 and 20),
  attendance_day date
);
create table if not exists public.soldier_mail (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.soldier_profiles(client_id) on delete cascade,
  source text not null check(source in ('roulette','attendance')),
  reward jsonb not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  weapons jsonb not null default '[]'::jsonb
);
create index if not exists soldier_mail_owner on public.soldier_mail(client_id,created_at desc);
create table if not exists public.soldier_daily_requests (
  client_id uuid not null references public.soldier_profiles(client_id) on delete cascade,
  request_id uuid not null,
  action text not null,
  argument text not null,
  result jsonb not null,
  primary key(client_id,request_id)
);
alter table public.soldier_daily_state enable row level security;
alter table public.soldier_mail enable row level security;
alter table public.soldier_daily_requests enable row level security;
revoke all on public.soldier_daily_state,public.soldier_mail,public.soldier_daily_requests from public,anon,authenticated;

create or replace function public.soldier_roulette_prizes()
returns jsonb language sql immutable set search_path=public as $$
select '[
 {"kind":"gems","amount":1,"weight":1500},{"kind":"gems","amount":3,"weight":1000},
 {"kind":"gems","amount":5,"weight":300},{"kind":"gems","amount":100,"weight":100},
 {"kind":"crate","product":"normal","amount":1,"weight":500},{"kind":"crate","product":"normal","amount":3,"weight":300},
 {"kind":"crate","product":"advanced","amount":1,"weight":300},{"kind":"crate","product":"advanced","amount":2,"weight":100},
 {"kind":"crate","product":"special","amount":1,"weight":10},{"kind":"crate","product":"special","amount":2,"weight":1},
 {"kind":"crate","product":"guaranteed-b","amount":1,"weight":50},{"kind":"crate","product":"guaranteed-a","amount":1,"weight":39},
 {"kind":"gold","amount":1000,"weight":1500},{"kind":"gold","amount":3000,"weight":1000},
 {"kind":"gold","amount":10000,"weight":300},{"kind":"xp","amount":200,"weight":2000},{"kind":"xp","amount":1000,"weight":1000}
]'::jsonb $$;
create or replace function public.soldier_roulette_reward(p_roll integer)
returns jsonb language plpgsql immutable set search_path=public as $$
declare prize jsonb; threshold integer:=0; prize_index integer:=0;
begin
  if p_roll is null or p_roll not between 0 and 9999 then raise exception '룰렛 추첨 정보가 올바르지 않습니다.'; end if;
  for prize in select value from jsonb_array_elements(public.soldier_roulette_prizes()) loop
    threshold:=threshold+(prize->>'weight')::integer;
    if p_roll<threshold then return (prize-'weight')||jsonb_build_object('index',prize_index); end if;
    prize_index:=prize_index+1;
  end loop;
  raise exception '룰렛 확률 합계가 올바르지 않습니다.';
end $$;
create or replace function public.soldier_attendance_reward(p_table integer,p_step integer)
returns jsonb language plpgsql immutable set search_path=public as $$
declare rewards jsonb; entry jsonb;
begin
  if p_table is null or p_table not between 1 and 3 or p_step is null or p_step not between 1 and 20 then
    raise exception '출석 보상 정보가 올바르지 않습니다.';
  end if;
  rewards:=case p_table
    when 1 then '[["gems",5],["gold",1000],["xp",200],["gems",3],["gold",2000],["crate",1,"advanced"],["crate",1,"normal"],["gems",5],["gold",2000],["xp",200],["gems",3],["gold",1000],["crate",1,"advanced"],["gems",3],["gold",1000],["crate",1,"advanced"],["gems",3],["gems",5],["gems",10],["crate",1,"guaranteed-b"]]'::jsonb
    when 2 then '[["gold",2000],["gold",2000],["crate",1,"normal"],["gems",1],["xp",200],["xp",300],["gold",1000],["gold",2000],["crate",1,"advanced"],["xp",200],["gold",1000],["gold",2000],["gems",1],["gold",1000],["xp",200],["gems",3],["xp",200],["gold",1000],["gems",1],["crate",1,"special"]]'::jsonb
    else '[["crate",1,"normal"],["xp",200],["xp",200],["xp",200],["crate",1,"advanced"],["gems",1],["xp",200],["gold",1000],["xp",200],["gems",3],["gold",1000],["xp",200],["xp",300],["xp",200],["gold",2000],["gems",1],["crate",1,"advanced"],["crate",2,"advanced"],["crate",3,"advanced"],["crate",1,"guaranteed-a"]]'::jsonb end;
  entry:=rewards->(p_step-1);
  return jsonb_build_object('kind',entry->>0,'amount',(entry->>1)::integer)
    ||case when entry->>0='crate' then jsonb_build_object('product',entry->>2) else '{}'::jsonb end;
end $$;
revoke all on function public.soldier_roulette_prizes(),public.soldier_roulette_reward(integer),public.soldier_attendance_reward(integer,integer) from public,anon,authenticated;

create or replace function public.soldier_daily_api(
  p_token uuid,p_action text default 'read',p_request uuid default null,p_table integer default null,p_mail uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare owner_id uuid; today date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;
  state public.soldier_daily_state%rowtype; profile public.soldier_profiles%rowtype;
  receipt public.soldier_daily_requests%rowtype; mail public.soldier_mail%rowtype;
  argument text:=coalesce(p_table::text,'')||':'||coalesce(p_mail::text,'');
  outcome jsonb:='{}'::jsonb; reward jsonb; mail_id uuid; cost integer; i integer;
  granted_weapons jsonb:='[]'::jsonb; replayed boolean:=false;
begin
  perform public.soldier_equipment_api(p_token);
  select client_id into owner_id from public.soldier_sessions where token=p_token;
  select * into profile from public.soldier_profiles where client_id=owner_id for update;
  if p_action is null or p_action not in ('read','spin','select','attendance','claim')
    or (p_action='read' and (p_request is not null or p_table is not null or p_mail is not null))
    or (p_action<>'read' and p_request is null)
    or (p_action not in ('select','attendance') and p_table is not null)
    or (p_action<>'claim' and p_mail is not null) then raise exception '보상 요청이 올바르지 않습니다.'; end if;
  if p_action<>'read' and exists(select 1 from public.soldier_players where client_id=owner_id and last_seen>now()-interval '12 seconds') then
    raise exception '대기실 또는 경기 중에는 보상을 받을 수 없습니다.';
  end if;
  insert into public.soldier_daily_state(client_id) values(owner_id) on conflict do nothing;
  select * into state from public.soldier_daily_state where client_id=owner_id for update;
  if p_action<>'read' then
    select * into receipt from public.soldier_daily_requests where client_id=owner_id and request_id=p_request;
    if found then
      if receipt.action<>p_action or receipt.argument<>argument then raise exception '같은 요청 번호에 다른 보상 요청이 있습니다.'; end if;
      outcome:=receipt.result;replayed:=true;
    else
      if p_action='spin' then
        if state.roulette_day is distinct from today then state.roulette_spins:=0; end if;
        cost:=case when state.roulette_spins<3 then 0 else 3 end;
        if profile.gems<cost then raise exception '보석이 부족합니다. 필요한 보석: %',cost; end if;
        reward:=public.soldier_roulette_reward(floor(random()*10000)::integer);
        insert into public.soldier_mail(client_id,source,reward) values(owner_id,'roulette',reward) returning id into mail_id;
        update public.soldier_profiles set gems=gems-cost where client_id=owner_id;
        update public.soldier_daily_state set roulette_day=today,roulette_spins=state.roulette_spins+1 where client_id=owner_id;
        outcome:=jsonb_build_object('reward',reward,'mail_id',mail_id,'cost',cost);
      elsif p_action in ('select','attendance') then
        if state.attendance_day=today then raise exception '오늘 출석 보상을 이미 받았습니다. 한국 시간 자정 이후에 다시 방문하세요.'; end if;
        if state.attendance_table is null or state.attendance_step=20 then
          if p_table is null or p_table not between 1 and 3 then raise exception '출석 보상표를 선택하세요.'; end if;
          state.attendance_table:=p_table;state.attendance_step:=0;
        elsif p_table is not null and p_table<>state.attendance_table then
          raise exception '20개 보상을 모두 받을 때까지 출석 보상표를 변경할 수 없습니다.';
        end if;
        if p_action='attendance' then
          reward:=public.soldier_attendance_reward(state.attendance_table,state.attendance_step+1);
          insert into public.soldier_mail(client_id,source,reward) values(owner_id,'attendance',reward) returning id into mail_id;
          state.attendance_step:=state.attendance_step+1;state.attendance_day:=today;
          outcome:=jsonb_build_object('reward',reward,'mail_id',mail_id);
        end if;
        update public.soldier_daily_state set attendance_table=state.attendance_table,
          attendance_step=state.attendance_step,attendance_day=state.attendance_day where client_id=owner_id;
      elsif p_action='claim' then
        if p_mail is null then raise exception '받을 우편을 선택하세요.'; end if;
        select * into mail from public.soldier_mail where id=p_mail and client_id=owner_id for update;
        if not found then raise exception '보유한 우편을 찾을 수 없습니다.'; end if;
        if mail.claimed_at is not null then raise exception '이미 받은 우편입니다.'; end if;
        reward:=mail.reward;
        if reward->>'kind'='crate' then
          for i in 1..(reward->>'amount')::integer loop
            granted_weapons:=granted_weapons||public.soldier_grant_supply(owner_id,reward->>'product','mail-'||mail.id||'-'||i,'mail-'||mail.source);
          end loop;
        elsif reward->>'kind'='gold' then
          update public.soldier_profiles set gold=gold+(reward->>'amount')::bigint where client_id=owner_id;
        elsif reward->>'kind'='gems' then
          update public.soldier_profiles set gems=gems+(reward->>'amount')::bigint where client_id=owner_id;
        elsif reward->>'kind'='xp' then
          update public.soldier_profiles set xp=xp+(reward->>'amount')::bigint where client_id=owner_id;
        else raise exception '우편 보상 정보가 올바르지 않습니다.'; end if;
        update public.soldier_mail set claimed_at=clock_timestamp(),weapons=granted_weapons where id=mail.id;
        outcome:=jsonb_build_object('reward',reward,'mail_id',mail.id,'weapons',granted_weapons);
      end if;
      insert into public.soldier_daily_requests values(owner_id,p_request,p_action,argument,outcome);
    end if;
  end if;
  select * into state from public.soldier_daily_state where client_id=owner_id;
  select * into profile from public.soldier_profiles where client_id=owner_id;
  return jsonb_build_object('daily_version',1,'client_id',owner_id,'action',p_action,'request',p_request,'replayed',replayed,
    'today',today,'gems',profile.gems::text,'gold',profile.gold::text,'xp',profile.xp::text,
    'free_spins',greatest(0,3-case when state.roulette_day=today then state.roulette_spins else 0 end),
    'attendance_table',state.attendance_table,'attendance_step',state.attendance_step,
    'attendance_available',state.attendance_day is distinct from today,
    'can_select',state.attendance_day is distinct from today and (state.attendance_table is null or state.attendance_step=20),
    'mail',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'source',m.source,'reward',m.reward,'created_at',m.created_at,
      'claimed',m.claimed_at is not null) order by m.created_at desc,m.id) from public.soldier_mail m where m.client_id=owner_id),'[]'::jsonb),
    'outcome',outcome,'inventory',public.soldier_weapon_items_api(p_token));
end $$;
revoke all on function public.soldier_daily_api(uuid,text,uuid,integer,uuid) from public;
grant execute on function public.soldier_daily_api(uuid,text,uuid,integer,uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
