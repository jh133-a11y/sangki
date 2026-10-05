create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  nickname text not null check (char_length(nickname) between 1 and 24),
  body text not null check (char_length(body) between 1 and 500),
  password_hash text not null check (char_length(password_hash) = 64),
  created_at timestamptz not null default now()
);

alter table public.comments enable row level security;

create policy "Anyone can read comments"
on public.comments for select
to anon
using (true);

create policy "Anyone can add comments"
on public.comments for insert
to anon
with check (true);
