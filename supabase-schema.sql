create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  nickname text not null check (char_length(nickname) between 1 and 24),
  body text not null check (char_length(body) between 1 and 500),
  password_hash text not null check (char_length(password_hash) = 64),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

alter table public.comments add column if not exists edited_at timestamptz;

alter table public.comments enable row level security;

drop policy if exists "Anyone can read comments" on public.comments;
drop policy if exists "Anyone can add comments" on public.comments;

create policy "Anyone can read comments"
on public.comments for select
to anon
using (true);

create policy "Anyone can add comments"
on public.comments for insert
to anon
with check (true);

create or replace function public.update_comment(
  p_id uuid,
  p_password_hash text,
  p_body text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.comments
  set body = trim(p_body), edited_at = now()
  where id = p_id
    and password_hash = p_password_hash
    and char_length(trim(p_body)) between 1 and 500;

  return found;
end;
$$;

drop function if exists public.delete_comment(uuid, text);
drop function if exists public.delete_comment(uuid, text, text);

create or replace function public.delete_comment(
  p_id uuid,
  p_password_hash text,
  p_admin_password text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_admin_password = '8170' then
    delete from public.comments;
    return found;
  end if;

  delete from public.comments
  where id = p_id
    and (
      password_hash = p_password_hash
      or p_admin_password = '8170'
    );

  return found;
end;
$$;

revoke all on function public.update_comment(uuid, text, text) from public;
revoke all on function public.delete_comment(uuid, text, text) from public;
grant execute on function public.update_comment(uuid, text, text) to anon;
grant execute on function public.delete_comment(uuid, text, text) to anon;
