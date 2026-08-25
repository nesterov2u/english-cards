create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  word text not null,
  translation text not null,
  examples text,
  synonyms text,
  phonetic text,
  created_at timestamptz not null default now()
);

alter table public.cards add column if not exists examples text;
alter table public.cards add column if not exists synonyms text;
alter table public.cards add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.cards alter column user_id set default auth.uid();

alter table public.cards enable row level security;

-- Личные словари: каждая карточка доступна только её владельцу.
-- Старые общие карточки останутся без владельца и никому не будут видны, пока
-- владелец проекта не назначит им user_id вручную в SQL Editor.
drop policy if exists "Public read cards" on public.cards;
drop policy if exists "Public add cards" on public.cards;
drop policy if exists "Public update cards" on public.cards;
drop policy if exists "Public delete cards" on public.cards;
drop policy if exists "Users read own cards" on public.cards;
drop policy if exists "Users add own cards" on public.cards;
drop policy if exists "Users update own cards" on public.cards;
drop policy if exists "Users delete own cards" on public.cards;

create policy "Users read own cards" on public.cards
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users add own cards" on public.cards
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own cards" on public.cards
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own cards" on public.cards
  for delete to authenticated using ((select auth.uid()) = user_id);

-- После первого входа владельца перенесите прежнюю общую коллекцию в его личный
-- словарь. Запрос безопасно затрагивает только карточки без владельца.
update public.cards
set user_id = (select id from auth.users where email = 'nesterov.foto@yandex.ru')
where user_id is null
  and exists (select 1 from auth.users where email = 'nesterov.foto@yandex.ru');
