-- Run after soldier-default-inventory.sql. Preserves existing levels and currency.
begin;
alter table public.soldier_weapon_items
  add column if not exists upgrade_xp integer not null default 0;

create or replace function public.soldier_weapon_level_xp(p_grade text)
returns integer language sql immutable set search_path=public as $$
  select case p_grade when 'D' then 25 when 'C' then 50 when 'B' then 100
    when 'A' then 200 when 'S' then 400 end
$$;
revoke all on function public.soldier_weapon_level_xp(text) from public,anon,authenticated;
alter table public.soldier_weapon_items drop constraint if exists soldier_weapon_items_upgrade_xp_check;
alter table public.soldier_weapon_items add constraint soldier_weapon_items_upgrade_xp_check
  check (upgrade_xp>=0 and upgrade_xp<public.soldier_weapon_level_xp(grade)
    and (level<7 or upgrade_xp=0));

create table if not exists public.soldier_weapon_upgrade_requests (
  client_id uuid not null references public.soldier_profiles(client_id) on delete cascade,
  request_id uuid not null,
  item_id uuid not null,
  expected_level integer not null,
  expected_progress integer not null,
  materials uuid[] not null,
  primary key(client_id,request_id)
);
alter table public.soldier_weapon_upgrade_requests enable row level security;
revoke all on public.soldier_weapon_upgrade_requests from public,anon,authenticated;

create table if not exists public.soldier_admin_grants (
  client_id uuid not null references public.soldier_profiles(client_id) on delete cascade,
  grant_key text not null,
  created_at timestamptz not null default now(),
  primary key(client_id,grant_key)
);
alter table public.soldier_admin_grants enable row level security;
revoke all on public.soldier_admin_grants from public,anon,authenticated;

create or replace function public.soldier_weapon_items_api(
  p_token uuid,p_action text default 'read',p_item uuid default null,
  p_level integer default null,p_weapon text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare owner_id uuid; item public.soldier_weapon_items%rowtype; balance bigint;
begin
  perform public.soldier_equipment_api(p_token);
  select client_id into owner_id from public.soldier_sessions where token=p_token;
  select gold into balance from public.soldier_profiles where client_id=owner_id for update;
  if p_action='upgrade' then
    raise exception '골드만으로 강화할 수 없습니다. 강화재료를 선택하세요.';
  end if;
  if p_action is null or p_action not in ('read','equip','restore') then
    raise exception '장비 요청이 올바르지 않습니다.';
  end if;
  if p_action='restore' then
    select * into item from public.soldier_weapon_items
    where client_id=owner_id and weapon=p_weapon and source='default' for update;
    if not found then raise exception '기본 무기 보유 정보가 없습니다.'; end if;
  elsif p_action='equip' then
    select * into item from public.soldier_weapon_items where id=p_item and client_id=owner_id for update;
    if not found then raise exception '보유하지 않은 무기입니다.'; end if;
  end if;
  if p_action in ('equip','restore') then
    update public.soldier_weapon_items set equipped=false
    where client_id=owner_id and equipped
      and public.soldier_weapon(weapon)->>'slot'=public.soldier_weapon(item.weapon)->>'slot';
    update public.soldier_weapon_items set equipped=true where id=item.id;
  end if;
  return jsonb_build_object('gold',balance::text,'material_version',2,'material_rate',83,'items',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',id,'weapon',weapon,'grade',grade,'level',level,'equipped',equipped,
      'color',color,'source',source,'upgrade_xp',upgrade_xp,
      'upgrade_progress',round(upgrade_xp*100.0/public.soldier_weapon_level_xp(grade),1)
    ) order by created_at,id) from public.soldier_weapon_items where client_id=owner_id
  ),'[]'::jsonb));
end $$;
revoke all on function public.soldier_weapon_items_api(uuid,text,uuid,integer,text) from public;
grant execute on function public.soldier_weapon_items_api(uuid,text,uuid,integer,text) to anon,authenticated;

create or replace function public.soldier_weapon_material_api(
  p_token uuid,p_item uuid,p_materials uuid[],p_level integer,p_progress integer,p_request uuid
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid; item public.soldier_weapon_items%rowtype;
  previous public.soldier_weapon_upgrade_requests%rowtype;
  material_ids uuid[]; amount integer; valid integer; balance bigint; cost bigint;
  total_xp integer; added_xp integer; required_xp integer; next_level integer;
begin
  perform public.soldier_equipment_api(p_token);
  select client_id into owner_id from public.soldier_sessions where token=p_token;
  select gold into balance from public.soldier_profiles where client_id=owner_id for update;
  if p_request is null or p_item is null or p_level is null or p_progress is null
    or p_materials is null or cardinality(p_materials) not between 1 and 150
    or array_position(p_materials,null) is not null then
    raise exception '강화재료 요청이 올바르지 않습니다.';
  end if;
  select array_agg(id order by id) into material_ids from unnest(p_materials) id;
  amount:=cardinality(material_ids);
  if (select count(distinct id) from unnest(material_ids) id)<>amount then
    raise exception '같은 강화재료를 중복 선택할 수 없습니다.';
  end if;
  select * into previous from public.soldier_weapon_upgrade_requests
  where client_id=owner_id and request_id=p_request;
  if found then
    if previous.item_id<>p_item or previous.expected_level<>p_level
      or previous.expected_progress<>p_progress or previous.materials<>material_ids then
      raise exception '동일 요청에 다른 강화 정보가 있습니다.';
    end if;
    return public.soldier_weapon_items_api(p_token);
  end if;
  select * into item from public.soldier_weapon_items where id=p_item and client_id=owner_id for update;
  if not found then raise exception '보유하지 않은 무기입니다.'; end if;
  if item.level>=7 then raise exception 'MAX 무기는 강화할 수 없습니다.'; end if;
  if item.level<>p_level or item.upgrade_xp<>p_progress then
    raise exception '강화 정보가 변경되었습니다. 새로 불러오세요.';
  end if;
  perform 1 from public.soldier_weapon_items
  where client_id=owner_id and id=any(material_ids) order by id for update;
  select count(*),floor(coalesce(sum(public.soldier_weapon_level_xp(grade)*level+upgrade_xp),0)*0.83)::integer
  into valid,added_xp from public.soldier_weapon_items
  where client_id=owner_id and id=any(material_ids) and id<>p_item
    and not equipped and source<>'default';
  if valid<>amount then
    raise exception '본인 소유의 미장착 무기만 재료로 사용할 수 있습니다. 기본 무기는 보호됩니다.';
  end if;
  cost:=amount*(case item.grade when 'D' then 1000 when 'C' then 2000
    when 'B' then 4000 when 'A' then 8000 when 'S' then 16000 end);
  if balance<cost then raise exception '골드가 부족합니다. 필요한 골드: %',cost; end if;
  required_xp:=public.soldier_weapon_level_xp(item.grade);
  total_xp:=item.upgrade_xp+added_xp;
  next_level:=least(7,item.level+total_xp/required_xp);
  delete from public.soldier_weapon_items where client_id=owner_id and id=any(material_ids);
  update public.soldier_profiles set gold=gold-cost where client_id=owner_id;
  update public.soldier_weapon_items
  set level=next_level,upgrade_xp=case when next_level=7 then 0 else total_xp%required_xp end
  where id=p_item;
  insert into public.soldier_weapon_upgrade_requests
    (client_id,request_id,item_id,expected_level,expected_progress,materials)
  values(owner_id,p_request,p_item,p_level,p_progress,material_ids);
  return public.soldier_weapon_items_api(p_token);
end $$;
revoke all on function public.soldier_weapon_material_api(uuid,uuid,uuid[],integer,integer,uuid) from public;
grant execute on function public.soldier_weapon_material_api(uuid,uuid,uuid[],integer,integer,uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
