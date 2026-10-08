alter table public.record_posts add column if not exists view_count bigint not null default 0;

create or replace function public.record_increment_view(p_post_id uuid)
returns bigint
language sql
security definer
set search_path = public
as $$
  update public.record_posts
  set view_count = view_count + 1
  where id = p_post_id
  returning view_count;
$$;

revoke all on function public.record_increment_view(uuid) from public;
grant execute on function public.record_increment_view(uuid) to anon, authenticated;


create or replace function public.record_get_board()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'posts', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at desc)
      from (
        select rp.id, rp.nickname, rp.title, rp.body, rp.upvotes, rp.downvotes,
               rp.created_at, rp.edited_at, rp.view_count,
               (select count(*) from public.record_comments rc where rc.post_id = rp.id) as comment_count,
               (
                 select jsonb_build_object(
                   'id', poll.id,
                   'question', poll.question,
                   'options', coalesce((
                     select jsonb_agg(jsonb_build_object(
                       'id', option.id,
                       'text', option.option_text,
                       'votes', option.vote_count
                     ) order by option.option_order, option.id)
                     from public.record_poll_options option
                     where option.poll_id = poll.id
                   ), '[]'::jsonb)
                 )
                 from public.record_polls poll
                 where poll.post_id = rp.id
               ) as poll
        from public.record_posts rp
      ) p
    ), '[]'::jsonb),
    'notices', coalesce((
      select jsonb_agg(to_jsonb(rn) order by rn.created_at desc)
      from public.record_notices rn
    ), '[]'::jsonb)
  );
$$;

notify pgrst, 'reload schema';
