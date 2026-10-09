-- Run after soldier-weapon-rewards.sql and soldier-character-upgrade.sql.
-- Each free default weapon is a real inventory item and consumes one of its category's 50 slots.
begin;

create or replace function public.soldier_default_weapons(p_client uuid)
returns void language plpgsql security definer set search_path=public as $$
declare weapon_id text; item_id uuid;
begin
  foreach weapon_id in array array['k2','shotgun','stick'] loop
    item_id:=public.soldier_grant_weapon(p_client,weapon_id,'D','default','default-'||weapon_id);
    if not exists (
      select 1 from public.soldier_weapon_items where client_id=p_client and weapon=weapon_id and equipped
    ) then
      update public.soldier_weapon_items set equipped=true where id=item_id;
    end if;
  end loop;
end $$;
revoke all on function public.soldier_default_weapons(uuid) from public,anon,authenticated;

create or replace function public.soldier_default_inventory()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.soldier_default_weapons(new.client_id);
  return new;
end $$;
revoke all on function public.soldier_default_inventory() from public,anon,authenticated;
drop trigger if exists soldier_default_inventory on public.soldier_profiles;
create trigger soldier_default_inventory after insert on public.soldier_profiles
for each row execute function public.soldier_default_inventory();

do $$
declare owner_id uuid;
begin
  for owner_id in select client_id from public.soldier_profiles order by client_id loop
    perform public.soldier_default_weapons(owner_id);
  end loop;
end $$;

create or replace function public.soldier_character_inventory_limit()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='UPDATE' then
    if new.client_id=old.client_id then return new; end if;
  end if;
  perform 1 from public.soldier_profiles where client_id=new.client_id for update;
  if exists (
    select 1 from public.soldier_characters where client_id=new.client_id and character=new.character
  ) then return new; end if;
  if (select count(*) from public.soldier_characters where client_id=new.client_id)+1>=50 then
    raise exception '캐릭터 인벤토리는 기본 캐릭터 포함 최대 50개입니다.';
  end if;
  return new;
end $$;
revoke all on function public.soldier_character_inventory_limit() from public,anon,authenticated;
drop trigger if exists soldier_character_inventory_limit on public.soldier_characters;
create trigger soldier_character_inventory_limit before insert or update of client_id
on public.soldier_characters for each row execute function public.soldier_character_inventory_limit();
notify pgrst,'reload schema';
commit;
