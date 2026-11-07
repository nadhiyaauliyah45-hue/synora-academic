-- 030_pmb.sql — Penerimaan Mahasiswa Baru. Pelamar disimpan di tabel sendiri; NIM dibuat saat registrasi ulang.
create table if not exists public.pmb_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, academic_year_id uuid references public.academic_years(id),
  open_date date not null, close_date date not null check (close_date >= open_date),
  quota int check (quota is null or quota > 0), program_id uuid references public.study_programs(id),
  is_open boolean not null default true, created_at timestamptz not null default now());

create sequence if not exists public.pmb_reg_seq;
create table if not exists public.pmb_applicants (
  id uuid primary key default gen_random_uuid(),
  reg_number text unique,
  period_id uuid not null references public.pmb_periods(id),
  full_name text not null check (char_length(full_name) between 2 and 120),
  gender text check (gender in ('L','P')),
  birth_place text, birth_date date, phone text, email text, address text,
  school_origin text, school_major text, grad_year int,
  status text not null default 'pendaftar' check (status in
    ('pendaftar','berkas_lengkap','peserta_seleksi','diterima','tidak_lolos','registrasi_ulang','mengundurkan_diri')),
  test_score numeric(5,2) check (test_score between 0 and 100),
  selection_note text,
  student_id uuid unique references public.students(id) on delete set null,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create index if not exists ix_pa_period on public.pmb_applicants(period_id, status);

create or replace function public.trg_pmb_regnum() returns trigger language plpgsql as $$
begin
  if new.reg_number is null then new.reg_number := 'PMB-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.pmb_reg_seq')::text,4,'0'); end if;
  return new; end $$;
drop trigger if exists pmb_regnum on public.pmb_applicants;
create trigger pmb_regnum before insert on public.pmb_applicants for each row execute function public.trg_pmb_regnum();

create table if not exists public.pmb_documents (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.pmb_applicants(id) on delete cascade,
  doc_type text not null check (doc_type in ('ktp','kk','ijazah','transkrip','pas_foto','lainnya')),
  file_path text not null, verified boolean not null default false, note text,
  uploaded_by uuid references auth.users(id), created_at timestamptz not null default now());
create index if not exists ix_pd_app on public.pmb_documents(applicant_id);

create table if not exists public.pmb_status_history (
  id bigint generated always as identity primary key,
  applicant_id uuid not null references public.pmb_applicants(id) on delete cascade,
  from_status text, to_status text not null, note text,
  changed_by uuid references auth.users(id), created_at timestamptz not null default now());
create or replace function public.trg_pmb_hist() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.pmb_status_history(applicant_id,to_status,changed_by) values (new.id,new.status,auth.uid());
  return new; end $$;
drop trigger if exists pmb_hist_ins on public.pmb_applicants;
create trigger pmb_hist_ins after insert on public.pmb_applicants for each row execute function public.trg_pmb_hist();
create or replace function public.trg_pmb_hist_upd() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status is distinct from old.status then
    insert into public.pmb_status_history(applicant_id,from_status,to_status,note,changed_by)
    values (new.id,old.status,new.status,nullif(current_setting('synora.pmb_note',true),''),auth.uid());
  end if;
  new.updated_at := now(); return new; end $$;
drop trigger if exists pmb_hist_upd on public.pmb_applicants;
create trigger pmb_hist_upd before update on public.pmb_applicants for each row execute function public.trg_pmb_hist_upd();
