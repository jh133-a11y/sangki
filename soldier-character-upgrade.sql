-- Run after soldier-shop.sql and soldier-weapon-rewards.sql.
begin;

alter table public.soldier_characters drop constraint if exists soldier_characters_level_check;
alter table public.soldier_characters add constraint soldier_characters_level_check check (level between 1 and 10);
alter table public.soldier_profiles add column if not exists default_character_level integer not null default 1
  check (default_character_level between 1 and 10);

-- The user explicitly requested removal of FSB records without swaps or refunds.
update public.soldier_profiles set equipped_character='black-water' where equipped_character='fsb-agent';
delete from public.soldier_characters where character='fsb-agent';
-- JAMES is now the free default. Keep any already-owned growth under the canonical default.
update public.soldier_profiles s set default_character_level=greatest(s.default_character_level,c.level)
from public.soldier_characters c where c.client_id=s.client_id and c.character='james';
update public.soldier_profiles set equipped_character='black-water' where equipped_character='james';
delete from public.soldier_characters where character='james';
alter table public.soldier_characters drop constraint if exists soldier_characters_character_check;
alter table public.soldier_characters add constraint soldier_characters_character_check
  check (character in ('fighter','thief','korean-girl','roka-swc'));
alter table public.soldier_profiles drop constraint if exists soldier_profiles_equipped_character_check;
alter table public.soldier_profiles add constraint soldier_profiles_equipped_character_check
  check (equipped_character in ('black-water','fighter','thief','korean-girl','roka-swc'));

create or replace function public.soldier_character_stats(p_character text,p_level integer)
returns jsonb language plpgsql immutable set search_path=public as $$
declare health integer; evasion numeric; damage_bonus integer:=0; critical_bonus integer:=0;
begin
  if p_character is null or p_character not in ('black-water','fighter','thief','korean-girl','roka-swc')
    or p_level is null or p_level not between 1 and 10 then
    raise exception '캐릭터 또는 레벨이 올바르지 않습니다.';
  end if;
  if p_character='roka-swc' then
    health:=125+(p_level-1)*8; evasion:=(40+p_level-1)::numeric/1000;
  elsif p_character='thief' then
    health:=98+(p_level-1)*5; evasion:=(20+p_level-1)::numeric/100;
  elsif p_character='fighter' then
    health:=115+(p_level-1)*6; evasion:=(60+p_level-1)::numeric/1000;
  elsif p_character='korean-girl' then
    health:=105+(p_level-1)*7; evasion:=(10+p_level-1)::numeric/100;
    -- MAX adds two to the level-one bonus of one.
    damage_bonus:=case when p_level=10 then 3 else 1 end;
    critical_bonus:=damage_bonus;
  else
    health:=110+(p_level-1)*5; evasion:=(40+p_level-1)::numeric/1000;
  end if;
  return jsonb_build_object('hp',health,'evasion',evasion,
    'damageBonus',damage_bonus,'criticalBonus',critical_bonus);
end $$;
revoke all on function public.soldier_character_stats(text,integer) from public,anon,authenticated;

create or replace function public.soldier_owned_character_stats(p_client uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare profile public.soldier_profiles%rowtype; owned_level integer;
begin
  select * into profile from public.soldier_profiles where client_id=p_client;
  if not found then raise exception '솔져 프로필이 없습니다.'; end if;
  if profile.equipped_character='black-water' then
    owned_level:=profile.default_character_level;
  else
    select level into owned_level from public.soldier_characters
    where client_id=p_client and character=profile.equipped_character;
    if not found then raise exception '장착 캐릭터의 보유 정보가 없습니다.'; end if;
  end if;
  return public.soldier_character_stats(profile.equipped_character,owned_level);
end $$;
revoke all on function public.soldier_owned_character_stats(uuid) from public,anon,authenticated;

create or replace function public.soldier_shop_api(p_token uuid,p_action text default 'read',p_character text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare sess public.soldier_sessions%rowtype; profile public.soldier_profiles%rowtype;
begin
  perform public.soldier_equipment_api(p_token);
  select * into sess from public.soldier_sessions where token=p_token;
  select * into profile from public.soldier_profiles where client_id=sess.client_id for update;
  if p_action is null or p_action not in ('read','buy','equip') then raise exception '상점 요청이 올바르지 않습니다.'; end if;
  if p_action in ('buy','equip') then
    if p_character is null or p_character not in ('black-water','fighter','thief','korean-girl','roka-swc') then raise exception '캐릭터가 올바르지 않습니다.'; end if;
    if exists (
      select 1 from public.soldier_players p join public.soldier_rooms r on r.id=p.room_id
      where p.client_id=sess.client_id and p.last_seen>clock_timestamp()-interval '12 seconds'
        and r.status in ('waiting','playing')
    ) then raise exception '방을 나간 후 캐릭터를 변경하세요.'; end if;
    if p_action='buy' then
      if p_character='black-water' then raise exception '기본 캐릭터는 구매할 필요가 없습니다.'; end if;
      if exists(select 1 from public.soldier_characters where client_id=sess.client_id and character=p_character) then raise exception '이미 보유한 캐릭터입니다.'; end if;
      if (select count(*) from public.soldier_characters where client_id=sess.client_id)+1>=50 then raise exception '캐릭터 인벤토리는 기본 캐릭터 포함 최대 50개입니다.'; end if;
      if profile.gems < (case p_character when 'korean-girl' then 250 when 'roka-swc' then 125 else 150 end) then
        raise exception '보석이 부족합니다. 필요한 보석: %',(case p_character when 'korean-girl' then 250 when 'roka-swc' then 125 else 150 end);
      end if;
      insert into public.soldier_characters(client_id,character) values(sess.client_id,p_character);
      update public.soldier_profiles
      set gems=gems-(case p_character when 'korean-girl' then 250 when 'roka-swc' then 125 else 150 end)
      where client_id=sess.client_id;
    else
      if p_character<>'black-water' and not exists(select 1 from public.soldier_characters where client_id=sess.client_id and character=p_character) then raise exception '보유하지 않은 캐릭터입니다.'; end if;
      update public.soldier_profiles set equipped_character=p_character where client_id=sess.client_id;
    end if;
  end if;
  select * into profile from public.soldier_profiles where client_id=sess.client_id;
  return jsonb_build_object('gold',profile.gold::text,'gems',profile.gems::text,
    'gold_exchange_version',1,
    'equipped',profile.equipped_character,'default_level',profile.default_character_level,'character_version',2,
    'characters',coalesce((
      select jsonb_object_agg(character,jsonb_build_object('level',level))
      from public.soldier_characters where client_id=sess.client_id
    ),'{}'::jsonb));
end $$;
revoke all on function public.soldier_shop_api(uuid,text,text) from public;
grant execute on function public.soldier_shop_api(uuid,text,text) to anon,authenticated;

create or replace function public.soldier_character_upgrade_api(p_token uuid,p_character text,p_level integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare owner_id uuid; current_level integer; balance bigint;
begin
  perform public.soldier_shop_api(p_token);
  select client_id into owner_id from public.soldier_sessions where token=p_token;
  select gold into balance from public.soldier_profiles where client_id=owner_id for update;
  if p_character is null or p_character not in ('black-water','fighter','thief','korean-girl','roka-swc')
    or p_level is null or p_level not between 1 and 9 then raise exception '캐릭터 강화 요청이 올바르지 않거나 MAX입니다.'; end if;
  if exists (
    select 1 from public.soldier_players p join public.soldier_rooms r on r.id=p.room_id
    where p.client_id=owner_id and p.last_seen>clock_timestamp()-interval '12 seconds'
      and r.status in ('waiting','playing')
  ) then raise exception '방을 나간 후 캐릭터를 강화하세요.'; end if;
  if p_character='black-water' then
    select default_character_level into current_level from public.soldier_profiles where client_id=owner_id;
  else
    select level into current_level from public.soldier_characters
    where client_id=owner_id and character=p_character for update;
    if not found then raise exception '보유하지 않은 캐릭터입니다.'; end if;
  end if;
  if current_level<>p_level then raise exception '캐릭터 레벨이 변경되었습니다. 새로 불러오세요.'; end if;
  if balance<10000 then raise exception '솔져 골드가 부족합니다. 필요한 골드: 10000'; end if;
  update public.soldier_profiles set gold=gold-10000 where client_id=owner_id;
  if p_character='black-water' then
    update public.soldier_profiles set default_character_level=default_character_level+1 where client_id=owner_id;
  else
    update public.soldier_characters set level=level+1 where client_id=owner_id and character=p_character;
  end if;
  return public.soldier_shop_api(p_token);
end $$;
revoke all on function public.soldier_character_upgrade_api(uuid,text,integer) from public;
grant execute on function public.soldier_character_upgrade_api(uuid,text,integer) to anon,authenticated;

alter table public.soldier_players add column if not exists character text not null default 'black-water'
  check (character in ('black-water','james','fighter','thief','korean-girl','roka-swc','fsb-agent'));
alter table public.soldier_players drop constraint if exists soldier_players_character_check;
alter table public.soldier_players add column if not exists character_level integer not null default 1 check (character_level between 1 and 10);
alter table public.soldier_players add column if not exists max_hp integer not null default 110 check (max_hp>0);
alter table public.soldier_players add column if not exists evasion numeric not null default .04 check (evasion between 0 and 1);
alter table public.soldier_players add column if not exists last_dodge timestamptz;
alter table public.soldier_players add column if not exists character_version integer not null default 0;

-- Initialize pre-migration players once without healing existing damage.
drop trigger if exists soldier_character_combat on public.soldier_players;
-- Do not heal or resurrect active FSB players while removing their retired ID.
update public.soldier_players p set
  character='black-water',character_level=s.default_character_level,
  max_hp=(public.soldier_character_stats('black-water',s.default_character_level)->>'hp')::integer,
  evasion=(public.soldier_character_stats('black-water',s.default_character_level)->>'evasion')::numeric,
  hp=least(p.hp,(public.soldier_character_stats('black-water',s.default_character_level)->>'hp')::integer),
  character_version=2
from public.soldier_profiles s
where p.client_id=s.client_id and p.character in ('fsb-agent','james');
alter table public.soldier_players add constraint soldier_players_character_check
  check (character in ('black-water','fighter','thief','korean-girl','roka-swc'));
update public.soldier_players p set
  character=s.equipped_character,
  character_level=case when s.equipped_character='black-water' then s.default_character_level else coalesce(c.level,1) end,
  max_hp=(public.soldier_character_stats(s.equipped_character,
    case when s.equipped_character='black-water' then s.default_character_level else coalesce(c.level,1) end)->>'hp')::integer,
  evasion=(public.soldier_character_stats(s.equipped_character,
    case when s.equipped_character='black-water' then s.default_character_level else coalesce(c.level,1) end)->>'evasion')::numeric,
  character_version=2
from public.soldier_profiles s left join public.soldier_characters c
  on c.client_id=s.client_id and c.character=s.equipped_character
where p.client_id=s.client_id and p.character_version=0;
update public.soldier_players set hp=least(hp,max_hp) where hp>max_hp;

-- Capture server-owned stats once on room entry. No mid-match healing from upgrades/equipment changes.
create or replace function public.soldier_character_combat()
returns trigger language plpgsql security definer set search_path=public as $$
declare profile public.soldier_profiles%rowtype; stats jsonb;
begin
  if tg_op='INSERT' then
    select * into profile from public.soldier_profiles where client_id=new.client_id;
    if not found then raise exception '솔져 프로필이 없습니다.'; end if;
    new.character:=profile.equipped_character;
    if new.character='black-water' then new.character_level:=profile.default_character_level;
    else
      select level into new.character_level from public.soldier_characters
      where client_id=new.client_id and character=new.character;
      if not found then raise exception '장착 캐릭터의 보유 정보가 없습니다.'; end if;
    end if;
    stats:=public.soldier_character_stats(new.character,new.character_level);
    new.max_hp:=(stats->>'hp')::integer; new.evasion:=(stats->>'evasion')::numeric;
    new.hp:=new.max_hp;
    new.character_version:=2;
  elsif old.hp<=0 and new.hp>0 then
    new.hp:=old.max_hp;
  elsif old.hp>0 and new.hp<old.hp and random()<old.evasion then
    new.hp:=old.hp; new.last_dodge:=clock_timestamp();
  end if;
  return new;
end $$;
revoke all on function public.soldier_character_combat() from public,anon,authenticated;
drop trigger if exists soldier_character_combat on public.soldier_players;
create trigger soldier_character_combat before insert or update of hp on public.soldier_players
for each row execute function public.soldier_character_combat();

create or replace function public.soldier_snapshot(p_room uuid,p_player uuid)
returns jsonb language sql security definer set search_path=public as $$
  select jsonb_build_object('room',jsonb_build_object('id',r.id,'name',r.name,'status',r.status,
    'host',r.host,'ends_at',r.ends_at,'server_time',clock_timestamp()),'self',p_player,
    'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'nickname',p.nickname,
      'x',p.x,'y',p.y,'z',p.z,'yaw',p.yaw,'pitch',p.pitch,'crouch',p.crouch,'hp',p.hp,
      'kills',p.kills,'deaths',p.deaths,'weapon',p.loadout->>p.slot,'last_shot',p.last_shot,
      'protected_until',p.protected_until,'respawn_at',p.respawn_at,
      'character',p.character,'character_level',p.character_level,'max_hp',p.max_hp,'evasion',p.evasion,'last_dodge',p.last_dodge))
      from public.soldier_players p where p.room_id=r.id and p.last_seen>now()-interval '12 seconds'),'[]'::jsonb),
    'ammo',(select ammo from public.soldier_players where id=p_player),
    'reload_until',(select reload_until from public.soldier_players where id=p_player),
    'xp',(select s.xp from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player),
    'wins',(select s.wins from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player),
    'gold',(select s.gold::text from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player),
    'gems',(select s.gems::text from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player),
    'home_version',2,'character_version',2)
  from public.soldier_rooms r where r.id=p_room
$$;
revoke all on function public.soldier_snapshot(uuid,uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
