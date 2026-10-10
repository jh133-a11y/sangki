begin;
create table if not exists public.soldier_characters (
  client_id uuid not null references public.soldier_profiles(client_id) on delete cascade,
  character text not null check (character in ('fsb-agent','roka-swc')),
  level integer not null default 1 check (level between 1 and 7),
  primary key (client_id,character)
);
alter table public.soldier_characters enable row level security;
revoke all on public.soldier_characters from anon,authenticated;
alter table public.soldier_profiles add column if not exists equipped_character text not null default 'black-water'
  check (equipped_character in ('black-water','fsb-agent','roka-swc'));

create or replace function public.soldier_shop_api(p_token uuid,p_action text default 'read',p_character text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  sess public.soldier_sessions%rowtype;
  profile public.soldier_profiles%rowtype;
begin
  -- Reuse the authoritative session/account verification.
  perform public.soldier_equipment_api(p_token);
  select * into sess from public.soldier_sessions where token=p_token;
  select * into profile from public.soldier_profiles where client_id=sess.client_id for update;
  if p_action is null or p_action not in ('read','buy','equip') then raise exception '상점 요청이 올바르지 않습니다.'; end if;
  if p_action in ('buy','equip') then
    if p_character is null or p_character not in ('black-water','fsb-agent','roka-swc') then raise exception '캐릭터가 올바르지 않습니다.'; end if;
    if p_action='buy' then
      if p_character='black-water' then raise exception '기본 캐릭터는 구매할 필요가 없습니다.'; end if;
      if exists(select 1 from public.soldier_characters where client_id=sess.client_id and character=p_character) then raise exception '이미 보유한 캐릭터입니다.'; end if;
      if (select count(*) from public.soldier_characters where client_id=sess.client_id)>=50 then raise exception '캐릭터 인벤토리는 최대 50개입니다.'; end if;
      if profile.gems<125 then raise exception '보석이 부족합니다. 필요한 보석: 125'; end if;
      insert into public.soldier_characters(client_id,character) values(sess.client_id,p_character);
      update public.soldier_profiles set gems=gems-125 where client_id=sess.client_id;
    else
      if p_character<>'black-water' and not exists(select 1 from public.soldier_characters where client_id=sess.client_id and character=p_character) then raise exception '보유하지 않은 캐릭터입니다.'; end if;
      update public.soldier_profiles set equipped_character=p_character where client_id=sess.client_id;
    end if;
  end if;
  select * into profile from public.soldier_profiles where client_id=sess.client_id;
  return jsonb_build_object('gold',profile.gold::text,'gems',profile.gems::text,
    'gold_exchange_version',1,
    'equipped',profile.equipped_character,'characters',coalesce((
      select jsonb_object_agg(character,jsonb_build_object('level',level)) from public.soldier_characters where client_id=sess.client_id
    ),'{}'::jsonb));
end $$;
revoke all on function public.soldier_shop_api(uuid,text,text) from public;
grant execute on function public.soldier_shop_api(uuid,text,text) to anon,authenticated;

create table if not exists public.soldier_gold_exchange_requests (
  client_id uuid not null references public.soldier_profiles(client_id) on delete cascade,
  request_id uuid not null,
  product text not null check (product in ('gold-5000','gold-30000','gold-65000')),
  gold_awarded bigint not null check (gold_awarded>0),
  created_at timestamptz not null default now(),
  primary key (client_id,request_id)
);
alter table public.soldier_gold_exchange_requests enable row level security;
revoke all on public.soldier_gold_exchange_requests from public,anon,authenticated;

create or replace function public.soldier_gold_exchange_api(
  p_token uuid,p_product text,p_request uuid
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid; profile public.soldier_profiles%rowtype;
  previous public.soldier_gold_exchange_requests%rowtype;
  gems_cost integer; gold_amount bigint; replayed boolean:=false;
begin
  perform public.soldier_equipment_api(p_token);
  select client_id into owner_id from public.soldier_sessions where token=p_token;
  select * into profile from public.soldier_profiles where client_id=owner_id for update;
  if p_product is null or p_product not in ('gold-5000','gold-30000','gold-65000') or p_request is null then
    raise exception '골드 교환 상품 정보가 올바르지 않습니다.';
  end if;
  select * into previous from public.soldier_gold_exchange_requests
    where client_id=owner_id and request_id=p_request;
  if found then
    if previous.product<>p_product then raise exception '같은 요청 번호가 다른 골드 상품에 사용되었습니다.'; end if;
    gold_amount:=previous.gold_awarded;
    replayed:=true;
  else
    gems_cost:=case p_product when 'gold-5000' then 10 when 'gold-30000' then 50 else 100 end;
    gold_amount:=case p_product when 'gold-5000' then 5000 when 'gold-30000' then 30000 else 65000 end;
    if profile.gems<gems_cost then raise exception '보석이 부족합니다. 필요한 보석: %',gems_cost; end if;
    update public.soldier_profiles set gems=gems-gems_cost,gold=gold+gold_amount where client_id=owner_id;
    insert into public.soldier_gold_exchange_requests(client_id,request_id,product,gold_awarded)
      values(owner_id,p_request,p_product,gold_amount);
  end if;
  select * into profile from public.soldier_profiles where client_id=owner_id;
  return jsonb_build_object('exchange_version',1,'client_id',owner_id,'product',p_product,
    'request',p_request,'replayed',replayed,'gold_awarded',gold_amount::text,
    'gold',profile.gold::text,'gems',profile.gems::text);
end $$;
revoke all on function public.soldier_gold_exchange_api(uuid,text,uuid) from public;
grant execute on function public.soldier_gold_exchange_api(uuid,text,uuid) to anon,authenticated;

create or replace function public.soldier_snapshot(p_room uuid,p_player uuid)
returns jsonb language sql security definer set search_path=public as $$
  select jsonb_build_object('room',jsonb_build_object('id',r.id,'name',r.name,'status',r.status,
    'host',r.host,'ends_at',r.ends_at,'server_time',clock_timestamp()),'self',p_player,
    'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'nickname',p.nickname,
      'x',p.x,'y',p.y,'z',p.z,'yaw',p.yaw,'pitch',p.pitch,'crouch',p.crouch,'hp',p.hp,
      'kills',p.kills,'deaths',p.deaths,'weapon',p.loadout->>p.slot,'last_shot',p.last_shot,
      'protected_until',p.protected_until,'respawn_at',p.respawn_at,
      'character',s.equipped_character))
      from public.soldier_players p join public.soldier_profiles s on s.client_id=p.client_id
      where p.room_id=r.id and p.last_seen>now()-interval '12 seconds'),'[]'::jsonb),
    'ammo',(select ammo from public.soldier_players where id=p_player),
    'reload_until',(select reload_until from public.soldier_players where id=p_player),
    'xp',(select s.xp from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player),
    'wins',(select s.wins from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player),
    'gold',(select s.gold::text from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player),
    'gems',(select s.gems::text from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player),
    'home_version',2)
  from public.soldier_rooms r where r.id=p_room
$$;
revoke all on function public.soldier_snapshot(uuid,uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
