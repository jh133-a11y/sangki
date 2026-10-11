-- Run after the latest weapon rewards and material upgrade SQL.
begin;
create table if not exists public.soldier_weapon_enchantment_requests (
  client_id uuid not null references public.soldier_profiles(client_id) on delete cascade,
  request_id uuid not null,
  item_id uuid not null,
  previous_enchantment text,
  enchantment text not null,
  cost integer not null check(cost in (0,10)),
  primary key(client_id,request_id)
);
alter table public.soldier_weapon_enchantment_requests enable row level security;
revoke all on public.soldier_weapon_enchantment_requests from public,anon,authenticated;
create or replace function public.soldier_weapon_enchant_api(
  p_token uuid,p_item uuid,p_expected text,p_request uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare owner_id uuid; item public.soldier_weapon_items%rowtype;
  receipt public.soldier_weapon_enchantment_requests%rowtype; balance bigint; cost integer;
  choice text; replayed boolean:=false;
begin
  perform public.soldier_equipment_api(p_token);
  select client_id into owner_id from public.soldier_sessions where token=p_token;
  select gems into balance from public.soldier_profiles where client_id=owner_id for update;
  if p_item is null or p_request is null then raise exception '부여 요청이 올바르지 않습니다.'; end if;
  if exists(select 1 from public.soldier_players where client_id=owner_id and last_seen>now()-interval '12 seconds') then
    raise exception '대기실 또는 경기 중에는 부여할 수 없습니다.';
  end if;
  select * into receipt from public.soldier_weapon_enchantment_requests where client_id=owner_id and request_id=p_request;
  if found then
    if receipt.item_id<>p_item or receipt.previous_enchantment is distinct from p_expected then
      raise exception '같은 요청 번호에 다른 부여 요청이 있습니다.';
    end if;
    choice:=receipt.enchantment;cost:=receipt.cost;replayed:=true;
  else
    select * into item from public.soldier_weapon_items where id=p_item and client_id=owner_id for update;
    if not found then raise exception '보유한 무기를 찾을 수 없습니다.'; end if;
    if item.grade<>'S+' or item.level<>7 then raise exception 'S+ MAX 무기에만 부여할 수 있습니다.'; end if;
    if item.enchantment is distinct from p_expected then raise exception '부여 정보가 변경되었습니다. 새로고침하세요.'; end if;
    cost:=case when item.enchantment is null then 0 else 10 end;
    if balance<cost then raise exception '보석이 부족합니다. 필요한 보석: %',cost; end if;
    choice:=(array['damage-1','critical-2','weight-3','recoil-2','accuracy-2','damage-2','critical-3','weight-5','critical-1','accuracy-1'])[1+floor(random()*10)::integer];
    update public.soldier_weapon_items set enchantment=choice where id=item.id;
    update public.soldier_profiles set gems=gems-cost where client_id=owner_id;
    insert into public.soldier_weapon_enchantment_requests values(owner_id,p_request,p_item,p_expected,choice,cost);
  end if;
  return jsonb_build_object('enchant_version',1,'client_id',owner_id,'request',p_request,'item_id',p_item,
    'enchantment',choice,'cost',cost,'replayed',replayed,'gems',(select gems::text from public.soldier_profiles where client_id=owner_id),
    'inventory',public.soldier_weapon_items_api(p_token));
end $$;
revoke all on function public.soldier_weapon_enchant_api(uuid,uuid,text,uuid) from public;
grant execute on function public.soldier_weapon_enchant_api(uuid,uuid,text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
