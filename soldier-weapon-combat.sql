-- Run after soldier-weapon-material-upgrade.sql. Existing items/currency are preserved.
begin;
create or replace function public.soldier_weapon(p_name text)
returns jsonb language sql immutable set search_path=public as $$
  select case p_name
    when 'k2' then '{"damage":19,"delay":0.09230769230769231,"range":85,"magazine":30,"reserve":90,"accuracy":76,"recoilControl":86,"weight":4040,"critical":5,"reload":2,"slot":"primary"}'::jsonb
    when 'ak47' then '{"damage":30,"delay":0.2,"range":80,"magazine":30,"accuracy":68,"recoilControl":65,"weight":4100,"reload":2.3,"slot":"primary"}'::jsonb
    when 'aug64' then '{"damage":22,"delay":0.13,"range":85,"magazine":30,"accuracy":82,"recoilControl":82,"weight":3400,"reload":2,"slot":"primary"}'::jsonb
    when 'sniper' then '{"damage":100,"delay":1.3,"range":140,"magazine":5,"accuracy":100,"recoilControl":75,"weight":8100,"reload":2.8,"slot":"primary"}'::jsonb
    when 'psg1' then '{"damage":90,"delay":0.12,"range":140,"magazine":5,"reserve":15,"accuracy":100,"recoilControl":70,"weight":8100,"critical":1,"reload":2.8,"slot":"primary"}'::jsonb
    when 'm249' then '{"damage":68,"delay":0.1,"range":85,"magazine":100,"reserve":100,"accuracy":68,"recoilControl":86,"weight":9460,"critical":1,"reload":3,"slot":"primary"}'::jsonb
    when 'p90' then '{"damage":58,"delay":0.0967741935483871,"range":80,"magazine":50,"reserve":100,"accuracy":63,"recoilControl":72,"weight":3900,"critical":1,"reload":2,"slot":"primary"}'::jsonb
    when 'auga3' then '{"damage":40,"delay":0.0967741935483871,"range":85,"magazine":30,"reserve":90,"accuracy":78,"recoilControl":83,"weight":3800,"critical":14,"reload":2,"slot":"primary"}'::jsonb
    when 'g36c' then '{"damage":26,"delay":0.08571428571428572,"range":80,"magazine":30,"reserve":90,"accuracy":76,"recoilControl":86,"weight":3400,"critical":4,"reload":2,"slot":"primary"}'::jsonb
    when 'akm' then '{"damage":53,"delay":0.1,"range":80,"magazine":30,"reserve":90,"accuracy":74,"recoilControl":54,"weight":3950,"critical":12,"reload":2.3,"slot":"primary"}'::jsonb
    when 'pistol' then '{"damage":28,"delay":0.32,"range":55,"magazine":12,"accuracy":80,"recoilControl":75,"weight":900,"reload":1.5,"slot":"secondary"}'::jsonb
    when 'shotgun' then '{"damage":45,"delay":3,"range":22,"magazine":4,"reserve":16,"accuracy":61,"recoilControl":4,"weight":3550,"critical":6,"reload":2.4,"slot":"secondary"}'::jsonb
    when 'kukri' then '{"damage":45,"delay":0.55,"range":2.8,"magazine":0,"reload":0,"slot":"melee"}'::jsonb
    when 'axe' then '{"damage":65,"delay":0.85,"range":2.7,"magazine":0,"reload":0,"slot":"melee"}'::jsonb
    when 'shovel' then '{"damage":50,"delay":0.7,"range":3,"magazine":0,"reload":0,"slot":"melee"}'::jsonb
    when 'stick' then '{"damage":135,"delay":0.75,"range":3.2,"magazine":0,"accuracy":null,"recoilControl":null,"weight":null,"critical":31,"reload":0,"slot":"melee"}'::jsonb
    else null end
$$;
create or replace function public.soldier_weapon_stats(p_weapon text,p_grade text,p_level integer,p_color text)
returns jsonb language plpgsql immutable set search_path=public as $$
declare
  spec jsonb; offset_damage integer; per_level integer; offset_critical integer; per_two_levels integer;
  grade_steps integer; weight_factor numeric; stats jsonb;
begin
  spec:=public.soldier_weapon(p_weapon);
  if spec is null or p_grade is null or p_grade not in ('D','C','B','A','S','S+')
    or p_level is null or p_level not between 1 and 7
    or p_color is null or p_color not in ('standard','gold','red','silver') then
    raise exception '무기 등급과 레벨이 올바르지 않습니다.';
  end if;
  offset_damage:=case p_grade when 'D' then 0 when 'C' then 6 when 'B' then 12 when 'A' then 18 when 'S+' then 48 else 30 end;
  per_level:=case p_grade when 'A' then 2 when 'S' then 3 when 'S+' then 3 else 1 end;
  offset_critical:=case when p_grade='S' then 3 when p_grade='S+' then 9 else 0 end;
  per_two_levels:=case p_grade when 'A' then 1 when 'S' then 2 else 0 end;
  grade_steps:=case p_grade when 'D' then 0 when 'C' then 1 when 'B' then 2 when 'A' then 3 else 4 end;
  weight_factor:=case p_grade when 'D' then 1 when 'C' then 0.95 when 'B' then 0.9025
    when 'A' then 0.857375 else 0.81450625 end;
  stats:=spec||jsonb_build_object('weapon',p_weapon,'grade',p_grade,'level',p_level,'color',p_color,
    'damage',(spec->>'damage')::integer+offset_damage+(p_level-1)*per_level,
    'critical',coalesce((spec->>'critical')::integer,0)+offset_critical+
      case when p_grade='S+' then p_level-1 else ((p_level-1)/2)*per_two_levels end)
    ||case when spec->>'slot'='melee' then '{}'::jsonb else jsonb_build_object(
      'accuracy',(spec->>'accuracy')::integer+grade_steps*3,
      'recoilControl',(spec->>'recoilControl')::integer+grade_steps*3,
      'weight',round((spec->>'weight')::numeric*weight_factor)::integer
    ) end;
  if p_color='gold' then stats:=jsonb_set(stats,'{damage}',to_jsonb((stats->>'damage')::integer+5)); end if;
  if p_color='red' then stats:=jsonb_set(stats,'{critical}',to_jsonb((stats->>'critical')::integer+5)); end if;
  if p_color='silver' and stats->>'weight' is not null then
    stats:=jsonb_set(stats,'{weight}',to_jsonb(round((stats->>'weight')::numeric*0.9)::integer));
  end if;
  return stats;
end $$;
create or replace function public.soldier_weapon_stats(p_weapon text,p_grade text,p_level integer)
returns jsonb language sql immutable set search_path=public as $$
  select public.soldier_weapon_stats(p_weapon,p_grade,p_level,'standard')
$$;
create or replace function public.soldier_weapon_item_managed(p_weapon text)
returns boolean language sql immutable set search_path=public as $$
  select p_weapon in ('k2','shotgun','stick','psg1','m249','p90','auga3','g36c','akm')
$$;
create or replace function public.soldier_loadout_stats(p_client uuid,p_loadout jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare slot_name text; weapon_id text; item_grade text; item_level integer; item_color text;
  stats jsonb:='{}'; character_stats jsonb;
begin
  foreach slot_name in array array['primary','secondary','melee'] loop
    weapon_id:=p_loadout->>slot_name;
    item_color:='standard';
    if public.soldier_weapon_item_managed(weapon_id) then
      select grade,level,color into item_grade,item_level,item_color from public.soldier_weapon_items
      where client_id=p_client and weapon=weapon_id and equipped;
    else
      select grade,level into item_grade,item_level from public.soldier_equipment
      where client_id=p_client and weapon=weapon_id;
    end if;
    if not found then raise exception '장착 무기의 보유 정보를 확인할 수 없습니다.'; end if;
    stats:=jsonb_set(stats,array[slot_name],public.soldier_weapon_stats(weapon_id,item_grade,item_level,item_color));
  end loop;
  if stats->'primary'->>'color'=stats->'secondary'->>'color'
    and stats->'primary'->>'color'=stats->'melee'->>'color'
    and stats->'primary'->>'grade'=stats->'secondary'->>'grade'
    and stats->'primary'->>'grade'=stats->'melee'->>'grade' then
    foreach slot_name in array array['primary','secondary','melee'] loop
      if stats->slot_name->>'color'='gold' then
        stats:=jsonb_set(stats,array[slot_name,'damage'],to_jsonb((stats->slot_name->>'damage')::integer+3));
      elsif stats->slot_name->>'color'='red' then
        stats:=jsonb_set(stats,array[slot_name,'critical'],to_jsonb((stats->slot_name->>'critical')::integer+5));
      elsif stats->slot_name->>'color'='silver' and stats->slot_name->>'weight' is not null then
        stats:=jsonb_set(stats,array[slot_name,'weight'],to_jsonb(round((stats->slot_name->>'weight')::numeric*0.9)::integer));
      end if;
    end loop;
  end if;
  character_stats:=public.soldier_owned_character_stats(p_client);
  if character_stats->>'damageBonus' is null or character_stats->>'criticalBonus' is null then
    raise exception '캐릭터 무기 능력치 정보를 확인할 수 없습니다.';
  end if;
  foreach slot_name in array array['primary','secondary','melee'] loop
    stats:=jsonb_set(stats,array[slot_name,'damage'],to_jsonb(
      (stats->slot_name->>'damage')::integer+(character_stats->>'damageBonus')::integer));
    stats:=jsonb_set(stats,array[slot_name,'critical'],to_jsonb(
      (stats->slot_name->>'critical')::integer+(character_stats->>'criticalBonus')::integer));
  end loop;
  return stats;
end $$;
create or replace function public.soldier_initial_ammo(p_stats jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare slot_name text; spec jsonb; ammo jsonb:='{}';
begin
  foreach slot_name in array array['primary','secondary','melee'] loop
    spec:=p_stats->slot_name;
    ammo:=jsonb_set(ammo,array[slot_name],spec->'magazine');
    if spec ? 'reserve' then ammo:=jsonb_set(ammo,array[slot_name||'_reserve'],spec->'reserve'); end if;
  end loop;
  return ammo;
end $$;
create or replace function public.soldier_reload_ammo(p_ammo jsonb,p_slot text,p_spec jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare loaded integer; remaining integer; reserve_key text:=p_slot||'_reserve';
begin
  loaded:=greatest(0,(p_spec->>'magazine')::integer-(p_ammo->>p_slot)::integer);
  if p_spec ? 'reserve' then
    remaining:=(p_ammo->>reserve_key)::integer;
    if remaining is null or remaining<0 then raise exception '보유탄환 정보를 확인할 수 없습니다.'; end if;
    loaded:=least(loaded,remaining);
    p_ammo:=jsonb_set(p_ammo,array[reserve_key],to_jsonb(remaining-loaded));
  end if;
  return jsonb_set(p_ammo,array[p_slot],to_jsonb((p_ammo->>p_slot)::integer+loaded));
end $$;
alter table public.soldier_players add column if not exists weapon_stats jsonb not null default '{}';
create or replace function public.soldier_weapon_combat()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.weapon_stats:=public.soldier_loadout_stats(new.client_id,new.loadout);
  new.ammo:=public.soldier_initial_ammo(new.weapon_stats);
  return new;
end $$;
drop trigger if exists soldier_weapon_combat on public.soldier_players;
create trigger soldier_weapon_combat before insert on public.soldier_players
for each row execute function public.soldier_weapon_combat();
update public.soldier_players set weapon_stats=public.soldier_loadout_stats(client_id,loadout);
update public.soldier_players p set ammo=ammo||coalesce((
  select jsonb_object_agg(key,value)
  from jsonb_each(public.soldier_initial_ammo(p.weapon_stats)-'primary'-'secondary'-'melee')
  where not (p.ammo ? key)
),'{}'::jsonb);
update public.soldier_players set ammo=jsonb_set(jsonb_set(ammo,array['primary'],
  to_jsonb(least((ammo->>'primary')::integer,(weapon_stats->'primary'->>'magazine')::integer))),
  array['secondary'],to_jsonb(least((ammo->>'secondary')::integer,(weapon_stats->'secondary'->>'magazine')::integer)));

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
    'weapon_stats',(select weapon_stats from public.soldier_players where id=p_player),'weapon_version',1,
    'reload_until',(select reload_until from public.soldier_players where id=p_player),
    'xp',(select s.xp from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player),
    'wins',(select s.wins from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player),
    'gold',(select s.gold::text from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player),
    'gems',(select s.gems::text from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player),
    'home_version',2,'character_version',2)
  from public.soldier_rooms r where r.id=p_room
$$;

create or replace function public.soldier_api(p_token uuid,p_action text,p_room uuid default null,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  sess public.soldier_sessions%rowtype; me public.soldier_players%rowtype;
  enemy public.soldier_players%rowtype; room public.soldier_rooms%rowtype;
  uid uuid; rid uuid; pid uuid; nick text; item text; slot_name text; equipment jsonb; spec jsonb; mags jsonb:='{}';
  ts timestamptz:=clock_timestamp(); elapsed float8; nx float8; nz float8; dx float8; dz float8; py float8;
  aim_yaw float8; aim_pitch float8; ray_o float8[]; ray_d float8[]; b jsonb; cx float8; cz float8;
  wall float8:='Infinity'; dist float8; nearest float8; hit uuid; damage integer; count_players integer; i integer;
begin
  if p_action is null or p_action not in ('list','create','join','leave','start','state','move','reload','fire')
    or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception '요청 형식이 올바르지 않습니다.'; end if;
  select * into sess from public.soldier_sessions where token=p_token and expires_at>ts;
  if sess.token is null then raise exception '솔져 세션이 만료되었습니다. 새로고침하세요.'; end if;
  uid:=sess.client_id;
  if sess.account_token is not null then
    if not exists(select 1 from public.site_account_sessions where token=sess.account_token and account_id=uid and expires_at>ts) then raise exception '다시 로그인하세요.'; end if;
  elsif exists(select 1 from public.site_accounts where id=uid) then raise exception '투자 정보가 계정에 연결되었습니다. 로그인 후 다시 접속하세요.'; end if;
  if p_action='list' then
    return coalesce((select jsonb_agg(row_data) from (
      select jsonb_build_object('id',r.id,'name',r.name,'count',count(p.id)) row_data
      from public.soldier_rooms r join public.soldier_players p on p.room_id=r.id and p.last_seen>ts-interval '12 seconds'
      where r.status='waiting' group by r.id having count(p.id)<8 order by r.created_at desc limit 30
    ) q),'[]'::jsonb);
  end if;
  if p_action in ('create','join') then
    perform 1 from public.soldier_profiles where client_id=uid for update;
    if exists(select 1 from public.soldier_players where client_id=uid and last_seen>ts-interval '12 seconds') then raise exception '이미 방에 접속 중입니다. 기존 방을 나가거나 12초 후 다시 시도하세요.'; end if;
    equipment:=coalesce(p_data->'loadout','{"primary":"k2","secondary":"shotgun","melee":"stick"}'::jsonb);
    foreach slot_name in array array['primary','secondary','melee'] loop
      item:=equipment->>slot_name; spec:=public.soldier_weapon(item);
      if spec is null or spec->>'slot'<>slot_name then raise exception '무기 선택이 올바르지 않습니다.'; end if;
      mags:=jsonb_set(mags,array[slot_name],spec->'magazine');
    end loop;
    delete from public.soldier_players where client_id=uid;
    select nickname into nick from public.investment_users where client_id=uid;
    pid:=gen_random_uuid();
    if p_action='create' then
      item:=trim(p_data->>'name');
      if item is null or length(item) not between 1 and 30 then raise exception '방 이름은 1~30자입니다.'; end if;
      insert into public.soldier_rooms(name,host) values(item,pid) returning * into room;
    else
      select * into room from public.soldier_rooms where id=p_room for update;
      if room.id is null or room.status<>'waiting' then raise exception '참가 가능한 방이 아닙니다.'; end if;
    end if;
    delete from public.soldier_players where room_id=room.id and last_seen<ts-interval '12 seconds';
    select count(*) into count_players from public.soldier_players where room_id=room.id;
    if count_players>=8 then raise exception '방이 가득 찼습니다.'; end if;
    insert into public.soldier_players(id,client_id,session_token,room_id,nickname,loadout,ammo,x,z)
    values(pid,uid,p_token,room.id,nick,equipment,mags,
      (array[-42,42,-42,42,0,0,-43,43])[count_players+1],
      (array[-42,42,42,-42,-43,43,0,0])[count_players+1]);
    if not exists(select 1 from public.soldier_players where id=room.host) then
      update public.soldier_rooms set host=pid where id=room.id;
    end if;
    return public.soldier_snapshot(room.id,pid);
  end if;
  select room_id into rid from public.soldier_players where session_token=p_token and client_id=uid;
  if rid is null or rid is distinct from p_room then raise exception '참가한 방을 찾을 수 없습니다.'; end if;
  select * into room from public.soldier_rooms where id=rid for update;
  if room.id is null then raise exception '방이 종료되었습니다.'; end if;
  delete from public.soldier_players where room_id=rid and last_seen<ts-interval '12 seconds';
  select * into me from public.soldier_players where session_token=p_token and client_id=uid;
  if me.id is null then raise exception '접속이 끊겼습니다. 홈에서 다시 참가하세요.'; end if;
  update public.soldier_players set last_seen=ts where id=me.id;
  if p_action='leave' then
    delete from public.soldier_players where id=me.id;
    select id into pid from public.soldier_players where room_id=rid order by joined_at limit 1;
    if pid is null then delete from public.soldier_rooms where id=rid;
    elsif me.id=room.host then update public.soldier_rooms set host=pid where id=rid; end if;
    return '{"left":true}'::jsonb;
  end if;
  if not exists(select 1 from public.soldier_players where id=room.host) then
    select id into pid from public.soldier_players where room_id=rid order by joined_at limit 1;
    update public.soldier_rooms set host=pid where id=rid; room.host:=pid;
  end if;
  if p_action='start' then
    if me.id<>room.host or room.status<>'waiting' then raise exception '방장만 대기 중인 경기를 시작할 수 있습니다.'; end if;
    if (select count(*) from public.soldier_players where room_id=rid)<2 then raise exception '2명 이상 필요합니다.'; end if;
    update public.soldier_rooms set status='playing',ends_at=ts+interval '180 seconds' where id=rid;
    update public.soldier_players set protected_until=ts+interval '2 seconds',last_moved=ts where room_id=rid;
    return public.soldier_snapshot(rid,me.id);
  end if;
  if room.status='playing' and ts>=room.ends_at then
    update public.soldier_rooms set status='finished' where id=rid; room.status:='finished';
  end if;
  if p_action='state' or room.status<>'playing' then return public.soldier_snapshot(rid,me.id); end if;
  if me.hp<=0 and ts>=me.respawn_at then
    nx:=case when me.deaths%2=0 then -42 else 42 end; nz:=case when me.deaths%4<2 then -42 else 42 end;
    update public.soldier_players set hp=100,x=nx,z=nz,y=0,jump_at=null,respawn_at=null,
      protected_until=ts+interval '2 seconds',last_moved=ts,reload_until=null,reload_slot=null,
      ammo=public.soldier_initial_ammo(weapon_stats) where id=me.id;
    select * into me from public.soldier_players where id=me.id;
  end if;
  if me.hp<=0 then return public.soldier_snapshot(rid,me.id); end if;
  if me.reload_until is not null and ts>=me.reload_until then
    update public.soldier_players set ammo=public.soldier_reload_ammo(ammo,reload_slot,weapon_stats->reload_slot),
      reload_until=null,reload_slot=null where id=me.id;
    select * into me from public.soldier_players where id=me.id;
  end if;
  slot_name:=coalesce(p_data->>'slot',me.slot);
  if slot_name not in ('primary','secondary','melee') then raise exception '무기 칸이 올바르지 않습니다.'; end if;
  update public.soldier_players set slot=slot_name where id=me.id;
  if p_action='move' then
    nx:=coalesce((p_data->>'x')::float8,me.x); nz:=coalesce((p_data->>'z')::float8,me.z);
    aim_yaw:=coalesce((p_data->>'yaw')::float8,me.yaw); aim_pitch:=coalesce((p_data->>'pitch')::float8,me.pitch);
    if abs(nx)>48 or abs(nz)>48 or abs(aim_yaw)>100000 or abs(aim_pitch)>1.45 then raise exception '이동 값이 올바르지 않습니다.'; end if;
    elapsed:=least(1,greatest(0,extract(epoch from ts-me.last_moved)));
    dx:=nx-me.x; dz:=nz-me.z;
    if sqrt(dx*dx+dz*dz)>(case when me.crouch then 3 else 6 end)*elapsed+.25 then nx:=me.x; nz:=me.z; end if;
    for i in 1..10 loop
      if public.soldier_blocked(me.x+(nx-me.x)*i/10,me.z+(nz-me.z)*i/10) then nx:=me.x; nz:=me.z; exit; end if;
    end loop;
    if coalesce((p_data->>'jump')::boolean,false) and (me.jump_at is null or ts-me.jump_at>interval '1 second') then me.jump_at:=ts; end if;
    elapsed:=coalesce(extract(epoch from ts-me.jump_at),2);
    py:=case when elapsed<1 then greatest(0,5*elapsed-5*elapsed*elapsed) else 0 end;
    update public.soldier_players set x=nx,z=nz,y=py,jump_at=me.jump_at,yaw=aim_yaw,pitch=aim_pitch,
      crouch=coalesce((p_data->>'crouch')::boolean,false),last_moved=ts where id=me.id;
  elsif p_action='reload' then
    spec:=me.weapon_stats->slot_name;
    if slot_name<>'melee' and me.reload_until is null and (me.ammo->>slot_name)::integer<(spec->>'magazine')::integer
      and (not spec ? 'reserve' or (me.ammo->>(slot_name||'_reserve'))::integer>0) then
      update public.soldier_players set reload_slot=slot_name,reload_until=ts+(spec->>'reload')::float8*interval '1 second' where id=me.id;
    end if;
  elsif p_action='fire' then
    spec:=me.weapon_stats->slot_name;
    if ts<me.next_fire or me.reload_until is not null or (slot_name<>'melee' and (me.ammo->>slot_name)::int<=0) then
      return public.soldier_snapshot(rid,me.id);
    end if;
    aim_yaw:=coalesce((p_data->>'yaw')::float8,me.yaw); aim_pitch:=coalesce((p_data->>'pitch')::float8,me.pitch);
    if abs(aim_yaw)>100000 or abs(aim_pitch)>1.45 then raise exception '조준 값이 올바르지 않습니다.'; end if;
    update public.soldier_players set next_fire=ts+(spec->>'delay')::float8*interval '1 second',last_shot=ts,
      ammo=case when slot_name='melee' then ammo else jsonb_set(ammo,array[slot_name],to_jsonb((ammo->>slot_name)::int-1)) end,
      yaw=aim_yaw,pitch=aim_pitch where id=me.id;
    ray_o:=array[me.x,me.y+case when me.crouch then 1.1 else 1.65 end,me.z];
    ray_d:=array[-sin(aim_yaw)*cos(aim_pitch),sin(aim_pitch),-cos(aim_yaw)*cos(aim_pitch)];
    for b in select value from jsonb_array_elements(public.soldier_cover()) loop
      cx:=(b->>0)::float8; cz:=(b->>1)::float8;
      dist:=public.soldier_ray(ray_o,ray_d,array[cx-(b->>2)::float8/2,0,cz-(b->>3)::float8/2],
        array[cx+(b->>2)::float8/2,(b->>4)::float8,cz+(b->>3)::float8/2]);
      wall:=least(wall,dist);
    end loop;
    nearest:=least(wall,(spec->>'range')::float8);
    for enemy in select * from public.soldier_players where room_id=rid and id<>me.id and hp>0 and protected_until<ts loop
      dist:=public.soldier_ray(ray_o,ray_d,array[enemy.x-.45,enemy.y,enemy.z-.45],
        array[enemy.x+.45,enemy.y+case when enemy.crouch then 1.25 else 1.9 end,enemy.z+.45]);
      if dist<nearest then nearest:=dist; hit:=enemy.id; end if;
    end loop;
    if hit is not null then
      damage:=(spec->>'damage')::int;
      if random()<coalesce((spec->>'critical')::numeric,0)/100 then damage:=damage*2; end if;
      update public.soldier_players set hp=greatest(0,hp-damage) where id=hit returning * into enemy;
      if enemy.hp=0 then
        update public.soldier_players set deaths=deaths+1,respawn_at=ts+interval '3 seconds' where id=hit;
        update public.soldier_players set kills=kills+1 where id=me.id;
        update public.soldier_profiles set xp=xp+20 where client_id=uid;
      end if;
    end if;
  else raise exception '지원하지 않는 게임 요청입니다.';
  end if;
  return public.soldier_snapshot(rid,me.id);
end $$;
revoke all on function public.soldier_weapon(text),public.soldier_weapon_stats(text,text,integer),
  public.soldier_weapon_stats(text,text,integer,text),
  public.soldier_weapon_item_managed(text),
  public.soldier_loadout_stats(uuid,jsonb),public.soldier_initial_ammo(jsonb),
  public.soldier_reload_ammo(jsonb,text,jsonb),public.soldier_weapon_combat(),
  public.soldier_snapshot(uuid,uuid) from public,anon,authenticated;
revoke all on function public.soldier_api(uuid,text,uuid,jsonb) from public;
grant execute on function public.soldier_api(uuid,text,uuid,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
