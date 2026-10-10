-- Run after the weapon SQL files. Repairs duplicate equipment without deleting items.
begin;
lock table public.soldier_weapon_items in share row exclusive mode;

with ranked as (
  select id,row_number() over (
    partition by client_id,public.soldier_weapon(weapon)->>'slot'
    order by (source='default'),created_at desc,id desc
  ) as position
  from public.soldier_weapon_items where equipped
)
update public.soldier_weapon_items set equipped=false
where id in (select id from ranked where position>1);

create unique index if not exists soldier_weapon_items_equipped_slot
  on public.soldier_weapon_items(client_id,(public.soldier_weapon(weapon)->>'slot')) where equipped;

create or replace function public.soldier_default_weapons(p_client uuid)
returns void language plpgsql security definer set search_path=public as $$
declare weapon_id text; item_id uuid;
begin
  perform 1 from public.soldier_profiles where client_id=p_client for update;
  foreach weapon_id in array array['k2','shotgun','stick'] loop
    item_id:=public.soldier_grant_weapon(p_client,weapon_id,'D','default','default-'||weapon_id);
    if not exists (
      select 1 from public.soldier_weapon_items where client_id=p_client and equipped
        and public.soldier_weapon(weapon)->>'slot'=public.soldier_weapon(weapon_id)->>'slot'
    ) then
      update public.soldier_weapon_items set equipped=true where id=item_id;
    end if;
  end loop;
end $$;
revoke all on function public.soldier_default_weapons(uuid) from public,anon,authenticated;

create or replace function public.soldier_equipped_slot_guard()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not new.equipped then return new; end if;
  perform 1 from public.soldier_profiles where client_id=new.client_id for update;
  update public.soldier_weapon_items set equipped=false
    where client_id=new.client_id and equipped and id<>new.id
      and public.soldier_weapon(weapon)->>'slot'=public.soldier_weapon(new.weapon)->>'slot';
  return new;
end $$;
revoke all on function public.soldier_equipped_slot_guard() from public,anon,authenticated;
drop trigger if exists soldier_equipped_slot_guard on public.soldier_weapon_items;
create trigger soldier_equipped_slot_guard before insert or update of equipped,weapon,client_id
on public.soldier_weapon_items for each row execute function public.soldier_equipped_slot_guard();
notify pgrst,'reload schema';
commit;
