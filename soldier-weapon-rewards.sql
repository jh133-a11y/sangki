-- Run after soldier-equipment-upgrade.sql, soldier-inventory-limit.sql and soldier-shop.sql.
begin;

create table if not exists public.soldier_weapon_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.soldier_profiles(client_id) on delete cascade,
  weapon text not null check (weapon in ('k2','shotgun','stick','psg1','m249','p90','auga3','g36c','akm')),
  color text not null default 'standard',
  grade text not null check (grade in ('D','C','B','A','S','S+')),
  level integer not null default 1 check (level between 1 and 7),
  equipped boolean not null default false,
  source text not null check (length(source) between 1 and 120),
  reward_key text not null check (length(reward_key) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (client_id,reward_key)
);
alter table public.soldier_weapon_items drop constraint if exists soldier_weapon_items_grade_check;
alter table public.soldier_weapon_items add constraint soldier_weapon_items_grade_check
  check (grade in ('D','C','B','A','S','S+'));
alter table public.soldier_weapon_items drop constraint if exists soldier_weapon_items_weapon_check;
alter table public.soldier_weapon_items add constraint soldier_weapon_items_weapon_check
  check (weapon in ('k2','shotgun','stick','psg1','m249','p90','auga3','g36c','akm'));
alter table public.soldier_weapon_items add column if not exists color text not null default 'standard';
alter table public.soldier_weapon_items drop constraint if exists soldier_weapon_items_color_check;
alter table public.soldier_weapon_items add constraint soldier_weapon_items_color_check
  check (color in ('standard','gold','red','silver'));
create unique index if not exists soldier_weapon_items_equipped
  on public.soldier_weapon_items(client_id,weapon) where equipped;
alter table public.soldier_weapon_items enable row level security;
revoke all on public.soldier_weapon_items from public,anon,authenticated;

-- Move supported legacy records once; deleting the migrated rows frees their old slots.
insert into public.soldier_weapon_items(client_id,weapon,grade,level,source,reward_key,equipped)
select client_id,weapon,grade,level,'legacy','legacy-'||weapon,true
from public.soldier_equipment where weapon in ('k2','shotgun','stick')
on conflict (client_id,reward_key) do nothing;
delete from public.soldier_equipment where weapon in ('k2','shotgun','stick');

-- Keep legacy reads/other weapons, but prevent migrated weapons from being recreated.
create or replace function public.soldier_equipment_api(p_token uuid,p_weapon text default null,p_level integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  sess public.soldier_sessions%rowtype;
  item public.soldier_equipment%rowtype;
  balance bigint; cost bigint; base bigint; increment bigint;
begin
  select * into sess from public.soldier_sessions where token=p_token and expires_at>clock_timestamp();
  if sess.token is null then raise exception '솔져 세션이 만료되었습니다. 새로고침하세요.'; end if;
  if sess.account_token is not null then
    if not exists(select 1 from public.site_account_sessions where token=sess.account_token and account_id=sess.client_id and expires_at>clock_timestamp()) then raise exception '다시 로그인하세요.'; end if;
  elsif exists(select 1 from public.site_accounts where id=sess.client_id) then raise exception '투자 정보가 계정에 연결되었습니다. 로그인 후 다시 접속하세요.'; end if;
  select gold into balance from public.soldier_profiles where client_id=sess.client_id for update;
  if not found then raise exception '솔져 프로필이 없습니다.'; end if;
  if p_weapon is not null then
    if p_weapon in ('k2','shotgun','stick','psg1','m249','p90','auga3','g36c','akm') then
      raise exception '보상 무기는 아이템별 강화 요청을 사용해야 합니다. 사이트를 새로고침하세요.';
    end if;
    if public.soldier_weapon(p_weapon) is null then raise exception '무기가 올바르지 않습니다.'; end if;
    if p_level is null or p_level not between 1 and 6 then raise exception '강화 레벨이 올바르지 않습니다.'; end if;
    insert into public.soldier_equipment(client_id,weapon) values(sess.client_id,p_weapon) on conflict do nothing;
    select * into item from public.soldier_equipment where client_id=sess.client_id and weapon=p_weapon for update;
    if item.level<>p_level then raise exception '무기 레벨이 변경되었습니다. 장비를 새로 불러오세요.'; end if;
    base:=case item.grade when 'D' then 1000 when 'C' then 3000 when 'B' then 5000 when 'A' then 10000 when 'S' then 20000 when 'S+' then 40000 end;
    increment:=case item.grade when 'D' then 1000 when 'C' then 1000 when 'B' then 2000 when 'A' then 5000 when 'S' then 10000 when 'S+' then 20000 end;
    cost:=base+(item.level-1)*increment;
    if balance<cost then raise exception '솔져 골드가 부족합니다. 필요한 골드: %',cost; end if;
    update public.soldier_profiles set gold=gold-cost where client_id=sess.client_id;
    update public.soldier_equipment set level=level+1 where client_id=sess.client_id and weapon=p_weapon;
    balance:=balance-cost;
  elsif p_level is not null then raise exception '무기가 필요합니다.';
  end if;
  return jsonb_build_object('gold',balance::text,'equipment',coalesce((
    select jsonb_object_agg(weapon,jsonb_build_object('grade',grade,'level',level))
    from public.soldier_equipment where client_id=sess.client_id
  ),'{}'::jsonb));
end $$;
revoke all on function public.soldier_equipment_api(uuid,text,integer) from public;
grant execute on function public.soldier_equipment_api(uuid,text,integer) to anon,authenticated;

create or replace function public.soldier_inventory_limit()
returns trigger language plpgsql security definer set search_path=public as $$
declare category text; total integer;
begin
  category := public.soldier_weapon(new.weapon)->>'slot';
  if category is null then raise exception '무기 분류가 올바르지 않습니다.'; end if;
  if tg_op='UPDATE' then
    if new.client_id=old.client_id and category=public.soldier_weapon(old.weapon)->>'slot' then
      return new;
    end if;
  end if;
  perform 1 from public.soldier_profiles where client_id=new.client_id for update;
  if tg_table_name='soldier_equipment' and exists (
    select 1 from public.soldier_equipment where client_id=new.client_id and weapon=new.weapon
  ) then return new; end if;
  if tg_table_name='soldier_weapon_items' then
    if exists (
      select 1 from public.soldier_weapon_items where client_id=new.client_id and reward_key=new.reward_key
    ) then return new; end if;
  end if;
  select (
    select count(*) from public.soldier_equipment
    where client_id=new.client_id and public.soldier_weapon(weapon)->>'slot'=category
  ) + (
    select count(*) from public.soldier_weapon_items
    where client_id=new.client_id and public.soldier_weapon(weapon)->>'slot'=category
  ) into total;
  if total>=50 then
    raise exception '해당 분류의 인벤토리가 가득 찼습니다. 분류별 최대 50개까지 보유할 수 있습니다.';
  end if;
  return new;
end $$;
revoke all on function public.soldier_inventory_limit() from public,anon,authenticated;
drop trigger if exists soldier_weapon_items_limit on public.soldier_weapon_items;
create trigger soldier_weapon_items_limit before insert or update of client_id,weapon
on public.soldier_weapon_items for each row execute function public.soldier_inventory_limit();

-- Administrator/server only. The same reward key cannot issue the reward twice.
create or replace function public.soldier_grant_weapon(
  p_client uuid,p_weapon text,p_grade text,p_source text,p_reward_key text
)
returns uuid language plpgsql security definer set search_path=public as $$
declare granted uuid; previous public.soldier_weapon_items%rowtype;
begin
  if p_client is null or p_weapon is null or p_weapon not in ('k2','shotgun','stick','psg1','m249','p90','auga3','g36c','akm')
    or p_grade is null or p_grade not in ('D','C','B','A','S','S+')
    or p_source is null or length(p_source) not between 1 and 120
    or p_reward_key is null or length(p_reward_key) not between 1 and 200 then
    raise exception '보상 지급 정보가 올바르지 않습니다.';
  end if;
  perform 1 from public.soldier_profiles where client_id=p_client for update;
  if not found then raise exception '솔져 프로필이 없습니다.'; end if;
  select * into previous from public.soldier_weapon_items
  where client_id=p_client and reward_key=p_reward_key;
  if found then
    if previous.weapon<>p_weapon or previous.grade<>p_grade or previous.color<>'standard' or previous.source<>p_source then
      raise exception '동일 보상 키에 다른 지급 정보가 있습니다.';
    end if;
    return previous.id;
  end if;
  insert into public.soldier_weapon_items(client_id,weapon,grade,source,reward_key)
  values(p_client,p_weapon,p_grade,p_source,p_reward_key) returning id into granted;
  return granted;
end $$;
revoke all on function public.soldier_grant_weapon(uuid,text,text,text,text) from public,anon,authenticated;

create or replace function public.soldier_grant_colored_weapon(
  p_client uuid,p_weapon text,p_grade text,p_color text,p_source text,p_reward_key text
)
returns uuid language plpgsql security definer set search_path=public as $$
declare granted uuid; previous public.soldier_weapon_items%rowtype;
begin
  if p_client is null or p_weapon is null or p_weapon not in ('k2','shotgun','stick','psg1','m249','p90','auga3','g36c','akm')
    or p_grade is null or p_grade not in ('D','C','B','A','S','S+')
    or p_color is null or p_color not in ('standard','gold','red','silver')
    or p_source is null or length(p_source) not between 1 and 120
    or p_reward_key is null or length(p_reward_key) not between 1 and 200 then
    raise exception '보상 지급 정보가 올바르지 않습니다.';
  end if;
  perform 1 from public.soldier_profiles where client_id=p_client for update;
  if not found then raise exception '솔져 프로필이 없습니다.'; end if;
  select * into previous from public.soldier_weapon_items
    where client_id=p_client and reward_key=p_reward_key;
  if found then
    if previous.weapon<>p_weapon or previous.grade<>p_grade or previous.color<>p_color or previous.source<>p_source then
      raise exception '동일 보상 키에 다른 지급 정보가 있습니다.';
    end if;
    return previous.id;
  end if;
  insert into public.soldier_weapon_items(client_id,weapon,color,grade,source,reward_key)
    values(p_client,p_weapon,p_color,p_grade,p_source,p_reward_key) returning id into granted;
  return granted;
end $$;
revoke all on function public.soldier_grant_colored_weapon(uuid,text,text,text,text,text) from public,anon,authenticated;

create table if not exists public.soldier_weapon_operations (
  client_id uuid not null references public.soldier_profiles(client_id) on delete cascade,
  request_id uuid not null,
  action text not null check (action in ('combine','disassemble')),
  inputs jsonb not null,
  results jsonb not null,
  created_at timestamptz not null default now(),
  primary key(client_id,request_id)
);
alter table public.soldier_weapon_operations enable row level security;
revoke all on public.soldier_weapon_operations from public,anon,authenticated;

create or replace function public.soldier_weapon_operation_api(
  p_token uuid,p_action text,p_item uuid,p_other uuid default null,p_request uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid; balance bigint; cost integer; next_grade text; grade_id text;
  item_a public.soldier_weapon_items%rowtype; item_b public.soldier_weapon_items%rowtype;
  previous public.soldier_weapon_operations%rowtype; input_ids uuid[]; input_data jsonb;
  weapon_pool text[]:=array['k2','shotgun','stick','psg1','m249','p90','auga3','g36c','akm'];
  color_pool text[]:=array['standard','gold','red','silver'];
  eligible_weapons text[]; weapon_id text; color_id text; reward_id uuid;
  rewards jsonb:='[]'::jsonb; replayed boolean:=false; i integer; slot_name text; replacement_id uuid;
begin
  perform public.soldier_equipment_api(p_token);
  select client_id into owner_id from public.soldier_sessions where token=p_token;
  select gems into balance from public.soldier_profiles where client_id=owner_id for update;
  if p_request is null or p_item is null or p_action is null or p_action not in ('combine','disassemble')
    or (p_action='combine' and (p_other is null or p_other=p_item))
    or (p_action='disassemble' and p_other is not null) then
    raise exception '무기 조합·분해 요청이 올바르지 않습니다.';
  end if;
  if p_action='combine' then
    select array_agg(id order by id) into input_ids from unnest(array[p_item,p_other]) id;
  else input_ids:=array[p_item]; end if;
  input_data:=jsonb_build_object('items',to_jsonb(input_ids));
  select * into previous from public.soldier_weapon_operations
    where client_id=owner_id and request_id=p_request;
  if found then
    if previous.action<>p_action or previous.inputs<>input_data then
      raise exception '같은 요청 번호가 다른 무기 작업에 사용되었습니다.';
    end if;
    rewards:=previous.results; replayed:=true;
  else
    select * into item_a from public.soldier_weapon_items
      where id=p_item and client_id=owner_id for update;
    if not found then raise exception '보유하지 않은 무기입니다.'; end if;
    if (p_action='combine' and item_a.level<>7)
      or (p_action='disassemble' and (item_a.equipped or item_a.source='default')) then
      raise exception '조합은 MAX 무기만, 분해는 미장착 S/S+급 무기만 가능합니다.';
    end if;
    if p_action='combine' then
      select * into item_b from public.soldier_weapon_items
        where id=p_other and client_id=owner_id for update;
      if not found or item_b.level<>7
        or item_b.grade<>item_a.grade then
        raise exception '같은 등급의 MAX 무기 두 개가 필요합니다.';
      end if;
      cost:=case item_a.grade when 'D' then 5 when 'C' then 10 when 'B' then 20 when 'A' then 50 when 'S' then 100 end;
      if cost is null then raise exception 'S+급 무기는 조합할 수 없습니다.'; end if;
      if balance<cost then raise exception '보석이 부족합니다. 필요한 보석: %',cost; end if;
      next_grade:=case item_a.grade when 'D' then 'C' when 'C' then 'B' when 'B' then 'A' when 'A' then 'S' else 'S+' end;
      delete from public.soldier_weapon_items where id in (p_item,p_other);
      if item_a.weapon=item_b.weapon and item_a.color=item_b.color then
        weapon_id:=item_a.weapon; color_id:=item_a.color;
      elsif item_a.weapon=item_b.weapon then
        weapon_id:=item_a.weapon;
        color_id:=color_pool[1+floor(random()*array_length(color_pool,1))::integer];
      else
        select array_agg(candidate) into eligible_weapons
        from unnest(weapon_pool) candidate
        where (
          public.soldier_weapon(item_a.weapon)->>'slot'<>public.soldier_weapon(item_b.weapon)->>'slot'
          or public.soldier_weapon(candidate)->>'slot'=public.soldier_weapon(item_a.weapon)->>'slot'
        ) and (
          select count(*) from public.soldier_equipment e
          where e.client_id=owner_id and public.soldier_weapon(e.weapon)->>'slot'=public.soldier_weapon(candidate)->>'slot'
        ) + (
          select count(*) from public.soldier_weapon_items wi
          where wi.client_id=owner_id and public.soldier_weapon(wi.weapon)->>'slot'=public.soldier_weapon(candidate)->>'slot'
        ) < 50
        and not exists (
          select 1 from (values(item_a.weapon,item_a.equipped),(item_b.weapon,item_b.equipped)) input(weapon,equipped)
          where input.equipped
            and public.soldier_weapon(input.weapon)->>'slot'<>public.soldier_weapon(candidate)->>'slot'
            and not exists (
              select 1 from public.soldier_weapon_items remaining
              where remaining.client_id=owner_id
                and public.soldier_weapon(remaining.weapon)->>'slot'=public.soldier_weapon(input.weapon)->>'slot'
            )
        );
        if coalesce(array_length(eligible_weapons,1),0)=0 then
          raise exception '조합 결과를 받을 공간과 소모되는 장착 무기를 대체할 무기를 확보하세요.';
        end if;
        weapon_id:=eligible_weapons[1+floor(random()*array_length(eligible_weapons,1))::integer];
        color_id:=color_pool[1+floor(random()*array_length(color_pool,1))::integer];
      end if;
      update public.soldier_profiles set gems=gems-cost where client_id=owner_id;
      insert into public.soldier_weapon_items(client_id,weapon,color,grade,level,source,reward_key)
        values(owner_id,weapon_id,color_id,next_grade,1,'combine','operation-'||p_request::text||'-1')
        returning id into reward_id;
      if item_a.equipped or item_b.equipped then
        update public.soldier_weapon_items set equipped=false
          where client_id=owner_id and equipped
            and public.soldier_weapon(weapon)->>'slot'=public.soldier_weapon(weapon_id)->>'slot';
        update public.soldier_weapon_items set equipped=true where id=reward_id;
        for slot_name in
          select distinct public.soldier_weapon(input.weapon)->>'slot'
          from (values(item_a.weapon,item_a.equipped),(item_b.weapon,item_b.equipped)) input(weapon,equipped)
          where input.equipped
        loop
          if not exists (select 1 from public.soldier_weapon_items
            where client_id=owner_id and equipped and public.soldier_weapon(weapon)->>'slot'=slot_name) then
            select id into replacement_id from public.soldier_weapon_items
              where client_id=owner_id and public.soldier_weapon(weapon)->>'slot'=slot_name
              order by created_at,id limit 1;
            if replacement_id is not null then
              update public.soldier_weapon_items set equipped=true where id=replacement_id;
            else
              raise exception '조합 후 장착할 무기가 없습니다. 해당 분류의 다른 무기를 확보하세요.';
            end if;
          end if;
        end loop;
      end if;
      rewards:=jsonb_build_array(jsonb_build_object(
        'id',reward_id,'weapon',weapon_id,'color',color_id,'grade',next_grade,'level',1));
    else
      if item_a.grade not in ('S','S+') then raise exception 'S/S+급 무기만 분해할 수 있습니다.'; end if;
      grade_id:=case item_a.grade when 'S+' then 'S' else 'A' end;
      delete from public.soldier_weapon_items where id=p_item;
      for i in 1..2 loop
        select array_agg(candidate) into eligible_weapons
        from unnest(weapon_pool) candidate
        where public.soldier_weapon(candidate)->>'slot'=public.soldier_weapon(item_a.weapon)->>'slot'
        and (
          select count(*) from public.soldier_equipment e
          where e.client_id=owner_id and public.soldier_weapon(e.weapon)->>'slot'=public.soldier_weapon(candidate)->>'slot'
        ) + (
          select count(*) from public.soldier_weapon_items wi
          where wi.client_id=owner_id and public.soldier_weapon(wi.weapon)->>'slot'=public.soldier_weapon(candidate)->>'slot'
        ) < 50;
        if coalesce(array_length(eligible_weapons,1),0)=0 then
          raise exception '무기 분류별 인벤토리 공간을 확보한 뒤 다시 분해하세요.';
        end if;
        weapon_id:=eligible_weapons[1+floor(random()*array_length(eligible_weapons,1))::integer];
        color_id:=color_pool[1+floor(random()*array_length(color_pool,1))::integer];
        insert into public.soldier_weapon_items(client_id,weapon,color,grade,level,source,reward_key)
          values(owner_id,weapon_id,color_id,grade_id,1,'disassemble','operation-'||p_request::text||'-'||i::text)
          returning id into reward_id;
        rewards:=rewards||jsonb_build_array(jsonb_build_object(
          'id',reward_id,'weapon',weapon_id,'color',color_id,'grade',grade_id,'level',1));
      end loop;
    end if;
    insert into public.soldier_weapon_operations(client_id,request_id,action,inputs,results)
      values(owner_id,p_request,p_action,input_data,rewards);
  end if;
  return jsonb_build_object('operation_version',1,'client_id',owner_id,'operation',p_action,
    'request',p_request,'replayed',replayed,'gems',(select gems::text from public.soldier_profiles where client_id=owner_id),
    'results',rewards,'inventory',public.soldier_weapon_items_api(p_token));
end $$;
revoke all on function public.soldier_weapon_operation_api(uuid,text,uuid,uuid,uuid) from public;
grant execute on function public.soldier_weapon_operation_api(uuid,text,uuid,uuid,uuid) to anon,authenticated;

create or replace function public.soldier_weapon_items_api(
  p_token uuid,p_action text default 'read',p_item uuid default null,p_level integer default null,
  p_weapon text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid; item public.soldier_weapon_items%rowtype;
  balance bigint; cost bigint; base bigint; increment bigint;
begin
  perform public.soldier_equipment_api(p_token);
  select client_id into owner_id from public.soldier_sessions where token=p_token;
  select gold into balance from public.soldier_profiles where client_id=owner_id for update;
  if p_action is null or p_action not in ('read','equip','restore','upgrade') then
    raise exception '장비 요청이 올바르지 않습니다.';
  end if;
  if p_action='restore' then
    if p_weapon is null or p_weapon not in ('k2','shotgun','stick') then
      raise exception '기본 무기가 올바르지 않습니다.';
    end if;
    update public.soldier_weapon_items set equipped=false where client_id=owner_id and equipped
      and public.soldier_weapon(weapon)->>'slot'=public.soldier_weapon(p_weapon)->>'slot';
  elsif p_action in ('equip','upgrade') then
    select * into item from public.soldier_weapon_items where id=p_item and client_id=owner_id for update;
    if not found then raise exception '보유하지 않은 무기입니다.'; end if;
    if p_action='equip' then
      update public.soldier_weapon_items set equipped=false where client_id=owner_id and equipped
        and public.soldier_weapon(weapon)->>'slot'=public.soldier_weapon(item.weapon)->>'slot';
      update public.soldier_weapon_items set equipped=true where id=item.id;
    else
      if p_level is null or p_level not between 1 and 6 or item.level<>p_level then
        raise exception '강화 레벨이 변경되었거나 MAX입니다. 장비를 새로 불러오세요.';
      end if;
      base:=case item.grade when 'D' then 1000 when 'C' then 3000 when 'B' then 5000 when 'A' then 10000 when 'S' then 20000 when 'S+' then 40000 end;
      increment:=case item.grade when 'D' then 1000 when 'C' then 1000 when 'B' then 2000 when 'A' then 5000 when 'S' then 10000 when 'S+' then 20000 end;
      cost:=base+(item.level-1)*increment;
      if balance<cost then raise exception '솔져 골드가 부족합니다. 필요한 골드: %',cost; end if;
      update public.soldier_profiles set gold=gold-cost where client_id=owner_id;
      update public.soldier_weapon_items set level=level+1 where id=item.id;
      balance:=balance-cost;
    end if;
  end if;
  return jsonb_build_object('gold',balance::text,'items',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',id,'weapon',weapon,'color',color,'grade',grade,'level',level,'equipped',equipped,'source',source
    ) order by created_at,id) from public.soldier_weapon_items where client_id=owner_id
  ),'[]'::jsonb));
end $$;
revoke all on function public.soldier_weapon_items_api(uuid,text,uuid,integer,text) from public;
grant execute on function public.soldier_weapon_items_api(uuid,text,uuid,integer,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
