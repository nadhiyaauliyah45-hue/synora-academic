-- =====================================================================
-- 010_lifecycle.sql — role baru, siklus hidup mahasiswa (aditif, aman dijalankan ulang)
-- Jalankan SETELAH schema, relationships, rls-policies, seed.
-- =====================================================================
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check check (role in
 ('km','sekretaris','bendahara','dosen','super_admin','admin_prodi','admin_pmb','admin_keuangan','mahasiswa','asisten_lab',
  'kaprodi','dekan','admin_universitas'));

alter table public.students
  add column if not exists angkatan int check (angkatan between 2000 and 2100),
  add column if not exists status_akademik text not null default 'aktif',
  add column if not exists status_changed_at date,
  add column if not exists tanggal_masuk date;
alter table public.students drop constraint if exists students_status_akademik_check;
alter table public.students add constraint students_status_akademik_check check (status_akademik in
 ('calon','pendaftar','peserta_seleksi','diterima','registrasi_ulang','mahasiswa_baru','aktif',
  'cuti','nonaktif','mengundurkan_diri','do','proses_penyelesaian','mengajukan_kelulusan',
  'belum_memenuhi_syarat','lulus','alumni'));
-- Angkatan mahasiswa lama diambil dari 2 digit awal NIM (240511160 -> 2024), hanya bila masuk akal.
update public.students set angkatan = 2000 + substr(nim,1,2)::int
 where angkatan is null and nim ~ '^[0-9]{2}' and substr(nim,1,2)::int between 10 and 40;

alter table public.lecturers add column if not exists user_id uuid unique references auth.users(id) on delete set null;

-- Penghubung akun login <-> data akademik
create or replace function public.my_student_id() returns uuid language sql stable security definer set search_path=public as $$
  select s.id from public.students s join public.profiles p on p.nim = s.nim where p.id = auth.uid() $$;
create or replace function public.my_lecturer_id() returns uuid language sql stable security definer set search_path=public as $$
  select id from public.lecturers where user_id = auth.uid() $$;
create or replace function public.is_staff() returns boolean language sql stable as $$
  select public.has_role(array['super_admin','admin_universitas','kaprodi','admin_prodi']) $$; -- kelas peran (tanpa cakupan); cakupan prodi diperiksa oleh staff_of_*
grant execute on function public.my_student_id(), public.my_lecturer_id(), public.is_staff() to authenticated;

create table if not exists public.student_status_history (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  from_status text, to_status text not null,
  effective_date date not null default current_date,
  reason text, changed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (to_status not in ('cuti','nonaktif','mengundurkan_diri','do','belum_memenuhi_syarat') or coalesce(length(trim(reason)),0) > 0)
);
create index if not exists ix_ssh_student on public.student_status_history(student_id, effective_date);

create table if not exists public.student_study_periods (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  period_type text not null check (period_type in ('aktif','cuti','nonaktif')),
  start_date date not null, end_date date, reason text,
  check (end_date is null or end_date >= start_date));
create index if not exists ix_ssp_student on public.student_study_periods(student_id);

create table if not exists public.student_graduation (
  student_id uuid primary key references public.students(id) on delete cascade,
  graduation_date date not null, ipk numeric(3,2) check (ipk between 0 and 4),
  total_sks int, thesis_title text, yudisium_date date, sk_number text,
  created_at timestamptz not null default now());
create table if not exists public.alumni (
  student_id uuid primary key references public.students(id) on delete cascade,
  workplace text, job_title text, contact text, tracer_note text,
  updated_at timestamptz not null default now());

-- Trigger: setiap perubahan status tercatat di riwayat + masa studi
create or replace function public.trg_student_status() returns trigger language plpgsql security definer set search_path=public as $$
declare d date := coalesce(new.status_changed_at, current_date);
begin
  if tg_op='UPDATE' and new.status_akademik is distinct from old.status_akademik then
    insert into public.student_status_history(student_id,from_status,to_status,effective_date,reason,changed_by)
    values (new.id, old.status_akademik, new.status_akademik, d, nullif(current_setting('synora.status_reason',true),''), auth.uid());
    new.status_changed_at := d;
    update public.student_study_periods set end_date = greatest(d,start_date) where student_id=new.id and end_date is null;
    if new.status_akademik in ('aktif','mahasiswa_baru','proses_penyelesaian','mengajukan_kelulusan','belum_memenuhi_syarat') then
      insert into public.student_study_periods(student_id,period_type,start_date) values (new.id,'aktif',d);
    elsif new.status_akademik in ('cuti','nonaktif') then
      insert into public.student_study_periods(student_id,period_type,start_date,reason)
      values (new.id,new.status_akademik,d,nullif(current_setting('synora.status_reason',true),''));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists students_status on public.students;
create trigger students_status before update on public.students for each row execute function public.trg_student_status();

-- Fungsi internal (tanpa cek role; TIDAK diberikan ke pengguna) dan pintu publik (cek role)
create or replace function public.set_student_status(p_student uuid, p_to text, p_date date, p_reason text)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform set_config('synora.status_reason', coalesce(p_reason,''), true);
  update public.students set status_akademik=p_to, status_changed_at=coalesce(p_date,current_date) where id=p_student;
end $$;
revoke all on function public.set_student_status(uuid,text,date,text) from public, anon, authenticated;

create or replace function public.change_student_status(p_student uuid, p_to text, p_date date, p_reason text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.staff_of_student(p_student) then raise exception 'Tidak berhak mengubah status mahasiswa'; end if;
  if p_to in ('lulus','alumni') then raise exception 'Status lulus/alumni hanya lewat proses kelulusan'; end if;
  perform public.set_student_status(p_student,p_to,p_date,p_reason);
end $$;
revoke all on function public.change_student_status(uuid,text,date,text) from public, anon;
grant execute on function public.change_student_status(uuid,text,date,text) to authenticated;
