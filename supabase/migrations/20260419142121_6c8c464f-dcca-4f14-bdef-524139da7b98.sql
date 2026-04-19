create extension if not exists vector;

create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text,
  email text,
  home_location text,
  home_lat double precision,
  home_lon double precision,
  resources text,
  important_documents text,
  emergency_contacts text,
  transport text,
  pets text,
  special_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Users view own profile" on public.profiles for select using (auth.uid() = user_id);
create policy "Users insert own profile" on public.profiles for insert with check (auth.uid() = user_id);
create policy "Users update own profile" on public.profiles for update using (auth.uid() = user_id);
create policy "Users delete own profile" on public.profiles for delete using (auth.uid() = user_id);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.update_updated_at_column();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  age integer,
  relationship text,
  vulnerabilities text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.household_members enable row level security;
create index idx_household_members_user on public.household_members(user_id);
create policy "Users view own household" on public.household_members for select using (auth.uid() = user_id);
create policy "Users insert own household" on public.household_members for insert with check (auth.uid() = user_id);
create policy "Users update own household" on public.household_members for update using (auth.uid() = user_id);
create policy "Users delete own household" on public.household_members for delete using (auth.uid() = user_id);
create trigger household_members_updated_at before update on public.household_members
  for each row execute function public.update_updated_at_column();

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
  plan_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sessions enable row level security;
create index idx_sessions_user_updated on public.sessions(user_id, updated_at desc);
create policy "Users view own sessions" on public.sessions for select using (auth.uid() = user_id);
create policy "Users insert own sessions" on public.sessions for insert with check (auth.uid() = user_id);
create policy "Users update own sessions" on public.sessions for update using (auth.uid() = user_id);
create policy "Users delete own sessions" on public.sessions for delete using (auth.uid() = user_id);
create trigger sessions_updated_at before update on public.sessions
  for each row execute function public.update_updated_at_column();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create index idx_messages_session_created on public.messages(session_id, created_at);
create policy "Users view own messages" on public.messages for select using (auth.uid() = user_id);
create policy "Users insert own messages" on public.messages for insert with check (auth.uid() = user_id);
create policy "Users delete own messages" on public.messages for delete using (auth.uid() = user_id);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  title text not null,
  content text not null,
  location text,
  hazards text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.plans enable row level security;
create index idx_plans_user_created on public.plans(user_id, created_at desc);
create policy "Users view own plans" on public.plans for select using (auth.uid() = user_id);
create policy "Users insert own plans" on public.plans for insert with check (auth.uid() = user_id);
create policy "Users update own plans" on public.plans for update using (auth.uid() = user_id);
create policy "Users delete own plans" on public.plans for delete using (auth.uid() = user_id);
create trigger plans_updated_at before update on public.plans
  for each row execute function public.update_updated_at_column();

create table public.kb_documents (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  title text not null,
  hazard text,
  content text not null,
  embedding vector(768),
  created_at timestamptz not null default now()
);
alter table public.kb_documents enable row level security;
create index idx_kb_embedding on public.kb_documents using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create policy "KB readable by everyone" on public.kb_documents for select to anon, authenticated using (true);

create or replace function public.match_kb_documents(query_embedding vector(768), match_count int default 5)
returns table (id uuid, source text, title text, hazard text, content text, similarity float)
language sql stable set search_path = public as $$
  select id, source, title, hazard, content, 1 - (embedding <=> query_embedding) as similarity
  from public.kb_documents
  where embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;