begin;

create or replace function public.soldier_inventory_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  category text;
begin
  category := public.soldier_weapon(new.weapon)->>'slot';
  if category is null then
    raise exception '무기 분류가 올바르지 않습니다.';
  end if;

  if tg_op = 'UPDATE' and new.client_id = old.client_id
     and category = public.soldier_weapon(old.weapon)->>'slot' then
    return new;
  end if;

  perform 1 from public.soldier_profiles
  where client_id = new.client_id for update;

  if exists (
    select 1 from public.soldier_equipment
    where client_id = new.client_id and weapon = new.weapon
  ) then
    return new;
  end if;

  if (select count(*) from public.soldier_equipment
      where client_id = new.client_id
        and public.soldier_weapon(weapon)->>'slot' = category) >= 50 then
    raise exception '해당 분류의 인벤토리가 가득 찼습니다. 분류별 최대 50개까지 보유할 수 있습니다.';
  end if;

  return new;
end;
$$;

revoke all on function public.soldier_inventory_limit() from public;
drop trigger if exists soldier_inventory_limit on public.soldier_equipment;
create trigger soldier_inventory_limit
before insert or update of client_id, weapon on public.soldier_equipment
for each row execute function public.soldier_inventory_limit();

commit;
