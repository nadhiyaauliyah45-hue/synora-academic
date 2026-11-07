-- 020_prodi.sql — Fakultas, Prodi, tahun ajaran, semester, kelas, penugasan dosen
create table if not exists public.faculties (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null unique,
  dean_name text, is_active boolean not null default true,
  created_at timestamptz not null default now());
insert into public.faculties(code,name) values ('FT','Fakultas Teknik') on conflict (code) do nothing;

create table if not exists public.study_programs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null, level text not null default 'S1',
  head_name text, is_active boolean not null default true,
  created_at timestamptz not null default now());
insert into public.study_programs(code,name,level) values ('TI','Teknik Informatika','S1') on conflict (code) do nothing;
alter table public.study_programs add column if not exists faculty_id uuid references public.faculties(id);
update public.study_programs set faculty_id=(select id from public.faculties where code='FT') where code='TI' and faculty_id is null;
alter table public.lecturers add column if not exists program_id uuid references public.study_programs(id);

alter table public.students add column if not exists program_id uuid references public.study_programs(id);
update public.students set program_id=(select id from public.study_programs where code='TI') where program_id is null;

create table if not exists public.academic_years (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name ~ '^[0-9]{4}/[0-9]{4}$'),
  start_date date not null, end_date date not null check (end_date > start_date),
  created_at timestamptz not null default now());

create table if not exists public.semesters (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  term text not null check (term in ('ganjil','genap')),
  start_date date, end_date date, is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (academic_year_id, term));
create unique index if not exists ux_semesters_one_active on public.semesters(is_active) where is_active;

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references public.study_programs(id),
  name text not null unique, angkatan int check (angkatan between 2000 and 2100),
  advisor_id uuid references public.lecturers(id) on delete set null,
  created_at timestamptz not null default now());
create table if not exists public.class_members (
  class_id uuid references public.classes(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  primary key (class_id, student_id));
create index if not exists ix_cm_student on public.class_members(student_id);

alter table public.courses
  add column if not exists program_id uuid references public.study_programs(id),
  add column if not exists semester_no smallint check (semester_no between 1 and 14),
  add column if not exists has_practicum boolean not null default false;

create table if not exists public.teaching_assignments (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid not null references public.semesters(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  class_id uuid references public.classes(id) on delete cascade,
  lecturer_id uuid not null references public.lecturers(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (semester_id, course_id, class_id));
create index if not exists ix_ta_lect on public.teaching_assignments(lecturer_id);

-- Mahasiswa yang tampil sebagai anggota kelas aktif (dipakai dosen & Admin Prodi)
create or replace view public.v_class_roster with (security_invoker=true) as
select c.id class_id, c.name class_name, s.id student_id, s.nim, s.full_name, s.status_akademik
from public.classes c join public.class_members m on m.class_id=c.id join public.students s on s.id=m.student_id;
