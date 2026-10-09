-- Administrator SQL Editor only. Run after soldier-weapon-material-upgrade.sql.
-- Once per player: 45 weapon cards + 1,000,000 gold + 100,000 gems.
begin;
do $$
declare
  target_nickname text := 'miss';
  target uuid; weapon_id text; item_grade text; copy_number integer;
  reward_batch text := 'admin-material-test-v1';
begin
  select p.client_id into target from public.soldier_profiles p
  join public.investment_users u on u.client_id=p.client_id
  where u.nickname=target_nickname;
  if target is null then
    raise exception '닉네임에 해당하는 솔져 프로필이 없습니다. 게임에 먼저 접속하세요.';
  end if;
  perform 1 from public.soldier_profiles where client_id=target for update;
  if exists(select 1 from public.soldier_admin_grants where client_id=target and grant_key=reward_batch) then
    raise notice '이미 지급한 보상입니다. 재화와 무기를 중복 지급하지 않습니다.';
    return;
  end if;
  foreach weapon_id in array array['k2','shotgun','stick'] loop
    foreach item_grade in array array['D','C','B','A','S'] loop
      for copy_number in 1..3 loop
        perform public.soldier_grant_weapon(target,weapon_id,item_grade,'admin-material',
          reward_batch||'-'||weapon_id||'-'||item_grade||'-'||copy_number);
      end loop;
    end loop;
  end loop;
  update public.soldier_profiles set gold=gold+1000000,gems=gems+100000 where client_id=target;
  insert into public.soldier_admin_grants(client_id,grant_key) values(target,reward_batch);
end $$;
commit;
