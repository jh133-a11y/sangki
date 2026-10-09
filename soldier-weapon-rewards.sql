-- Run after soldier-equipment-upgrade.sql, soldier-inventory-limit.sql and soldier-shop.sql.
begin;

create table if not exists public.soldier_weapon_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.soldier_profiles(client_id) on delete cascade,
  weapon text not null check (weapon in ('k2','shotgun','stick')),
  grade text not null check (grade in ('D','C','B','A','S')),
  level integer not null default 1 check (level between 1 and 7),
  equipped boolean not null default false,
  source text not null check (length(source) between 1 and 120),
  reward_key text not null check (length(reward_key) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (client_id,reward_key)
);
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
    if p_weapon in ('k2','shotgun','stick') then
      raise exception '보상 무기는 아이템별 강화 요청을 사용해야 합니다. 사이트를 새로고침하세요.';
    end if;
    if public.soldier_weapon(p_weapon) is null then raise exception '무기가 올바르지 않습니다.'; end if;
    if p_level is null or p_level not between 1 and 6 then raise exception '강화 레벨이 올바르지 않습니다.'; end if;
    insert into public.soldier_equipment(client_id,weapon) values(sess.client_id,p_weapon) on conflict do nothing;
    select * into item from public.soldier_equipment where client_id=sess.client_id and weapon=p_weapon for update;
    if item.level<>p_level then raise exception '무기 레벨이 변경되었습니다. 장비를 새로 불러오세요.'; end if;
    base:=case item.grade when 'D' then 1000 when 'C' then 3000 when 'B' then 5000 when 'A' then 10000 when 'S' then 20000 end;
    increment:=case item.grade when 'D' then 1000 when 'C' then 1000 when 'B' then 2000 when 'A' then 5000 when 'S' then 10000 end;
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
  if p_client is null or p_weapon is null or p_weapon not in ('k2','shotgun','stick')
    or p_grade is null or p_grade not in ('D','C','B','A','S')
    or p_source is null or length(p_source) not between 1 and 120
    or p_reward_key is null or length(p_reward_key) not between 1 and 200 then
    raise exception '보상 지급 정보가 올바르지 않습니다.';
  end if;
  perform 1 from public.soldier_profiles where client_id=p_client for update;
  if not found then raise exception '솔져 프로필이 없습니다.'; end if;
  select * into previous from public.soldier_weapon_items
  where client_id=p_client and reward_key=p_reward_key;
  if found then
    if previous.weapon<>p_weapon or previous.grade<>p_grade or previous.source<>p_source then
      raise exception '동일 보상 키에 다른 지급 정보가 있습니다.';
    end if;
    return previous.id;
  end if;
  insert into public.soldier_weapon_items(client_id,weapon,grade,source,reward_key)
  values(p_client,p_weapon,p_grade,p_source,p_reward_key) returning id into granted;
  return granted;
end $$;
revoke all on function public.soldier_grant_weapon(uuid,text,text,text,text) from public,anon,authenticated;

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
    update public.soldier_weapon_items set equipped=false where client_id=owner_id and weapon=p_weapon;
  elsif p_action in ('equip','upgrade') then
    select * into item from public.soldier_weapon_items where id=p_item and client_id=owner_id for update;
    if not found then raise exception '보유하지 않은 무기입니다.'; end if;
    if p_action='equip' then
      update public.soldier_weapon_items set equipped=false where client_id=owner_id and weapon=item.weapon and equipped;
      update public.soldier_weapon_items set equipped=true where id=item.id;
    else
      if p_level is null or p_level not between 1 and 6 or item.level<>p_level then
        raise exception '강화 레벨이 변경되었거나 MAX입니다. 장비를 새로 불러오세요.';
      end if;
      base:=case item.grade when 'D' then 1000 when 'C' then 3000 when 'B' then 5000 when 'A' then 10000 when 'S' then 20000 end;
      increment:=case item.grade when 'D' then 1000 when 'C' then 1000 when 'B' then 2000 when 'A' then 5000 when 'S' then 10000 end;
      cost:=base+(item.level-1)*increment;
      if balance<cost then raise exception '솔져 골드가 부족합니다. 필요한 골드: %',cost; end if;
      update public.soldier_profiles set gold=gold-cost where client_id=owner_id;
      update public.soldier_weapon_items set level=level+1 where id=item.id;
      balance:=balance-cost;
    end if;
  end if;
  return jsonb_build_object('gold',balance::text,'items',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',id,'weapon',weapon,'grade',grade,'level',level,'equipped',equipped,'source',source
    ) order by created_at,id) from public.soldier_weapon_items where client_id=owner_id
  ),'[]'::jsonb));
end $$;
revoke all on function public.soldier_weapon_items_api(uuid,text,uuid,integer,text) from public;
grant execute on function public.soldier_weapon_items_api(uuid,text,uuid,integer,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
