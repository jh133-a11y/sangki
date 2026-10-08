-- Run after chess-schema.sql. Includes member and guest server AI results.
begin;

create or replace function public.chess_ranking(p_page integer default 1)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_result jsonb;
begin
  if p_page is null or p_page < 1 or p_page > 1000000 then
    raise exception '랭킹 페이지 번호를 확인하세요.';
  end if;
  with totals as (
    select u.client_id, u.nickname,
      count(*) filter (where g.result = 'win') as wins
    from public.chess_games g
    join public.investment_users u on u.client_id = g.account_id
    where g.result in ('win', 'draw', 'loss')
    group by u.client_id, u.nickname
  ), ranked as (
    select nickname, wins,
      row_number() over (order by wins desc, nickname, client_id) as rank
    from totals
  ), page_rows as (
    select * from ranked order by rank
    limit 5 offset ((p_page::bigint - 1) * 5)
  )
  select jsonb_build_object(
    'total', (select count(*) from totals),
    'page', p_page,
    'entries', coalesce(
      (select jsonb_agg(jsonb_build_object('rank', rank, 'nickname', nickname, 'wins', wins) order by rank) from page_rows),
      '[]'::jsonb
    )
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.chess_ranking(integer) from public;
grant execute on function public.chess_ranking(integer) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
