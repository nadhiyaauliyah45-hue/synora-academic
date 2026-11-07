-- 060_praktikum.sql — praktikum & laboratorium
create table if not exists public.labs (
  id uuid primary key default gen_random_uuid(), name text not null unique, location text,
  capacity int check (capacity is null or capacity > 0), is_active boolean not null default true,
  created_at timestamptz not null default now());
alter table public.labs add column if not exists program_id uuid references public.study_programs(id);
create table if not exists public.lab_assistants (
  lab_id uuid references public.labs(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  primary key (lab_id, student_id));
create table if not exists public.practicum_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  semester_id uuid not null references public.semesters(id) on delete cascade,
  lab_id uuid references public.labs(id) on delete set null,
  class_id uuid references public.classes(id) on delete set null,
  assistant_id uuid references public.students(id) on delete set null,
  title text not null, session_date date not null, start_time time, end_time time,
  created_at timestamptz not null default now());
create table if not exists public.practicum_attendance (
  session_id uuid references public.practicum_sessions(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  status text not null check (status in ('hadir','izin','sakit','alfa')),
  primary key (session_id, student_id));
create table if not exists public.practicum_scores (
  session_id uuid references public.practicum_sessions(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  score numeric(5,2) check (score between 0 and 100), note text,
  primary key (session_id, student_id));
create or replace function public.is_session_assistant(p_session uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.practicum_sessions s where s.id=p_session and s.assistant_id = public.my_student_id()) $$;
grant execute on function public.is_session_assistant(uuid) to authenticated;
