-- Run after soldier-weapon-material-upgrade.sql. Initial odds are disclosed in the shop.
begin;
create table if not exists public.soldier_supply_purchases (
  client_id uuid not null references public.soldier_profiles(client_id) on delete cascade,
  request_id uuid not null,
  product text not null check (product in ('normal','advanced','special')),
  rewards jsonb not null,
  created_at timestamptz not null default now(),
  primary key (client_id,request_id)
);
alter table public.soldier_supply_purchases enable row level security;
revoke all on public.soldier_supply_purchases from public,anon,authenticated;

create or replace function public.soldier_supply_grade(p_product text,p_index integer,p_roll integer)
returns text language plpgsql immutable set search_path=public as $$
begin
  if p_product is null or p_product not in ('normal','advanced','special')
    or p_index is null or p_index<1 or p_index>(case when p_product='special' then 11 else 1 end)
    or p_roll is null or p_roll not between 0 and 9999 then
    raise exception '보급함 추첨 정보가 올바르지 않습니다.';
  end if;
  if p_product='special' and p_index=1 then
    return case when p_roll<9500 then 'A' else 'S' end;
  elsif p_product in ('advanced','special') then
    return case when p_roll<6000 then 'C' when p_roll<8500 then 'B' when p_roll<9500 then 'A' else 'S' end;
  else
    return case when p_roll<6000 then 'D' when p_roll<9000 then 'C' when p_roll<9600 then 'B' when p_roll<9900 then 'A' else 'S' end;
  end if;
end $$;
revoke all on function public.soldier_supply_grade(text,integer,integer) from public,anon,authenticated;

create or replace function public.soldier_supply_api(
  p_token uuid,p_product text default null,p_request uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid; balance bigint; cost integer; quantity integer; i integer;
  roll integer; weapon_id text; grade_id text; item_id uuid;
  rewards jsonb := '[]'::jsonb; replayed boolean := false; previous public.soldier_supply_purchases%rowtype;
begin
  perform public.soldier_equipment_api(p_token);
  select client_id into owner_id from public.soldier_sessions where token=p_token;
  select gems into balance from public.soldier_profiles where client_id=owner_id for update;
  if p_product is not null then
    if p_product not in ('normal','advanced','special') or p_request is null then
      raise exception '보급함 구매 정보가 올바르지 않습니다.';
    end if;
    select * into previous from public.soldier_supply_purchases
      where client_id=owner_id and request_id=p_request;
    if found then
      if previous.product<>p_product then raise exception '구매 요청 번호가 다른 보급함에 사용되었습니다.'; end if;
      rewards:=previous.rewards;
      replayed:=true;
    else
      cost:=case p_product when 'normal' then 3 when 'advanced' then 30 else 300 end;
      quantity:=case when p_product='special' then 11 else 1 end;
      if balance<cost then raise exception '보석이 부족합니다. 필요한 보석: %',cost; end if;
      for i in 1..quantity loop
        roll:=floor(random()*10000)::integer;
        grade_id:=public.soldier_supply_grade(p_product,i,roll);
        weapon_id:=(array['k2','shotgun','stick'])[1+floor(random()*3)::integer];
        -- The existing inventory trigger rejects overflow; the entire purchase rolls back.
        item_id:=public.soldier_grant_weapon(owner_id,weapon_id,grade_id,'supply-'||p_product,
          'supply-'||p_request::text||'-'||i::text);
        rewards:=rewards||jsonb_build_array(jsonb_build_object('id',item_id,'weapon',weapon_id,'grade',grade_id,'level',1));
      end loop;
      update public.soldier_profiles set gems=gems-cost where client_id=owner_id;
      insert into public.soldier_supply_purchases(client_id,request_id,product,rewards)
        values(owner_id,p_request,p_product,rewards);
    end if;
  elsif p_request is not null then
    raise exception '보급함 종류가 필요합니다.';
  end if;
  return jsonb_build_object('supply_version',1,'client_id',owner_id,'replayed',replayed,
    'gems',(select gems::text from public.soldier_profiles where client_id=owner_id),
    'product',p_product,'request',p_request,'rewards',rewards,
    'inventory',public.soldier_weapon_items_api(p_token));
end $$;
revoke all on function public.soldier_supply_api(uuid,text,uuid) from public;
grant execute on function public.soldier_supply_api(uuid,text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
