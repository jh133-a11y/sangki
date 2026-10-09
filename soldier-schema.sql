-- Run after the site's investment/account schema. No Realtime publication is required.
begin;
create table if not exists public.soldier_profiles (
  client_id uuid primary key references public.investment_users(client_id) on delete cascade,
  xp bigint not null default 0 check (xp >= 0)
);
create table if not exists public.soldier_sessions (
  token uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.soldier_profiles(client_id) on delete cascade,
  account_token uuid,
  expires_at timestamptz not null default now() + interval '1 day'
);
create table if not exists public.soldier_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 30),
  host uuid not null,
  status text not null default 'waiting' check (status in ('waiting','playing','finished')),
  created_at timestamptz not null default now(),
  ends_at timestamptz
);
create table if not exists public.soldier_players (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.soldier_profiles(client_id) on delete cascade,
  session_token uuid not null references public.soldier_sessions(token) on delete cascade,
  room_id uuid not null references public.soldier_rooms(id) on delete cascade,
  nickname text not null,
  x double precision not null default -42, z double precision not null default -42,
  y double precision not null default 0, yaw double precision not null default 0, pitch double precision not null default 0,
  crouch boolean not null default false, hp integer not null default 100,
  kills integer not null default 0, deaths integer not null default 0,
  loadout jsonb not null, ammo jsonb not null default '{"primary":30,"secondary":12,"melee":0}',
  slot text not null default 'primary', reload_slot text, reload_until timestamptz,
  next_fire timestamptz not null default now(), last_shot timestamptz,
  respawn_at timestamptz, protected_until timestamptz not null default now(),
  jump_at timestamptz, last_moved timestamptz not null default now(),
  last_seen timestamptz not null default now(), joined_at timestamptz not null default now()
);
create index if not exists soldier_players_room_idx on public.soldier_players(room_id);
alter table public.soldier_profiles enable row level security;
alter table public.soldier_sessions enable row level security;
alter table public.soldier_rooms enable row level security;
alter table public.soldier_players enable row level security;
revoke all on public.soldier_profiles,public.soldier_sessions,public.soldier_rooms,public.soldier_players from anon,authenticated;

create or replace function public.soldier_weapon(p_name text)
returns jsonb language sql immutable set search_path=public as $$
  select case p_name
    when 'k2' then '{"damage":24,"delay":0.16,"range":85,"magazine":30,"reload":2,"slot":"primary"}'::jsonb
    when 'ak47' then '{"damage":30,"delay":0.2,"range":80,"magazine":30,"reload":2.3,"slot":"primary"}'::jsonb
    when 'aug64' then '{"damage":22,"delay":0.13,"range":85,"magazine":30,"reload":2,"slot":"primary"}'::jsonb
    when 'sniper' then '{"damage":100,"delay":1.3,"range":140,"magazine":5,"reload":2.8,"slot":"primary"}'::jsonb
    when 'pistol' then '{"damage":28,"delay":0.32,"range":55,"magazine":12,"reload":1.5,"slot":"secondary"}'::jsonb
    when 'shotgun' then '{"damage":75,"delay":0.9,"range":22,"magazine":6,"reload":2.4,"slot":"secondary"}'::jsonb
    when 'kukri' then '{"damage":45,"delay":0.55,"range":2.8,"magazine":0,"reload":0,"slot":"melee"}'::jsonb
    when 'axe' then '{"damage":65,"delay":0.85,"range":2.7,"magazine":0,"reload":0,"slot":"melee"}'::jsonb
    when 'shovel' then '{"damage":50,"delay":0.7,"range":3,"magazine":0,"reload":0,"slot":"melee"}'::jsonb
    when 'stick' then '{"damage":35,"delay":0.4,"range":3.2,"magazine":0,"reload":0,"slot":"melee"}'::jsonb
    else null end
$$;
create or replace function public.soldier_cover()
returns jsonb language sql immutable set search_path=public as $$
  select '[[-25,-25,12,12,8],[25,-25,12,12,8],[-25,25,12,12,8],[25,25,12,12,8],[-8,-12,6,4,2.8],[12,8,6,4,2.8],[-12,12,4,8,2.8],[8,-5,4,5,2.8],[0,30,10,3,2.5],[0,-32,10,3,2.5],[-35,0,3,12,3],[35,0,3,12,3]]'::jsonb
$$;
create or replace function public.soldier_blocked(px double precision,pz double precision)
returns boolean language sql immutable set search_path=public as $$
  select abs(px)>48 or abs(pz)>48 or exists (
    select 1 from jsonb_array_elements(public.soldier_cover()) b
    where abs(px-(b->>0)::float8)<(b->>2)::float8/2+.5
      and abs(pz-(b->>1)::float8)<(b->>3)::float8/2+.5)
$$;
create or replace function public.soldier_ray(o float8[],d float8[],lo float8[],hi float8[])
returns float8 language plpgsql immutable set search_path=public as $$
declare n float8:=0; f float8:='Infinity'; a float8; b float8; i integer;
begin
  for i in 1..3 loop
    if abs(d[i])<0.00000001 then
      if o[i]<lo[i] or o[i]>hi[i] then return 'Infinity'; end if;
    else
      a:=(lo[i]-o[i])/d[i]; b:=(hi[i]-o[i])/d[i];
      n:=greatest(n,least(a,b)); f:=least(f,greatest(a,b));
      if n>f then return 'Infinity'; end if;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.soldier_connect(p_client_id uuid,p_nickname text,p_session_token uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid; nick text; t uuid; xp_value bigint;
begin
  if p_session_token is not null then
    select account_id into uid from public.site_account_sessions where token=p_session_token and expires_at>now();
    if uid is null then raise exception '로그인 세션이 만료되었습니다. 다시 로그인하세요.'; end if;
  else
    if exists(select 1 from public.site_accounts where id=p_client_id) then raise exception '계정에 연결된 투자 닉네임입니다. 로그인하세요.'; end if;
    select client_id into uid from public.investment_users where client_id=p_client_id and nickname=trim(p_nickname);
  end if;
  select nickname into nick from public.investment_users where client_id=uid;
  if nick is null then raise exception '메인에서 투자 고유 닉네임을 먼저 설정하세요.'; end if;
  insert into public.soldier_profiles(client_id) values(uid) on conflict do nothing;
  delete from public.soldier_rooms where created_at<now()-interval '1 day';
  delete from public.soldier_sessions where expires_at<now();
  insert into public.soldier_sessions(client_id,account_token) values(uid,p_session_token) returning token into t;
  select xp into xp_value from public.soldier_profiles where client_id=uid;
  return jsonb_build_object('token',t,'nickname',nick,'xp',xp_value);
end $$;

create or replace function public.soldier_snapshot(p_room uuid,p_player uuid)
returns jsonb language sql security definer set search_path=public as $$
  select jsonb_build_object('room',jsonb_build_object('id',r.id,'name',r.name,'status',r.status,
    'host',r.host,'ends_at',r.ends_at,'server_time',clock_timestamp()),'self',p_player,
    'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'nickname',p.nickname,
      'x',p.x,'y',p.y,'z',p.z,'yaw',p.yaw,'pitch',p.pitch,'crouch',p.crouch,'hp',p.hp,
      'kills',p.kills,'deaths',p.deaths,'weapon',p.loadout->>p.slot,'last_shot',p.last_shot,
      'protected_until',p.protected_until,'respawn_at',p.respawn_at))
      from public.soldier_players p where p.room_id=r.id and p.last_seen>now()-interval '12 seconds'),'[]'::jsonb),
    'ammo',(select ammo from public.soldier_players where id=p_player),
    'reload_until',(select reload_until from public.soldier_players where id=p_player),
    'xp',(select s.xp from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player))
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
    -- One active player per investment identity, including different tabs/sessions.
    perform 1 from public.soldier_profiles where client_id=uid for update;
    if exists(select 1 from public.soldier_players where client_id=uid and last_seen>ts-interval '12 seconds') then raise exception '이미 방에 접속 중입니다. 기존 방을 나가거나 12초 후 다시 시도하세요.'; end if;
    equipment:=coalesce(p_data->'loadout','{"primary":"k2","secondary":"pistol","melee":"kukri"}'::jsonb);
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
      ammo=jsonb_build_object('primary',(public.soldier_weapon(loadout->>'primary')->>'magazine')::int,
        'secondary',(public.soldier_weapon(loadout->>'secondary')->>'magazine')::int,'melee',0) where id=me.id;
    select * into me from public.soldier_players where id=me.id;
  end if;
  if me.hp<=0 then return public.soldier_snapshot(rid,me.id); end if;
  if me.reload_until is not null and ts>=me.reload_until then
    update public.soldier_players set ammo=jsonb_set(ammo,array[reload_slot],public.soldier_weapon(loadout->>reload_slot)->'magazine'),
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
    spec:=public.soldier_weapon(me.loadout->>slot_name);
    if slot_name<>'melee' and me.reload_until is null then
      update public.soldier_players set reload_slot=slot_name,reload_until=ts+(spec->>'reload')::float8*interval '1 second' where id=me.id;
    end if;
  elsif p_action='fire' then
    spec:=public.soldier_weapon(me.loadout->>slot_name);
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
revoke all on function public.soldier_weapon(text),public.soldier_cover(),public.soldier_blocked(float8,float8),
  public.soldier_ray(float8[],float8[],float8[],float8[]),public.soldier_snapshot(uuid,uuid) from public;
revoke all on function public.soldier_connect(uuid,text,uuid),public.soldier_api(uuid,text,uuid,jsonb) from public;
grant execute on function public.soldier_connect(uuid,text,uuid),public.soldier_api(uuid,text,uuid,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
