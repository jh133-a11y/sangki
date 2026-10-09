-- Run after soldier-schema.sql for existing installations.
begin;
alter table public.soldier_profiles add column if not exists wins bigint not null default 0 check (wins>=0);
alter table public.soldier_profiles add column if not exists gold bigint not null default 0 check (gold>=0);
alter table public.soldier_profiles add column if not exists gems bigint not null default 0 check (gems>=0);

create or replace function public.soldier_settle_match()
returns trigger language plpgsql security definer set search_path=public as $$
declare winner uuid; top_kills integer; tied integer;
begin
  if old.status='playing' and new.status='finished' then
    select max(kills) into top_kills from public.soldier_players where room_id=new.id;
    if coalesce(top_kills,0)>0 and (select count(*) from public.soldier_players where room_id=new.id)>=2 then
      select count(*) into tied from public.soldier_players where room_id=new.id and kills=top_kills;
      if tied=1 then
        select client_id into winner from public.soldier_players where room_id=new.id and kills=top_kills;
        update public.soldier_profiles set xp=xp+100,wins=wins+1 where client_id=winner;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists soldier_match_rewards on public.soldier_rooms;
create trigger soldier_match_rewards after update of status on public.soldier_rooms
for each row execute function public.soldier_settle_match();

create or replace function public.soldier_connect(p_client_id uuid,p_nickname text,p_session_token uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid; nick text; t uuid; profile public.soldier_profiles%rowtype;
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
  select * into profile from public.soldier_profiles where client_id=uid;
  return jsonb_build_object('token',t,'nickname',nick,'xp',profile.xp,'wins',profile.wins,
    'gold',profile.gold::text,'gems',profile.gems::text,'home_version',2);
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
    'xp',(select s.xp from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player),
    'wins',(select s.wins from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player),
    'gold',(select s.gold::text from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player),
    'gems',(select s.gems::text from public.soldier_profiles s join public.soldier_players p on s.client_id=p.client_id where p.id=p_player),
    'home_version',2)
  from public.soldier_rooms r where r.id=p_room
$$;
revoke all on function public.soldier_settle_match(),public.soldier_snapshot(uuid,uuid),
  public.soldier_connect(uuid,text,uuid) from public;
grant execute on function public.soldier_connect(uuid,text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
