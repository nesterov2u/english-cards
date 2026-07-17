create table public.cards (
  id uuid primary key default gen_random_uuid(),
  word text not null,
  translation text not null,
  definition text,
  example text,
  phonetic text,
  created_at timestamptz not null default now()
);

alter table public.cards enable row level security;

-- Личный проект: любой посетитель сайта может читать и редактировать общую коллекцию.
-- Для публичного доступа нескольким пользователям замените эти политики на авторизацию.
create policy "Public read cards" on public.cards for select using (true);
create policy "Public add cards" on public.cards for insert with check (true);
create policy "Public delete cards" on public.cards for delete using (true);
