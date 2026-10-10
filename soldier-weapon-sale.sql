-- Run after soldier-weapon-rewards.sql. Unequipped weapons, including default D-grade items, sell for 100 gold.
begin;
create table if not exists public.soldier_weapon_sales (
  client_id uuid not null references public.soldier_profiles(client_id) on delete cascade,
  request_id uuid not null,
  item_id uuid,
  weapon text not null,
  gold_awarded bigint not null check (gold_awarded=100),
  created_at timestamptz not null default now(),
  primary key (client_id,request_id)
);
alter table public.soldier_weapon_sales enable row level security;
revoke all on public.soldier_weapon_sales from public,anon,authenticated;

create or replace function public.soldier_weapon_sell_api(
  p_token uuid,p_item uuid default null,p_weapon text default null,p_request uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid; balance bigint; item public.soldier_weapon_items%rowtype;
  previous public.soldier_weapon_sales%rowtype; sold_weapon text; replayed boolean:=false;
begin
  perform public.soldier_equipment_api(p_token);
  select client_id into owner_id from public.soldier_sessions where token=p_token;
  select gold into balance from public.soldier_profiles where client_id=owner_id for update;
  if p_request is null or (p_item is null)=(p_weapon is null) then
    raise exception '무기 판매 요청 정보가 올바르지 않습니다.';
  end if;
  select * into previous from public.soldier_weapon_sales
    where client_id=owner_id and request_id=p_request;
  if found then
    if previous.item_id is distinct from p_item
      or (p_item is null and previous.weapon<>p_weapon) then
      raise exception '같은 판매 요청 번호에 다른 무기를 지정했습니다.';
    end if;
    sold_weapon:=previous.weapon;
    replayed:=true;
  else
    if p_item is not null then
      select * into item from public.soldier_weapon_items
        where id=p_item and client_id=owner_id for update;
      if not found then raise exception '판매할 무기를 찾을 수 없습니다.'; end if;
      if item.equipped then raise exception '장착한 무기는 판매할 수 없습니다.'; end if;
      sold_weapon:=item.weapon;
      delete from public.soldier_weapon_items where id=item.id;
    else
      if public.soldier_weapon(p_weapon) is null
        or p_weapon in ('k2','shotgun','stick','psg1','m249','p90','auga3','g36c','akm') then
        raise exception '판매할 무기를 찾을 수 없습니다.';
      end if;
      if exists (
        select 1 from public.soldier_players p
        where p.client_id=owner_id and p.last_seen>now()-interval '12 seconds'
          and p.loadout ?| array['primary','secondary','melee']
          and (p.loadout->>'primary'=p_weapon or p.loadout->>'secondary'=p_weapon or p.loadout->>'melee'=p_weapon)
      ) then
        raise exception '현재 장착 중인 무기는 판매할 수 없습니다.';
      end if;
      delete from public.soldier_equipment
        where client_id=owner_id and weapon=p_weapon;
      if not found then raise exception '판매할 무기를 찾을 수 없습니다.'; end if;
      sold_weapon:=p_weapon;
    end if;
    update public.soldier_profiles set gold=gold+100 where client_id=owner_id returning gold into balance;
    insert into public.soldier_weapon_sales(client_id,request_id,item_id,weapon,gold_awarded)
      values(owner_id,p_request,p_item,sold_weapon,100);
  end if;
  if replayed then
    select gold into balance from public.soldier_profiles where client_id=owner_id;
  end if;
  return jsonb_build_object('sale_version',1,'client_id',owner_id,'request',p_request,
    'replayed',replayed,'item_id',p_item,'weapon',sold_weapon,'gold_awarded','100',
    'gold',balance::text,
    'equipment',public.soldier_equipment_api(p_token)->'equipment',
    'inventory',public.soldier_weapon_items_api(p_token));
end $$;
revoke all on function public.soldier_weapon_sell_api(uuid,uuid,text,uuid) from public;
grant execute on function public.soldier_weapon_sell_api(uuid,uuid,text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
