create or replace function public.record_cancel_poll_vote(
  p_poll_id uuid,
  p_voter_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_option uuid;
begin
  delete from public.record_poll_votes
  where poll_id = p_poll_id and voter_key = p_voter_key
  returning option_id into v_option;
  if v_option is not null then
    update public.record_poll_options
    set vote_count = greatest(vote_count - 1, 0)
    where id = v_option;
  end if;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.record_get_my_poll_votes(p_voter_key text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(poll_id::text, option_id::text), '{}'::jsonb)
  from public.record_poll_votes
  where voter_key = p_voter_key;
$$;

revoke all on function public.record_cancel_poll_vote(uuid, text) from public;
revoke all on function public.record_get_my_poll_votes(text) from public;
grant execute on function public.record_cancel_poll_vote(uuid, text) to anon, authenticated;
grant execute on function public.record_get_my_poll_votes(text) to anon, authenticated;

notify pgrst, 'reload schema';
