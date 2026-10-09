-- Supabase SQL Editor only. Change this exact investment nickname before running.
-- Adds test currency once and grants all 15 weapon cards once per player.
-- Requires soldier-weapon-rewards.sql. Do not expose this script through a client RPC.
begin;
do $$
declare
  target_nickname text := '여기에 투자 닉네임';
  target uuid; weapon_id text; item_grade text;
begin
  select p.client_id into target
  from public.soldier_profiles p
  join public.investment_users u on u.client_id=p.client_id
  where u.nickname=target_nickname;
  if target is null then
    raise exception '닉네임에 해당하는 솔져 프로필이 없습니다. 닉네임을 확인하고 게임에 먼저 접속하세요.';
  end if;
  perform 1 from public.soldier_profiles where client_id=target for update;
  if not exists (
    select 1 from public.soldier_weapon_items where client_id=target and reward_key='admin-test-v1-k2-D'
  ) then
    update public.soldier_profiles
    set gems=gems+1000,gold=gold+1000000 where client_id=target;
  end if;
  foreach weapon_id in array array['k2','shotgun','stick'] loop
    foreach item_grade in array array['D','C','B','A','S'] loop
      perform public.soldier_grant_weapon(target,weapon_id,item_grade,'admin-test',
        'admin-test-v1-'||weapon_id||'-'||item_grade);
    end loop;
  end loop;
end $$;
commit;
