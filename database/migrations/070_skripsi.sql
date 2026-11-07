-- 070_skripsi.sql — tugas akhir / skripsi
create table if not exists public.thesis (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.students(id) on delete cascade,
  title text not null check (char_length(title) >= 10), abstract text,
  status text not null default 'diajukan' check (status in
    ('diajukan','revisi_judul','disetujui','bimbingan','layak_sidang','dijadwalkan','revisi_pasca_sidang','selesai','ditolak')),
  decision_note text, decided_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.thesis_supervisors (
  thesis_id uuid references public.thesis(id) on delete cascade,
  lecturer_id uuid references public.lecturers(id) on delete restrict,
  role text not null default 'pembimbing_1' check (role in ('pembimbing_1','pembimbing_2')),
  primary key (thesis_id, lecturer_id));
create unique index if not exists ux_thesis_role on public.thesis_supervisors(thesis_id, role);
create table if not exists public.thesis_guidance (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis(id) on delete cascade,
  guidance_date date not null default current_date, topic text not null, notes text,
  file_path text, status text not null default 'diajukan' check (status in ('diajukan','disetujui','revisi')),
  lecturer_id uuid references public.lecturers(id), lecturer_note text,
  created_by uuid references auth.users(id), created_at timestamptz not null default now());
create index if not exists ix_tg_thesis on public.thesis_guidance(thesis_id);
create table if not exists public.thesis_defenses (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis(id) on delete cascade,
  defense_date date not null, start_time time, room text,
  examiner1_id uuid references public.lecturers(id), examiner2_id uuid references public.lecturers(id),
  result text check (result in ('lulus','lulus_revisi','mengulang')), score numeric(5,2) check (score between 0 and 100), note text,
  created_at timestamptz not null default now());
create table if not exists public.thesis_files (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis(id) on delete cascade,
  kind text not null check (kind in ('proposal','bab','naskah_final','revisi','lainnya')),
  title text not null, file_path text not null,
  uploaded_by uuid references auth.users(id), created_at timestamptz not null default now());

create or replace function public.is_thesis_supervisor(p_thesis uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.thesis_supervisors where thesis_id=p_thesis and lecturer_id=public.my_lecturer_id()) $$;
create or replace function public.is_thesis_owner(p_thesis uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.thesis where id=p_thesis and student_id=public.my_student_id()) $$;
grant execute on function public.is_thesis_supervisor(uuid), public.is_thesis_owner(uuid) to authenticated;

-- Alur status skripsi (hanya lewat fungsi ini)
create or replace function public.thesis_set_status(p_thesis uuid, p_to text, p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare cur text; staff boolean := public.staff_of_student(public.student_of_thesis(p_thesis)); sup boolean := public.is_thesis_supervisor(p_thesis);
begin
  select status into cur from public.thesis where id=p_thesis;
  if cur is null then raise exception 'Skripsi tidak ditemukan'; end if;
  if not (staff or sup) then raise exception 'Tidak berhak mengubah status skripsi'; end if;
  if (cur,p_to) not in (('diajukan','disetujui'),('diajukan','revisi_judul'),('diajukan','ditolak'),('revisi_judul','diajukan'),
      ('disetujui','bimbingan'),('bimbingan','layak_sidang'),('layak_sidang','dijadwalkan'),('dijadwalkan','revisi_pasca_sidang'),
      ('dijadwalkan','selesai'),('dijadwalkan','bimbingan'),('revisi_pasca_sidang','selesai')) then
    raise exception 'Perubahan status % -> % tidak diizinkan', cur, p_to; end if;
  if p_to in ('disetujui','revisi_judul','ditolak','dijadwalkan') and not staff then raise exception 'Hanya Admin Prodi yang dapat menetapkan status ini'; end if;
  if p_to in ('revisi_judul','ditolak') and coalesce(trim(p_note),'')='' then raise exception 'Catatan wajib diisi'; end if;
  if p_to='bimbingan' and cur='disetujui' and not exists (select 1 from public.thesis_supervisors where thesis_id=p_thesis) then
    raise exception 'Tetapkan pembimbing terlebih dahulu'; end if;
  update public.thesis set status=p_to, decision_note=coalesce(p_note,decision_note), decided_by=auth.uid(), updated_at=now() where id=p_thesis;
end $$;
revoke all on function public.thesis_set_status(uuid,text,text) from public, anon;
grant execute on function public.thesis_set_status(uuid,text,text) to authenticated;
