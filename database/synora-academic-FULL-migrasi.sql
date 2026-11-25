-- SYNORA Academic — migrasi lengkap (multi-fakultas + PMB OTP + tes PMB online + kalender otomatis). Jalankan SEKALI setelah schema.sql, relationships.sql, rls-policies.sql.

-- ===== 010_lifecycle =====
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

-- ===== 020_prodi =====
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

-- ===== 030_pmb =====
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

-- ===== 040_finance =====
-- 040_finance.sql — tagihan & pembayaran (terpisah dari kas kelas `transactions`)
create table if not exists public.fee_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('pendaftaran','registrasi_ulang','ukt','praktikum','skripsi','lainnya')),
  amount numeric(14,2) not null check (amount >= 0), is_active boolean not null default true,
  created_at timestamptz not null default now());

create sequence if not exists public.invoice_seq;
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text unique,
  fee_type_id uuid references public.fee_types(id),
  description text not null,
  student_id uuid references public.students(id) on delete cascade,
  applicant_id uuid references public.pmb_applicants(id) on delete cascade,
  semester_id uuid references public.semesters(id),
  amount numeric(14,2) not null check (amount > 0), due_date date,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(),
  check (student_id is not null or applicant_id is not null));
create index if not exists ix_inv_student on public.invoices(student_id);
create index if not exists ix_inv_app on public.invoices(applicant_id);
create or replace function public.trg_invoice_no() returns trigger language plpgsql as $$
begin if new.number is null then new.number := 'INV-' || to_char(now(),'YYYYMM') || '-' || lpad(nextval('public.invoice_seq')::text,5,'0'); end if; return new; end $$;
drop trigger if exists invoice_no on public.invoices;
create trigger invoice_no before insert on public.invoices for each row execute function public.trg_invoice_no();

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  paid_at date not null default current_date, method text default 'transfer',
  proof_path text,
  status text not null default 'menunggu' check (status in ('menunggu','terverifikasi','ditolak')),
  note text, submitted_by uuid references auth.users(id),
  verified_by uuid references auth.users(id), verified_at timestamptz,
  created_at timestamptz not null default now());
create index if not exists ix_pay_inv on public.payments(invoice_id, status);

-- Status tagihan dihitung database (hanya pembayaran terverifikasi yang dihitung)
create or replace view public.v_invoices with (security_invoker=true) as
select i.*, coalesce(p.paid,0) as paid,
  i.amount - coalesce(p.paid,0) as remaining,
  case when coalesce(p.paid,0) >= i.amount then 'lunas' when coalesce(p.paid,0) > 0 then 'sebagian' else 'belum_bayar' end as pay_status,
  coalesce(p.pending,0) as pending_count
from public.invoices i
left join (select invoice_id,
   sum(amount) filter (where status='terverifikasi') paid,
   count(*) filter (where status='menunggu') pending
   from public.payments group by invoice_id) p on p.invoice_id = i.id;

create or replace function public.verify_payment(p_payment uuid, p_ok boolean, p_note text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.fin_of_program(public.program_of_payment(p_payment)) then raise exception 'Tidak berhak memverifikasi pembayaran'; end if;
  if not p_ok and coalesce(trim(p_note),'')='' then raise exception 'Alasan penolakan wajib diisi'; end if;
  update public.payments set status = case when p_ok then 'terverifikasi' else 'ditolak' end,
    verified_by=auth.uid(), verified_at=now(), note=p_note
  where id=p_payment and status='menunggu';
  if not found then raise exception 'Pembayaran tidak ditemukan atau sudah diproses'; end if;
end $$;
revoke all on function public.verify_payment(uuid,boolean,text) from public, anon;
grant execute on function public.verify_payment(uuid,boolean,text) to authenticated;

-- ===== 050_akademik =====
-- 050_akademik.sql — KRS, nilai, KHS/transkrip
create table if not exists public.krs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  semester_id uuid not null references public.semesters(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','diajukan','disetujui','ditolak')),
  submitted_at timestamptz, decided_by uuid references auth.users(id), decided_at timestamptz, note text,
  created_at timestamptz not null default now(),
  unique (student_id, semester_id));
create table if not exists public.krs_items (
  id uuid primary key default gen_random_uuid(),
  krs_id uuid not null references public.krs(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete restrict,
  unique (krs_id, course_id));
create index if not exists ix_ki_course on public.krs_items(course_id);

create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  krs_item_id uuid not null unique references public.krs_items(id) on delete cascade,
  attendance_score numeric(5,2) check (attendance_score between 0 and 100),
  assignment_score numeric(5,2) check (assignment_score between 0 and 100),
  mid_score numeric(5,2) check (mid_score between 0 and 100),
  final_score numeric(5,2) check (final_score between 0 and 100),
  is_final boolean not null default false,
  entered_by uuid references auth.users(id), updated_at timestamptz not null default now());

-- Batas SKS per KRS (maks 24)
create or replace function public.trg_krs_sks() returns trigger language plpgsql as $$
declare tot int;
begin
  select coalesce(sum(c.sks),0) + (select sks from public.courses where id=new.course_id) into tot
  from public.krs_items i join public.courses c on c.id=i.course_id where i.krs_id=new.krs_id and i.id is distinct from new.id;
  if tot > 24 then raise exception 'Total SKS KRS tidak boleh lebih dari 24 (menjadi %)', tot; end if;
  return new; end $$;
drop trigger if exists krs_sks on public.krs_items;
create trigger krs_sks before insert on public.krs_items for each row execute function public.trg_krs_sks();

-- Nilai: bobot kehadiran 10%, tugas 20%, UTS 30%, UAS 40%. Skala: A>=85(4), AB>=80(3.5), B>=70(3), BC>=65(2.5), C>=55(2), D>=40(1), E(0).
create or replace view public.v_grades with (security_invoker=true) as
select g.id grade_id, k.student_id, k.semester_id, i.id krs_item_id, c.id course_id, c.code, c.name course_name, c.sks,
  g.is_final, g.attendance_score, g.assignment_score, g.mid_score, g.final_score,
  t.total,
  case when t.total is null then null when t.total>=85 then 'A' when t.total>=80 then 'AB' when t.total>=70 then 'B'
       when t.total>=65 then 'BC' when t.total>=55 then 'C' when t.total>=40 then 'D' else 'E' end as letter,
  case when t.total is null then null when t.total>=85 then 4.0 when t.total>=80 then 3.5 when t.total>=70 then 3.0
       when t.total>=65 then 2.5 when t.total>=55 then 2.0 when t.total>=40 then 1.0 else 0 end as points
from public.krs_items i
join public.krs k on k.id=i.krs_id and k.status='disetujui'
join public.courses c on c.id=i.course_id
left join public.grades g on g.krs_item_id=i.id
left join lateral (select case when g.id is null or g.attendance_score is null or g.assignment_score is null or g.mid_score is null or g.final_score is null then null
   else round(0.1*g.attendance_score+0.2*g.assignment_score+0.3*g.mid_score+0.4*g.final_score,2) end as total) t on true;

-- Hanya nilai yang sudah difinalisasi dihitung ke IPS/IPK
create or replace view public.v_khs with (security_invoker=true) as
select student_id, semester_id, sum(sks)::int sks, round(sum(points*sks)/nullif(sum(sks),0),2) ips
from public.v_grades where is_final and points is not null group by student_id, semester_id;
create or replace view public.v_ipk with (security_invoker=true) as
select student_id, sum(sks)::int total_sks, round(sum(points*sks)/nullif(sum(sks),0),2) ipk
from public.v_grades where is_final and points is not null group by student_id;

create or replace function public.krs_decide(p_krs uuid, p_ok boolean, p_note text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not (public.staff_of_student(public.student_of_krs(p_krs)) or exists (select 1 from public.krs k join public.students s on s.id=k.student_id
      join public.class_members m on m.student_id=s.id join public.classes c on c.id=m.class_id
      where k.id=p_krs and c.advisor_id = public.my_lecturer_id())) then raise exception 'Tidak berhak memutuskan KRS'; end if;
  if not p_ok and coalesce(trim(p_note),'')='' then raise exception 'Catatan wajib diisi saat menolak KRS'; end if;
  update public.krs set status = case when p_ok then 'disetujui' else 'ditolak' end, decided_by=auth.uid(), decided_at=now(), note=p_note
  where id=p_krs and status='diajukan';
  if not found then raise exception 'KRS tidak berstatus diajukan'; end if;
end $$;
revoke all on function public.krs_decide(uuid,boolean,text) from public, anon;
grant execute on function public.krs_decide(uuid,boolean,text) to authenticated;

-- ===== 060_praktikum =====
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

-- ===== 070_skripsi =====
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

-- ===== 080_workflows =====
-- 080_workflows.sql — alur PMB -> mahasiswa -> kelulusan -> alumni, notifikasi otomatis
insert into public.app_settings(key,value) values ('graduation_rules','{"min_sks":144,"min_ipk":2.0,"max_years_on_time":4}'::jsonb)
on conflict (key) do nothing;

create or replace function public.notify_student(p_student uuid, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path=public as $$
  insert into public.notifications(user_id,title,body,link)
  select p.id,p_title,p_body,p_link from public.students s join public.profiles p on p.nim=s.nim where s.id=p_student $$;
revoke all on function public.notify_student(uuid,text,text,text) from public, anon, authenticated;

create or replace function public.pmb_staff() returns boolean language sql stable as $$
  select public.has_role(array['super_admin','admin_universitas','admin_pmb','kaprodi','admin_prodi']) $$;
grant execute on function public.pmb_staff() to authenticated;

-- ---------- PMB ----------
create or replace function public.pmb_set_status(p_app uuid, p_to text, p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare a public.pmb_applicants; q int; used int;
begin
  if not public.pmb_staff() then raise exception 'Tidak berhak mengubah status pendaftar'; end if;
  select * into a from public.pmb_applicants where id=p_app for update;
  if a.id is null then raise exception 'Pendaftar tidak ditemukan'; end if;
  if not public.pmb_of_program(public.program_of_applicant(p_app)) then raise exception 'Pendaftar ini di luar cakupan prodi Anda'; end if;
  if (a.status,p_to) not in (('pendaftar','berkas_lengkap'),('berkas_lengkap','peserta_seleksi'),('peserta_seleksi','diterima'),
     ('peserta_seleksi','tidak_lolos'),('pendaftar','tidak_lolos'),('berkas_lengkap','tidak_lolos'),
     ('pendaftar','mengundurkan_diri'),('berkas_lengkap','mengundurkan_diri'),('peserta_seleksi','mengundurkan_diri'),('diterima','mengundurkan_diri'),
     ('berkas_lengkap','pendaftar')) then
    raise exception 'Perubahan status % -> % tidak diizinkan', a.status, p_to; end if;
  if p_to in ('tidak_lolos','mengundurkan_diri') and coalesce(trim(p_note),'')='' then raise exception 'Catatan wajib diisi'; end if;
  if p_to='berkas_lengkap' and (select count(distinct doc_type) from public.pmb_documents
       where applicant_id=p_app and verified and doc_type in ('ktp','ijazah','pas_foto')) < 3 then
    raise exception 'Berkas KTP, ijazah, dan pas foto harus sudah diunggah dan diverifikasi'; end if;
  if p_to='diterima' then
    select quota into q from public.pmb_periods where id=a.period_id;
    select count(*) into used from public.pmb_applicants where period_id=a.period_id and status in ('diterima','registrasi_ulang');
    if q is not null and used >= q then raise exception 'Kuota periode PMB sudah penuh (%)', q; end if;
  end if;
  perform set_config('synora.pmb_note', coalesce(p_note,''), true);
  update public.pmb_applicants set status=p_to, selection_note=coalesce(p_note,selection_note) where id=p_app;
end $$;
revoke all on function public.pmb_set_status(uuid,text,text) from public, anon;
grant execute on function public.pmb_set_status(uuid,text,text) to authenticated;

create or replace function public.pmb_reregister(p_app uuid, p_nim text, p_class uuid, p_date date)
returns uuid language plpgsql security definer set search_path=public as $$
declare a public.pmb_applicants; per public.pmb_periods; sid uuid; d date := coalesce(p_date,current_date); h record; mapped text;
begin
  if not public.pmb_staff() then raise exception 'Tidak berhak melakukan registrasi ulang'; end if;
  select * into a from public.pmb_applicants where id=p_app for update;
  if a.id is null then raise exception 'Pendaftar tidak ditemukan'; end if;
  if not public.pmb_of_program(public.program_of_applicant(p_app)) then raise exception 'Pendaftar ini di luar cakupan prodi Anda'; end if;
  if a.status <> 'diterima' then raise exception 'Hanya pendaftar berstatus diterima yang dapat registrasi ulang'; end if;
  if p_nim !~ '^[A-Za-z0-9._-]{3,30}$' then raise exception 'Format NIM tidak valid'; end if;
  if exists (select 1 from public.students where nim=p_nim) or exists (select 1 from public.profiles where nim=p_nim) then raise exception 'NIM % sudah dipakai', p_nim; end if;
  if exists (select 1 from public.v_invoices where applicant_id=p_app and pay_status <> 'lunas') then
    raise exception 'Masih ada tagihan PMB yang belum lunas'; end if;
  select * into per from public.pmb_periods where id=a.period_id;
  if p_class is not null and exists (select 1 from public.classes c where c.id=p_class and c.program_id is distinct from per.program_id) then
    raise exception 'Kelas yang dipilih bukan kelas prodi pendaftar'; end if;
  insert into public.students(nim,full_name,program_studi,angkatan,tanggal_masuk,status_akademik,status_changed_at,program_id,is_active)
  values (p_nim,a.full_name,coalesce((select name from public.study_programs where id=per.program_id),'Teknik Informatika'),
          extract(year from d)::int,d,'mahasiswa_baru',d,
          coalesce(per.program_id,(select id from public.study_programs where code='TI')),true)
  returning id into sid;
  -- Jejak pra-mahasiswa dibawa ke riwayat status mahasiswa (pelacakan dari PMB)
  for h in select to_status, created_at::date dt, note from public.pmb_status_history where applicant_id=p_app order by id loop
    mapped := case h.to_status when 'pendaftar' then 'pendaftar' when 'peserta_seleksi' then 'peserta_seleksi' when 'diterima' then 'diterima' else null end;
    if mapped is not null then
      insert into public.student_status_history(student_id,to_status,effective_date,reason,changed_by) values (sid,mapped,h.dt,h.note,auth.uid()); end if;
  end loop;
  insert into public.student_status_history(student_id,from_status,to_status,effective_date,reason,changed_by) values
    (sid,'diterima','registrasi_ulang',d,'Registrasi ulang PMB '||a.reg_number,auth.uid()),
    (sid,'registrasi_ulang','mahasiswa_baru',d,null,auth.uid());
  insert into public.student_study_periods(student_id,period_type,start_date) values (sid,'aktif',d);
  update public.invoices set student_id=sid where applicant_id=p_app;
  if p_class is not null then insert into public.class_members(class_id,student_id) values (p_class,sid) on conflict do nothing; end if;
  perform set_config('synora.pmb_note','Registrasi ulang, NIM '||p_nim,true);
  update public.pmb_applicants set status='registrasi_ulang', student_id=sid where id=p_app;
  return sid;
end $$;
revoke all on function public.pmb_reregister(uuid,text,uuid,date) from public, anon;
grant execute on function public.pmb_reregister(uuid,text,uuid,date) to authenticated;

-- ---------- Kelulusan ----------
create or replace function public.graduation_check(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare r jsonb; sks int; ip numeric; th text; unpaid int; ms int; mi numeric;
begin
  if not (public.view_of_student(p_student) or p_student = public.my_student_id()) then raise exception 'Tidak berhak'; end if;
  select (value->>'min_sks')::int, (value->>'min_ipk')::numeric into ms, mi from public.app_settings where key='graduation_rules';
  select coalesce(total_sks,0), ipk into sks, ip from public.v_ipk where student_id=p_student;
  select status into th from public.thesis where student_id=p_student;
  select count(*) into unpaid from public.v_invoices where student_id=p_student and pay_status <> 'lunas';
  return jsonb_build_object('total_sks',coalesce(sks,0),'min_sks',ms,'ipk',ip,'min_ipk',mi,'thesis_status',th,'unpaid_invoices',unpaid,
    'sks_ok',coalesce(sks,0)>=ms,'ipk_ok',coalesce(ip,0)>=mi,'thesis_ok',coalesce(th='selesai',false),'finance_ok',unpaid=0,
    'ok',coalesce(sks,0)>=ms and coalesce(ip,0)>=mi and coalesce(th='selesai',false) and unpaid=0);
end $$;
grant execute on function public.graduation_check(uuid) to authenticated;

create or replace function public.graduation_apply() returns void language plpgsql security definer set search_path=public as $$
declare sid uuid := public.my_student_id(); cur text;
begin
  if sid is null then raise exception 'Akun Anda tidak terhubung ke data mahasiswa'; end if;
  select status_akademik into cur from public.students where id=sid;
  if cur not in ('aktif','proses_penyelesaian','belum_memenuhi_syarat') then raise exception 'Status % tidak dapat mengajukan kelulusan', cur; end if;
  if not exists (select 1 from public.thesis where student_id=sid and status='selesai') then raise exception 'Skripsi harus berstatus selesai'; end if;
  perform public.set_student_status(sid,'mengajukan_kelulusan',current_date,'Pengajuan kelulusan oleh mahasiswa');
end $$;
grant execute on function public.graduation_apply() to authenticated;

create or replace function public.graduation_finalize(p_student uuid, p_date date, p_yudisium date, p_sk text)
returns void language plpgsql security definer set search_path=public as $$
declare c jsonb; cur text; t text;
begin
  if not public.staff_of_student(p_student) then raise exception 'Tidak berhak menetapkan kelulusan'; end if;
  select status_akademik into cur from public.students where id=p_student;
  if cur <> 'mengajukan_kelulusan' then raise exception 'Mahasiswa belum berstatus mengajukan kelulusan'; end if;
  c := public.graduation_check(p_student);
  if not (c->>'ok')::boolean then raise exception 'Syarat kelulusan belum terpenuhi: %', c::text; end if;
  select title into t from public.thesis where student_id=p_student;
  insert into public.student_graduation(student_id,graduation_date,ipk,total_sks,thesis_title,yudisium_date,sk_number)
  values (p_student,coalesce(p_date,current_date),(c->>'ipk')::numeric,(c->>'total_sks')::int,t,p_yudisium,p_sk)
  on conflict (student_id) do update set graduation_date=excluded.graduation_date, ipk=excluded.ipk, total_sks=excluded.total_sks,
    thesis_title=excluded.thesis_title, yudisium_date=excluded.yudisium_date, sk_number=excluded.sk_number;
  perform public.set_student_status(p_student,'lulus',coalesce(p_date,current_date),'Yudisium '||coalesce(p_sk,''));
end $$;
revoke all on function public.graduation_finalize(uuid,date,date,text) from public, anon;
grant execute on function public.graduation_finalize(uuid,date,date,text) to authenticated;

create or replace function public.graduation_reject(p_student uuid, p_reason text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.staff_of_student(p_student) then raise exception 'Tidak berhak'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'Alasan wajib diisi'; end if;
  if (select status_akademik from public.students where id=p_student) <> 'mengajukan_kelulusan' then raise exception 'Mahasiswa tidak sedang mengajukan kelulusan'; end if;
  perform public.set_student_status(p_student,'belum_memenuhi_syarat',current_date,p_reason);
end $$;
revoke all on function public.graduation_reject(uuid,text) from public, anon;
grant execute on function public.graduation_reject(uuid,text) to authenticated;

create or replace function public.make_alumni(p_student uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.staff_of_student(p_student) then raise exception 'Tidak berhak'; end if;
  if (select status_akademik from public.students where id=p_student) <> 'lulus' then raise exception 'Hanya lulusan yang dapat dijadikan alumni'; end if;
  perform public.set_student_status(p_student,'alumni',current_date,'Menjadi alumni');
  insert into public.alumni(student_id) values (p_student) on conflict do nothing;
end $$;
revoke all on function public.make_alumni(uuid) from public, anon;
grant execute on function public.make_alumni(uuid) to authenticated;

-- ---------- Notifikasi otomatis ke mahasiswa ----------
create or replace function public.trg_notify_krs() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status is distinct from old.status and new.status in ('disetujui','ditolak') then
    perform public.notify_student(new.student_id,'KRS '||new.status,coalesce(new.note,''),'student-portal'); end if; return new; end $$;
drop trigger if exists notify_krs on public.krs;
create trigger notify_krs after update on public.krs for each row execute function public.trg_notify_krs();
create or replace function public.trg_notify_pay() returns trigger language plpgsql security definer set search_path=public as $$
declare sid uuid;
begin
  if new.status is distinct from old.status and new.status in ('terverifikasi','ditolak') then
    select student_id into sid from public.invoices where id=new.invoice_id;
    if sid is not null then perform public.notify_student(sid,'Pembayaran '||new.status,coalesce(new.note,''),'student-portal'); end if; end if; return new; end $$;
drop trigger if exists notify_pay on public.payments;
create trigger notify_pay after update on public.payments for each row execute function public.trg_notify_pay();
create or replace function public.trg_notify_thesis() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status is distinct from old.status then
    perform public.notify_student(new.student_id,'Status skripsi: '||new.status,coalesce(new.decision_note,''),'thesis'); end if; return new; end $$;
drop trigger if exists notify_thesis on public.thesis;
create trigger notify_thesis after update on public.thesis for each row execute function public.trg_notify_thesis();
create or replace function public.trg_notify_status() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status_akademik is distinct from old.status_akademik then
    perform public.notify_student(new.id,'Status akademik: '||new.status_akademik,coalesce(nullif(current_setting('synora.status_reason',true),''),''),'student-portal'); end if; return null; end $$;
drop trigger if exists notify_status on public.students;
create trigger notify_status after update on public.students for each row execute function public.trg_notify_status();

-- ===== 085_scope =====
-- =====================================================================
-- 085_scope.sql — Cakupan akses per Prodi/Fakultas/Universitas + kalender berjenjang
-- Dijalankan SETELAH 080 dan SEBELUM 090 (semua tabel sudah ada). Aman dijalankan ulang.
--   Jenjang: universitas (admin_universitas, super_admin) > fakultas (dekan) > prodi (kaprodi, admin_prodi,
--   admin_pmb, admin_keuangan) > kelas (km, sekretaris).
-- =====================================================================

-- ---- cakupan per akun: satu baris per pengguna (prodi ATAU fakultas) ----
create table if not exists public.user_scopes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  faculty_id uuid references public.faculties(id) on delete cascade,
  program_id uuid references public.study_programs(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (not (faculty_id is not null and program_id is not null)));
alter table public.user_scopes enable row level security;
revoke all on public.user_scopes from anon, authenticated;
grant select on public.user_scopes to authenticated;
drop policy if exists scopes_select on public.user_scopes;
create policy scopes_select on public.user_scopes for select to authenticated
  using (user_id = auth.uid() or public.has_role(array['super_admin']));

-- ---- penghubung dasar ----
create or replace function public.faculty_of_program(p uuid) returns uuid language sql stable security definer set search_path=public as $$
  select faculty_id from public.study_programs where id=p $$;
create or replace function public.is_uni_wide() returns boolean language sql stable as $$
  select public.has_role(array['super_admin','admin_universitas']) $$;
create or replace function public.my_scope_faculty() returns uuid language sql stable security definer set search_path=public as $$
  select coalesce(us.faculty_id, sp.faculty_id) from public.user_scopes us left join public.study_programs sp on sp.id=us.program_id where us.user_id=auth.uid() $$;
create or replace function public.my_scope_program() returns uuid language sql stable security definer set search_path=public as $$
  select program_id from public.user_scopes where user_id=auth.uid() $$;

-- Apakah prodi p termasuk cakupan pemanggil? (universitas: semua; fakultas: prodi di fakultasnya; prodi: prodinya)
create or replace function public.program_in_scope(p uuid) returns boolean language sql stable security definer set search_path=public as $$
  select public.is_uni_wide() or (p is not null and exists (
    select 1 from public.user_scopes us where us.user_id=auth.uid() and (
      us.program_id = p
      or (us.program_id is null and us.faculty_id is not null and us.faculty_id = (select faculty_id from public.study_programs where id=p))))) $$;

-- ---- peran + cakupan ----
create or replace function public.staff_of_program(p uuid) returns boolean language sql stable as $$
  select public.has_role(array['super_admin','admin_universitas','kaprodi','admin_prodi']) and public.program_in_scope(p) $$;
create or replace function public.view_of_program(p uuid) returns boolean language sql stable as $$
  select public.has_role(array['super_admin','admin_universitas','kaprodi','admin_prodi','dekan']) and public.program_in_scope(p) $$;
create or replace function public.pmb_of_program(p uuid) returns boolean language sql stable as $$
  select public.has_role(array['super_admin','admin_universitas','admin_pmb','kaprodi','admin_prodi']) and public.program_in_scope(p) $$;
create or replace function public.pmb_view_of_program(p uuid) returns boolean language sql stable as $$
  select public.has_role(array['super_admin','admin_universitas','admin_pmb','kaprodi','admin_prodi','admin_keuangan','dekan']) and public.program_in_scope(p) $$;
create or replace function public.fin_of_program(p uuid) returns boolean language sql stable as $$
  select public.has_role(array['super_admin','admin_universitas','admin_keuangan']) and public.program_in_scope(p) $$;
create or replace function public.fin_view_of_program(p uuid) returns boolean language sql stable as $$
  select public.has_role(array['super_admin','admin_universitas','admin_keuangan','kaprodi','admin_prodi','dekan']) and public.program_in_scope(p) $$;

-- ---- baris -> prodi ----
create or replace function public.program_of_student(sid uuid) returns uuid language sql stable security definer set search_path=public as $$
  select program_id from public.students where id=sid $$;
create or replace function public.program_of_class(cid uuid) returns uuid language sql stable security definer set search_path=public as $$
  select program_id from public.classes where id=cid $$;
create or replace function public.program_of_course(cid uuid) returns uuid language sql stable security definer set search_path=public as $$
  select program_id from public.courses where id=cid $$;
create or replace function public.program_of_lab(lid uuid) returns uuid language sql stable security definer set search_path=public as $$
  select program_id from public.labs where id=lid $$;
create or replace function public.program_of_period(pid uuid) returns uuid language sql stable security definer set search_path=public as $$
  select program_id from public.pmb_periods where id=pid $$;
create or replace function public.program_of_applicant(aid uuid) returns uuid language sql stable security definer set search_path=public as $$
  select pp.program_id from public.pmb_applicants a join public.pmb_periods pp on pp.id=a.period_id where a.id=aid $$;
create or replace function public.program_of_invoice(iid uuid) returns uuid language sql stable security definer set search_path=public as $$
  select coalesce(s.program_id, public.program_of_applicant(i.applicant_id)) from public.invoices i left join public.students s on s.id=i.student_id where i.id=iid $$;
create or replace function public.program_of_payment(pid uuid) returns uuid language sql stable security definer set search_path=public as $$
  select public.program_of_invoice(invoice_id) from public.payments where id=pid $$;
create or replace function public.program_of_session(sid uuid) returns uuid language sql stable security definer set search_path=public as $$
  select c.program_id from public.practicum_sessions ps join public.classes c on c.id=ps.class_id where ps.id=sid $$;
create or replace function public.student_of_krs(kid uuid) returns uuid language sql stable security definer set search_path=public as $$
  select student_id from public.krs where id=kid $$;
create or replace function public.student_of_item(iid uuid) returns uuid language sql stable security definer set search_path=public as $$
  select k.student_id from public.krs_items i join public.krs k on k.id=i.krs_id where i.id=iid $$;
create or replace function public.student_of_thesis(tid uuid) returns uuid language sql stable security definer set search_path=public as $$
  select student_id from public.thesis where id=tid $$;

create or replace function public.staff_of_student(sid uuid) returns boolean language sql stable as $$ select public.staff_of_program(public.program_of_student(sid)) $$;
create or replace function public.view_of_student(sid uuid) returns boolean language sql stable as $$ select public.view_of_program(public.program_of_student(sid)) $$;

-- ---- kelas milik pemanggil (anggota, pembimbing akademik, atau pengampu) ----
create or replace function public.my_class_ids() returns setof uuid language sql stable security definer set search_path=public as $$
  select class_id from public.class_members where student_id = public.my_student_id()
  union select id from public.classes where advisor_id = public.my_lecturer_id()
  union select class_id from public.teaching_assignments where lecturer_id = public.my_lecturer_id() and class_id is not null $$;
create or replace function public.student_in_my_classes(sid uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.class_members m where m.student_id=sid and m.class_id in (select public.my_class_ids())) $$;
create or replace function public.session_in_my_classes(sid uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.practicum_sessions ps where ps.id=sid and ps.class_id in (select public.my_class_ids())) $$;
create or replace function public.my_class_program() returns uuid language sql stable security definer set search_path=public as $$
  select c.program_id from public.classes c where c.id in (select public.my_class_ids()) order by c.created_at limit 1 $$;

-- Konteks prodi/fakultas pemanggil untuk agenda: mahasiswa -> prodinya; dosen -> prodi dosen; staf -> cakupan
create or replace function public.my_ctx_program() returns uuid language sql stable security definer set search_path=public as $$
  select coalesce(public.program_of_student(public.my_student_id()),
                  (select program_id from public.lecturers where user_id=auth.uid()),
                  public.my_scope_program()) $$;
create or replace function public.my_ctx_faculty() returns uuid language sql stable security definer set search_path=public as $$
  select coalesce(public.faculty_of_program(public.my_ctx_program()), public.my_scope_faculty()) $$;

grant execute on function public.faculty_of_program(uuid), public.is_uni_wide(), public.my_scope_faculty(), public.my_scope_program(),
  public.program_in_scope(uuid), public.staff_of_program(uuid), public.view_of_program(uuid), public.pmb_of_program(uuid),
  public.pmb_view_of_program(uuid), public.fin_of_program(uuid), public.fin_view_of_program(uuid),
  public.program_of_student(uuid), public.program_of_class(uuid), public.program_of_course(uuid), public.program_of_lab(uuid),
  public.program_of_period(uuid), public.program_of_applicant(uuid), public.program_of_invoice(uuid), public.program_of_payment(uuid),
  public.program_of_session(uuid), public.student_of_krs(uuid), public.student_of_item(uuid), public.student_of_thesis(uuid),
  public.staff_of_student(uuid), public.view_of_student(uuid), public.my_class_ids(), public.student_in_my_classes(uuid),
  public.session_in_my_classes(uuid), public.my_class_program(), public.my_ctx_program(), public.my_ctx_faculty() to authenticated;

-- ---- data lama (satu prodi: TI) dikaitkan ke prodi TI, sekali saja ----
update public.courses set program_id=(select id from public.study_programs where code='TI') where program_id is null;
update public.lecturers set program_id=(select id from public.study_programs where code='TI') where program_id is null;
update public.labs set program_id=(select id from public.study_programs where code='TI') where program_id is null;
update public.classes set program_id=(select id from public.study_programs where code='TI') where program_id is null;
update public.pmb_periods set program_id=(select id from public.study_programs where code='TI') where program_id is null;
-- Staf akademik yang sudah ada dibatasi ke TI (sebelumnya sistem hanya melayani satu prodi)
insert into public.user_scopes(user_id, program_id)
select ur.user_id, (select id from public.study_programs where code='TI') from public.user_roles ur
where ur.role in ('admin_prodi','admin_pmb','admin_keuangan','kaprodi') on conflict (user_id) do nothing;

-- Kelas TI24D untuk data kelas yang sudah ada (hanya dibuat jika belum ada)
do $$ declare cid uuid; begin
  if not exists (select 1 from public.classes where name='TI24D') then
    insert into public.classes(program_id,name,angkatan) values ((select id from public.study_programs where code='TI'),'TI24D',2024) returning id into cid;
    insert into public.class_members(class_id,student_id)
      select cid, s.id from public.students s where s.program_id=(select id from public.study_programs where code='TI') on conflict do nothing;
  end if; end $$;

-- ---- kelas/prodi otomatis untuk data yang dibuat KM/Sekretaris ----
create or replace function public.trg_default_program() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.program_id is null and public.has_role(array['km','sekretaris']) then new.program_id := public.my_class_program(); end if;
  return new; end $$;
drop trigger if exists default_program_courses on public.courses;
create trigger default_program_courses before insert on public.courses for each row execute function public.trg_default_program();
drop trigger if exists default_program_lecturers on public.lecturers;
create trigger default_program_lecturers before insert on public.lecturers for each row execute function public.trg_default_program();
drop trigger if exists default_program_students on public.students;
create trigger default_program_students before insert on public.students for each row execute function public.trg_default_program();
create or replace function public.trg_student_autoclass() returns trigger language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  if public.has_role(array['km','sekretaris']) then
    select c into cid from (select public.my_class_ids() c) x limit 1;
    if cid is not null then insert into public.class_members(class_id,student_id) values (cid,new.id) on conflict do nothing; end if;
  end if; return null; end $$;
drop trigger if exists autoclass_students on public.students;
create trigger autoclass_students after insert on public.students for each row execute function public.trg_student_autoclass();

-- ---- kalender berjenjang ----
alter table public.academic_events
  add column if not exists level text not null default 'kelas',
  add column if not exists class_id uuid references public.classes(id) on delete cascade,
  add column if not exists program_id uuid references public.study_programs(id) on delete cascade,
  add column if not exists faculty_id uuid references public.faculties(id) on delete cascade;
update public.academic_events set class_id=(select id from public.classes where name='TI24D')
 where level='kelas' and class_id is null and exists (select 1 from public.classes where name='TI24D');
-- agenda lama yang belum bisa dikaitkan ke kelas dijadikan agenda universitas agar tidak hilang
update public.academic_events set level='universitas' where level='kelas' and class_id is null;
alter table public.academic_events drop constraint if exists academic_events_level_check;
alter table public.academic_events add constraint academic_events_level_check check (
  (level='kelas' and class_id is not null and program_id is null and faculty_id is null) or
  (level='prodi' and program_id is not null and class_id is null and faculty_id is null) or
  (level='fakultas' and faculty_id is not null and class_id is null and program_id is null) or
  (level='universitas' and class_id is null and program_id is null and faculty_id is null));
create index if not exists ix_events_level on public.academic_events(level, start_at);

-- Siapa boleh MELIHAT agenda: agenda tingkat atas tampil ke bawah. Universitas melihat semuanya.
create or replace function public.event_visible(p_level text, p_class uuid, p_program uuid, p_faculty uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select case
    when public.app_role() is null then false
    when public.is_uni_wide() then true
    when p_level='universitas' then true
    when p_level='fakultas' then p_faculty is not null and p_faculty = public.my_ctx_faculty()
    when p_level='prodi' then p_program is not null and p_program = public.my_ctx_program()
    when p_level='kelas' then p_class in (select public.my_class_ids())
    else false end $$;
-- Siapa boleh MENULIS agenda di jenjang tertentu
create or replace function public.event_writable(p_level text, p_class uuid, p_program uuid, p_faculty uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select public.is_uni_wide()
    or (p_level='kelas' and public.has_role(array['km','sekretaris']) and p_class in (select public.my_class_ids()))
    or (p_level='prodi' and public.has_role(array['kaprodi','admin_prodi']) and public.program_in_scope(p_program))
    or (p_level='fakultas' and public.has_role(array['dekan']) and p_faculty is not null and p_faculty = public.my_scope_faculty()) $$;
grant execute on function public.event_visible(text,uuid,uuid,uuid), public.event_writable(text,uuid,uuid,uuid) to authenticated;

-- ---- daftar prodi yang boleh dikelola pemanggil (dipakai pilihan di aplikasi) ----
create or replace view public.v_my_programs with (security_invoker=true) as
select p.id, p.code, p.name, p.level, p.faculty_id, f.name as faculty_name, f.code as faculty_code
from public.study_programs p left join public.faculties f on f.id=p.faculty_id
where public.program_in_scope(p.id) and p.is_active;
create or replace view public.v_my_classes with (security_invoker=true) as
select c.id, c.name, c.program_id, c.angkatan from public.classes c where c.id in (select public.my_class_ids());
create or replace function public.my_scope() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('role', public.app_role(), 'uni_wide', public.is_uni_wide(),
    'faculty_id', public.my_scope_faculty(), 'program_id', public.my_scope_program(),
    'student_id', public.my_student_id(), 'ctx_program', public.my_ctx_program(), 'ctx_faculty', public.my_ctx_faculty()) $$;
grant select on public.v_my_programs, public.v_my_classes to authenticated;
grant execute on function public.my_scope() to authenticated;

-- ===== 090_rls =====
-- =====================================================================
-- 090_rls.sql — RLS semua tabel modul Academic + bucket 'academic'
-- Aman dijalankan ulang: hanya menghapus policy tabel milik file ini (dan 4 policy dasar yang diperketat).
-- =====================================================================
create or replace function public.safe_uuid(t text) returns uuid language plpgsql immutable as $$
begin return t::uuid; exception when others then return null; end $$;

create or replace function public.lecturer_teaches_item(p_item uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.krs_items i join public.krs k on k.id=i.krs_id
    where i.id=p_item and public.my_lecturer_id() is not null and (
      exists (select 1 from public.teaching_assignments ta where ta.course_id=i.course_id and ta.semester_id=k.semester_id and ta.lecturer_id=public.my_lecturer_id())
      or exists (select 1 from public.courses c where c.id=i.course_id and c.lecturer_id=public.my_lecturer_id()))) $$;
create or replace function public.lecturer_sees_krs(p_krs uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.krs k where k.id=p_krs and public.my_lecturer_id() is not null and (
     exists (select 1 from public.krs_items i where i.krs_id=k.id and public.lecturer_teaches_item(i.id))
     or exists (select 1 from public.class_members m join public.classes c on c.id=m.class_id where m.student_id=k.student_id and c.advisor_id=public.my_lecturer_id()))) $$;
create or replace function public.student_in_my_class(p_student uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.class_members m join public.classes c on c.id=m.class_id
    where m.student_id=p_student and (c.advisor_id=public.my_lecturer_id()
      or exists (select 1 from public.practicum_sessions ps where ps.class_id=c.id and ps.assistant_id=public.my_student_id()))) $$;
grant execute on function public.lecturer_teaches_item(uuid), public.lecturer_sees_krs(uuid), public.student_in_my_class(uuid), public.safe_uuid(text) to authenticated;

-- kebijakan dasar kelas yang digantikan versi berjenjang (KM/dosen tidak lagi melihat seluruh universitas)
drop policy if exists students_select on public.students; drop policy if exists students_write on public.students;
drop policy if exists lecturers_select on public.lecturers; drop policy if exists lecturers_write on public.lecturers;
drop policy if exists courses_select on public.courses; drop policy if exists courses_write on public.courses;
drop policy if exists schedules_select on public.schedules; drop policy if exists schedules_write on public.schedules;
drop policy if exists events_select on public.academic_events; drop policy if exists events_write on public.academic_events;

-- hapus policy lama milik modul ini (idempoten)
do $$ declare p record; begin
  for p in select tablename, policyname from pg_policies where schemaname='public' and policyname like 'acad\_%' loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename); end loop; end $$;

do $$ declare t text; begin
  foreach t in array array['student_status_history','student_study_periods','student_graduation','alumni','faculties','study_programs','academic_years',
   'semesters','classes','class_members','teaching_assignments','pmb_periods','pmb_applicants','pmb_documents','pmb_status_history',
   'fee_types','invoices','payments','krs','krs_items','grades','labs','lab_assistants','practicum_sessions','practicum_attendance',
   'practicum_scores','thesis','thesis_supervisors','thesis_guidance','thesis_defenses','thesis_files'] loop
    execute format('alter table public.%I enable row level security', t); end loop; end $$;

do $$ declare t text; begin
  foreach t in array array['student_status_history','student_study_periods','student_graduation','alumni','faculties','study_programs','academic_years',
   'semesters','classes','class_members','teaching_assignments','pmb_periods','pmb_applicants','pmb_documents','pmb_status_history',
   'fee_types','invoices','payments','krs','krs_items','grades','labs','lab_assistants','practicum_sessions','practicum_attendance',
   'practicum_scores','thesis','thesis_supervisors','thesis_guidance','thesis_defenses','thesis_files'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t); end loop; end $$;
grant usage, select on sequence public.pmb_reg_seq, public.invoice_seq to authenticated;
-- Tabel yang HANYA boleh diubah lewat fungsi (jejak tidak boleh dipalsukan dari klien)
revoke insert, update, delete on public.student_status_history, public.student_study_periods, public.student_graduation, public.pmb_status_history from authenticated;
revoke update on public.payments from authenticated;
revoke insert, update on public.grades from authenticated;
revoke update (status, decision_note, decided_by) on public.thesis from authenticated;
revoke update on public.krs from authenticated; grant update (note) on public.krs to authenticated;
-- students: status_akademik hanya lewat fungsi; kolom lain tetap seperti sebelumnya
revoke insert, update on public.students from authenticated;
grant insert (id, nim, full_name, program_studi, is_active, angkatan, tanggal_masuk, program_id) on public.students to authenticated;
grant update (nim, full_name, program_studi, is_active, angkatan, tanggal_masuk, program_id) on public.students to authenticated;
-- pmb_applicants: status/student_id/reg_number hanya lewat fungsi/trigger
revoke insert, update on public.pmb_applicants from authenticated;
grant insert (id, period_id, full_name, gender, birth_place, birth_date, phone, email, address, school_origin, school_major, grad_year, test_score, created_by) on public.pmb_applicants to authenticated;
grant update (full_name, gender, birth_place, birth_date, phone, email, address, school_origin, school_major, grad_year, test_score, selection_note) on public.pmb_applicants to authenticated;
-- payments: klien hanya boleh mengisi data pembayaran, status default 'menunggu'
revoke insert on public.payments from authenticated;
grant insert (id, invoice_id, amount, paid_at, method, proof_path, note, submitted_by) on public.payments to authenticated;
-- thesis: judul/abstrak saja; status lewat fungsi
revoke insert on public.thesis from authenticated;
grant insert (id, student_id, title, abstract) on public.thesis to authenticated;
revoke insert, update on public.thesis_guidance from authenticated;
grant insert (id, thesis_id, guidance_date, topic, notes, file_path, created_by) on public.thesis_guidance to authenticated;
revoke update on public.thesis_defenses from authenticated; grant update on public.thesis_defenses to authenticated;

-- ---- perketat policy dasar agar role baru tidak ikut "app_role() is not null" ----
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role(array['km','sekretaris','bendahara','dosen','super_admin','admin_prodi','admin_pmb','admin_keuangan','kaprodi','dekan','admin_universitas']));
drop policy if exists roles_select on public.user_roles;
create policy roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(array['km','super_admin','admin_prodi','admin_universitas']));
drop policy if exists synora_chat_insert on storage.objects;
create policy synora_chat_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat' and public.has_role(array['km','sekretaris','bendahara','dosen']));

-- ---- master akademik ----
-- Dibaca semua pengguna aktif. Struktur universitas (fakultas, prodi, tahun ajaran, semester) hanya diubah tingkat universitas.
do $$ declare t text; begin
  foreach t in array array['faculties','study_programs','academic_years','semesters','classes','teaching_assignments','labs','fee_types'] loop
    execute format($f$create policy acad_%1$s_sel on public.%1$I for select to authenticated using (public.app_role() is not null)$f$, t);
  end loop;
  foreach t in array array['faculties','study_programs','academic_years','semesters'] loop
    execute format($f$create policy acad_%1$s_w on public.%1$I for all to authenticated using (public.is_uni_wide()) with check (public.is_uni_wide())$f$, t);
  end loop;
end $$;
create policy acad_classes_w on public.classes for all to authenticated
  using (public.staff_of_program(program_id)) with check (public.staff_of_program(program_id));
create policy acad_teaching_assignments_w on public.teaching_assignments for all to authenticated
  using (public.staff_of_program(public.program_of_course(course_id))) with check (public.staff_of_program(public.program_of_course(course_id)));
create policy acad_labs_w on public.labs for all to authenticated
  using (public.staff_of_program(program_id)) with check (public.staff_of_program(program_id));
create policy acad_lab_assistants_sel on public.lab_assistants for select to authenticated using (public.app_role() is not null);
create policy acad_lab_assistants_w on public.lab_assistants for all to authenticated
  using (public.staff_of_program(public.program_of_lab(lab_id))) with check (public.staff_of_program(public.program_of_lab(lab_id)));
create policy acad_fee_types_w on public.fee_types for all to authenticated
  using (public.has_role(array['super_admin','admin_universitas','admin_keuangan'])) with check (public.has_role(array['super_admin','admin_universitas','admin_keuangan']));
create policy acad_class_members_sel on public.class_members for select to authenticated
  using (public.view_of_program(public.program_of_class(class_id)) or student_id = public.my_student_id()
         or class_id in (select public.my_class_ids()));
create policy acad_class_members_w on public.class_members for all to authenticated
  using (public.staff_of_program(public.program_of_class(class_id))) with check (public.staff_of_program(public.program_of_class(class_id)));

-- ---- tabel dasar kelas: baca semua; tulis: staf prodi terkait, atau KM/Sekretaris untuk prodinya sendiri ----
create policy acad_courses_sel on public.courses for select to authenticated using (public.app_role() is not null
  and (public.app_role() not in ('mahasiswa','asisten_lab','km','sekretaris','bendahara') or program_id is null
       or program_id = coalesce(public.program_of_student(public.my_student_id()), public.my_class_program())));
create policy acad_courses_w on public.courses for all to authenticated
  using (public.staff_of_program(program_id) or (public.has_role(array['km','sekretaris']) and program_id = public.my_class_program()))
  with check (public.staff_of_program(program_id) or (public.has_role(array['km','sekretaris']) and program_id = public.my_class_program()));
create policy acad_lecturers_sel on public.lecturers for select to authenticated using (public.app_role() is not null);
create policy acad_lecturers_w on public.lecturers for all to authenticated
  using (public.staff_of_program(program_id) or (public.has_role(array['km','sekretaris']) and program_id = public.my_class_program()))
  with check (public.staff_of_program(program_id) or (public.has_role(array['km','sekretaris']) and program_id = public.my_class_program()));
create policy acad_schedules_sel on public.schedules for select to authenticated using (public.app_role() is not null);
create policy acad_schedules_w on public.schedules for all to authenticated
  using (public.staff_of_program(public.program_of_course(course_id)) or (public.has_role(array['km','sekretaris']) and public.program_of_course(course_id) = public.my_class_program()))
  with check (public.staff_of_program(public.program_of_course(course_id)) or (public.has_role(array['km','sekretaris']) and public.program_of_course(course_id) = public.my_class_program()));
-- mahasiswa: dosen/KM/Sekretaris/Bendahara hanya melihat teman sekelasnya; staf melihat prodi dalam cakupannya
create policy acad_students_sel on public.students for select to authenticated
  using (( public.has_role(array['super_admin','admin_universitas','kaprodi','admin_prodi','dekan','admin_pmb','admin_keuangan']) and public.program_in_scope(program_id) )
         or id = public.my_student_id() or public.student_in_my_classes(id) or public.student_in_my_class(id));
create policy acad_students_w on public.students for all to authenticated
  using (public.staff_of_program(program_id) or (public.has_role(array['km','sekretaris']) and public.student_in_my_classes(id)))
  with check (public.staff_of_program(program_id) or (public.has_role(array['km','sekretaris']) and program_id = public.my_class_program()));

-- ---- lifecycle ----
create policy acad_ssh_sel on public.student_status_history for select to authenticated
  using (public.view_of_student(student_id) or (public.has_role(array['dosen']) and public.student_in_my_classes(student_id)) or student_id = public.my_student_id());
create policy acad_ssp_sel on public.student_study_periods for select to authenticated
  using (public.view_of_student(student_id) or student_id = public.my_student_id());
create policy acad_sg_sel on public.student_graduation for select to authenticated
  using (public.view_of_student(student_id) or (public.has_role(array['dosen']) and public.student_in_my_classes(student_id)) or student_id = public.my_student_id());
create policy acad_alumni_sel on public.alumni for select to authenticated
  using (public.view_of_student(student_id) or student_id = public.my_student_id());
create policy acad_alumni_w on public.alumni for all to authenticated using (public.staff_of_student(student_id)) with check (public.staff_of_student(student_id));
create policy acad_alumni_self on public.alumni for update to authenticated using (student_id = public.my_student_id()) with check (student_id = public.my_student_id());

-- ---- PMB (per prodi pada periode) ----
create policy acad_pp_sel on public.pmb_periods for select to authenticated using (public.pmb_view_of_program(program_id));
create policy acad_pp_w on public.pmb_periods for all to authenticated using (public.pmb_of_program(program_id)) with check (public.pmb_of_program(program_id));
create policy acad_pa_sel on public.pmb_applicants for select to authenticated using (public.pmb_view_of_program(public.program_of_period(period_id)));
create policy acad_pa_ins on public.pmb_applicants for insert to authenticated with check (public.pmb_of_program(public.program_of_period(period_id)));
create policy acad_pa_upd on public.pmb_applicants for update to authenticated using (public.pmb_of_program(public.program_of_period(period_id))) with check (public.pmb_of_program(public.program_of_period(period_id)));
create policy acad_pa_del on public.pmb_applicants for delete to authenticated using (public.has_role(array['super_admin']) and status = 'pendaftar');
create policy acad_pd_sel on public.pmb_documents for select to authenticated using (public.pmb_of_program(public.program_of_applicant(applicant_id)));
create policy acad_pd_w on public.pmb_documents for all to authenticated using (public.pmb_of_program(public.program_of_applicant(applicant_id))) with check (public.pmb_of_program(public.program_of_applicant(applicant_id)));
create policy acad_psh_sel on public.pmb_status_history for select to authenticated using (public.pmb_of_program(public.program_of_applicant(applicant_id)));

-- ---- keuangan mahasiswa ----
create policy acad_inv_sel on public.invoices for select to authenticated
  using (public.fin_view_of_program(coalesce(public.program_of_student(student_id), public.program_of_applicant(applicant_id)))
         or (applicant_id is not null and public.pmb_of_program(public.program_of_applicant(applicant_id))) or student_id = public.my_student_id());
create policy acad_inv_w on public.invoices for all to authenticated
  using (public.fin_of_program(coalesce(public.program_of_student(student_id), public.program_of_applicant(applicant_id))))
  with check (public.fin_of_program(coalesce(public.program_of_student(student_id), public.program_of_applicant(applicant_id))));
create policy acad_pay_sel on public.payments for select to authenticated
  using (public.fin_view_of_program(public.program_of_invoice(invoice_id)) or exists (select 1 from public.invoices i where i.id=invoice_id and
        (i.student_id = public.my_student_id() or (i.applicant_id is not null and public.pmb_of_program(public.program_of_applicant(i.applicant_id))))));
create policy acad_pay_ins on public.payments for insert to authenticated
  with check (submitted_by = auth.uid() and (public.fin_of_program(public.program_of_invoice(invoice_id)) or
        exists (select 1 from public.invoices i where i.id=invoice_id and
           (i.student_id = public.my_student_id() or (i.applicant_id is not null and public.pmb_of_program(public.program_of_applicant(i.applicant_id)))))));
create policy acad_pay_del on public.payments for delete to authenticated using (public.has_role(array['super_admin']));

-- ---- KRS & nilai ----
create policy acad_krs_sel on public.krs for select to authenticated
  using (public.view_of_student(student_id) or student_id = public.my_student_id() or public.lecturer_sees_krs(id));
create policy acad_krs_ins on public.krs for insert to authenticated with check (student_id = public.my_student_id() and status = 'draft');
create policy acad_krs_upd on public.krs for update to authenticated using (public.staff_of_student(student_id) or student_id = public.my_student_id()) with check (public.staff_of_student(student_id) or student_id = public.my_student_id());
create policy acad_krs_del on public.krs for delete to authenticated using (public.staff_of_student(student_id) or (student_id = public.my_student_id() and status = 'draft'));
create policy acad_ki_sel on public.krs_items for select to authenticated
  using (public.view_of_student(public.student_of_krs(krs_id)) or public.lecturer_teaches_item(id) or exists (select 1 from public.krs k where k.id=krs_id and (k.student_id = public.my_student_id() or public.lecturer_sees_krs(k.id))));
create policy acad_ki_w on public.krs_items for all to authenticated
  using (public.staff_of_student(public.student_of_krs(krs_id)) or exists (select 1 from public.krs k where k.id=krs_id and k.student_id = public.my_student_id() and k.status in ('draft','ditolak')))
  with check (public.staff_of_student(public.student_of_krs(krs_id)) or exists (select 1 from public.krs k where k.id=krs_id and k.student_id = public.my_student_id() and k.status in ('draft','ditolak')));
create policy acad_gr_sel on public.grades for select to authenticated
  using (public.view_of_student(public.student_of_item(krs_item_id)) or public.lecturer_teaches_item(krs_item_id) or
         (is_final and exists (select 1 from public.krs_items i join public.krs k on k.id=i.krs_id where i.id=krs_item_id and k.student_id = public.my_student_id())));

-- ---- praktikum ----
create policy acad_ps_sel on public.practicum_sessions for select to authenticated
  using (public.view_of_program(public.program_of_class(class_id)) or (public.has_role(array['dosen']) and class_id in (select public.my_class_ids())) or assistant_id = public.my_student_id()
     or exists (select 1 from public.class_members m where m.class_id = practicum_sessions.class_id and m.student_id = public.my_student_id()));
create policy acad_ps_w on public.practicum_sessions for all to authenticated
  using (public.staff_of_program(public.program_of_class(class_id)) or (public.has_role(array['dosen']) and class_id in (select public.my_class_ids())))
  with check (public.staff_of_program(public.program_of_class(class_id)) or (public.has_role(array['dosen']) and class_id in (select public.my_class_ids())));
create policy acad_pat_sel on public.practicum_attendance for select to authenticated
  using (public.view_of_program(public.program_of_session(session_id)) or (public.has_role(array['dosen']) and public.session_in_my_classes(session_id)) or student_id = public.my_student_id() or public.is_session_assistant(session_id));
create policy acad_pat_w on public.practicum_attendance for all to authenticated
  using (public.staff_of_program(public.program_of_session(session_id)) or (public.has_role(array['dosen']) and public.session_in_my_classes(session_id)) or public.is_session_assistant(session_id))
  with check (public.staff_of_program(public.program_of_session(session_id)) or (public.has_role(array['dosen']) and public.session_in_my_classes(session_id)) or public.is_session_assistant(session_id));
create policy acad_psc_sel on public.practicum_scores for select to authenticated
  using (public.view_of_program(public.program_of_session(session_id)) or (public.has_role(array['dosen']) and public.session_in_my_classes(session_id)) or student_id = public.my_student_id() or public.is_session_assistant(session_id));
create policy acad_psc_w on public.practicum_scores for all to authenticated
  using (public.staff_of_program(public.program_of_session(session_id)) or (public.has_role(array['dosen']) and public.session_in_my_classes(session_id)) or public.is_session_assistant(session_id))
  with check (public.staff_of_program(public.program_of_session(session_id)) or (public.has_role(array['dosen']) and public.session_in_my_classes(session_id)) or public.is_session_assistant(session_id));

-- ---- skripsi ----
create policy acad_th_sel on public.thesis for select to authenticated
  using (public.view_of_student(student_id) or student_id = public.my_student_id() or public.is_thesis_supervisor(id));
create policy acad_th_ins on public.thesis for insert to authenticated with check (student_id = public.my_student_id());
create policy acad_th_upd on public.thesis for update to authenticated
  using (public.staff_of_student(student_id) or (student_id = public.my_student_id() and status in ('diajukan','revisi_judul')))
  with check (public.staff_of_student(student_id) or (student_id = public.my_student_id() and status in ('diajukan','revisi_judul')));
create policy acad_th_del on public.thesis for delete to authenticated using (public.has_role(array['super_admin']));
create policy acad_ts_sel on public.thesis_supervisors for select to authenticated
  using (public.view_of_student(public.student_of_thesis(thesis_id)) or public.is_thesis_owner(thesis_id) or lecturer_id = public.my_lecturer_id());
create policy acad_ts_w on public.thesis_supervisors for all to authenticated using (public.staff_of_student(public.student_of_thesis(thesis_id))) with check (public.staff_of_student(public.student_of_thesis(thesis_id)));
create policy acad_tg_sel on public.thesis_guidance for select to authenticated
  using (public.view_of_student(public.student_of_thesis(thesis_id)) or public.is_thesis_owner(thesis_id) or public.is_thesis_supervisor(thesis_id));
create policy acad_tg_ins on public.thesis_guidance for insert to authenticated
  with check (created_by = auth.uid() and public.is_thesis_owner(thesis_id));
create policy acad_tg_del on public.thesis_guidance for delete to authenticated
  using (public.staff_of_student(public.student_of_thesis(thesis_id)) or (public.is_thesis_owner(thesis_id) and status = 'diajukan'));
create policy acad_td_sel on public.thesis_defenses for select to authenticated
  using (public.view_of_student(public.student_of_thesis(thesis_id)) or public.is_thesis_owner(thesis_id) or public.is_thesis_supervisor(thesis_id)
         or examiner1_id = public.my_lecturer_id() or examiner2_id = public.my_lecturer_id());
create policy acad_td_w on public.thesis_defenses for all to authenticated using (public.staff_of_student(public.student_of_thesis(thesis_id))) with check (public.staff_of_student(public.student_of_thesis(thesis_id)));
create policy acad_tf_sel on public.thesis_files for select to authenticated
  using (public.view_of_student(public.student_of_thesis(thesis_id)) or public.is_thesis_owner(thesis_id) or public.is_thesis_supervisor(thesis_id));
create policy acad_tf_ins on public.thesis_files for insert to authenticated
  with check (uploaded_by = auth.uid() and (public.staff_of_student(public.student_of_thesis(thesis_id)) or public.is_thesis_owner(thesis_id) or public.is_thesis_supervisor(thesis_id)));
create policy acad_tf_del on public.thesis_files for delete to authenticated using (public.staff_of_student(public.student_of_thesis(thesis_id)) or (public.is_thesis_owner(thesis_id) and uploaded_by = auth.uid()));

-- ---- kalender akademik berjenjang (kelas < prodi < fakultas < universitas) ----
create policy acad_events_sel on public.academic_events for select to authenticated using (public.event_visible(level, class_id, program_id, faculty_id));
create policy acad_events_ins on public.academic_events for insert to authenticated
  with check (created_by = auth.uid() and public.event_writable(level, class_id, program_id, faculty_id));
create policy acad_events_upd on public.academic_events for update to authenticated
  using (public.event_writable(level, class_id, program_id, faculty_id)) with check (public.event_writable(level, class_id, program_id, faculty_id));
create policy acad_events_del on public.academic_events for delete to authenticated using (public.event_writable(level, class_id, program_id, faculty_id));

-- ---- Storage: bucket privat 'academic' (pmb/<applicant>/..., payments/<invoice>/..., thesis/<thesis>/...) ----
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values
 ('academic','academic',false,20971520,array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg','image/webp'])
on conflict (id) do update set file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types, public=false;

create or replace function public.academic_file_ok(p_name text, p_write boolean) returns boolean language plpgsql stable security definer set search_path=public as $$
declare parts text[] := string_to_array(p_name,'/'); kind text := parts[1]; id uuid := public.safe_uuid(parts[2]);
begin
  if id is null then return false; end if;
  if kind='pmb' then
    return public.pmb_of_program(public.program_of_applicant(id))
        or (not p_write and public.pmb_view_of_program(public.program_of_applicant(id)));
  elsif kind='payments' then
    return public.fin_of_program(public.program_of_invoice(id))
       or (not p_write and public.fin_view_of_program(public.program_of_invoice(id)))
       or exists (select 1 from public.invoices i where i.id=id and i.applicant_id is not null and public.pmb_of_program(public.program_of_applicant(i.applicant_id)))
       or exists (select 1 from public.invoices i where i.id=id and i.student_id=public.my_student_id());
  elsif kind='thesis' then
    return public.staff_of_student(public.student_of_thesis(id)) or (not p_write and public.view_of_student(public.student_of_thesis(id)))
        or public.is_thesis_owner(id) or public.is_thesis_supervisor(id);
  end if;
  return false;
end $$;
grant execute on function public.academic_file_ok(text,boolean) to authenticated;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'acad\_%' loop
    execute format('drop policy %I on storage.objects', p.policyname); end loop; end $$;
create policy acad_obj_read on storage.objects for select to authenticated using (bucket_id='academic' and public.academic_file_ok(name,false));
create policy acad_obj_ins on storage.objects for insert to authenticated with check (bucket_id='academic' and public.academic_file_ok(name,true));
create policy acad_obj_del on storage.objects for delete to authenticated using (bucket_id='academic' and public.academic_file_ok(name,true));

-- Super Admin setara KM untuk pengaturan global & background
create policy acad_settings_sa on public.app_settings for all to authenticated
  using (public.app_role() = 'super_admin') with check (public.app_role() = 'super_admin');
create policy acad_bg_sa on storage.objects for all to authenticated
  using (bucket_id = 'backgrounds' and public.app_role() = 'super_admin') with check (bucket_id = 'backgrounds' and public.app_role() = 'super_admin');

-- ===== 092_rpc_extra =====
-- 085_rpc_extra.sql — fungsi pendukung KRS, skripsi, bimbingan
create or replace function public.krs_submit(p_krs uuid) returns void language plpgsql security definer set search_path=public as $$
declare n int;
begin
  if not exists (select 1 from public.krs where id=p_krs and student_id=public.my_student_id()) then raise exception 'KRS bukan milik Anda'; end if;
  select count(*) into n from public.krs_items where krs_id=p_krs;
  if n=0 then raise exception 'KRS masih kosong'; end if;
  update public.krs set status='diajukan', submitted_at=now(), note=null where id=p_krs and status in ('draft','ditolak');
  if not found then raise exception 'KRS tidak dapat diajukan pada status saat ini'; end if;
end $$;
grant execute on function public.krs_submit(uuid) to authenticated;

create or replace function public.thesis_resubmit(p_thesis uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_thesis_owner(p_thesis) then raise exception 'Bukan skripsi Anda'; end if;
  update public.thesis set status='diajukan', updated_at=now() where id=p_thesis and status='revisi_judul';
  if not found then raise exception 'Skripsi tidak berstatus revisi judul'; end if;
end $$;
grant execute on function public.thesis_resubmit(uuid) to authenticated;

create or replace function public.guidance_review(p_id uuid, p_status text, p_note text) returns void language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
  select thesis_id into t from public.thesis_guidance where id=p_id;
  if t is null or not (public.is_thesis_supervisor(t) or public.staff_of_student(public.student_of_thesis(t))) then raise exception 'Tidak berhak'; end if;
  if p_status not in ('disetujui','revisi') then raise exception 'Status tidak valid'; end if;
  update public.thesis_guidance set status=p_status, lecturer_note=p_note, lecturer_id=coalesce(public.my_lecturer_id(),lecturer_id) where id=p_id;
end $$;
grant execute on function public.guidance_review(uuid,text,text) to authenticated;

create or replace function public.set_final_grade(p_item uuid, p_att numeric, p_asg numeric, p_mid numeric, p_fin numeric, p_final boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not (public.staff_of_student(public.student_of_item(p_item)) or public.lecturer_teaches_item(p_item)) then raise exception 'Anda bukan pengampu mata kuliah ini'; end if;
  if p_final and (p_att is null or p_asg is null or p_mid is null or p_fin is null) then raise exception 'Semua komponen nilai harus diisi sebelum finalisasi'; end if;
  insert into public.grades(krs_item_id,attendance_score,assignment_score,mid_score,final_score,is_final,entered_by,updated_at)
  values (p_item,p_att,p_asg,p_mid,p_fin,p_final,auth.uid(),now())
  on conflict (krs_item_id) do update set attendance_score=excluded.attendance_score, assignment_score=excluded.assignment_score,
    mid_score=excluded.mid_score, final_score=excluded.final_score, is_final=excluded.is_final, entered_by=auth.uid(), updated_at=now()
  where public.grades.is_final = false or public.staff_of_student(public.student_of_item(p_item));
end $$;
grant execute on function public.set_final_grade(uuid,numeric,numeric,numeric,numeric,boolean) to authenticated;

-- ===== 095_views =====
-- 095_views.sql — laporan Kaprodi (semua dihitung dari database; security_invoker => RLS pemanggil berlaku)
-- Definisi: TERDAFTAR = status mahasiswa_baru ke atas (calon..registrasi_ulang tidak dihitung).
-- BELUM LULUS bukan gagal. Batas tepat waktu = 4 tahun (app_settings.graduation_rules.max_years_on_time).
create or replace view public.v_lifecycle_summary with (security_invoker=true) as
select status_akademik, count(*)::int as total from public.students group by status_akademik;

create or replace view public.v_cohort_graduation with (security_invoker=true) as
with r as (select coalesce((value->>'max_years_on_time')::int,4) yrs from public.app_settings where key='graduation_rules')
select s.angkatan,
  count(*)::int as terdaftar,
  count(*) filter (where s.status_akademik in ('lulus','alumni'))::int as lulus,
  count(*) filter (where s.status_akademik='mengundurkan_diri')::int as resign,
  count(*) filter (where s.status_akademik='do')::int as do_count,
  count(*) filter (where s.status_akademik in ('aktif','cuti','nonaktif','proses_penyelesaian','mengajukan_kelulusan','belum_memenuhi_syarat','mahasiswa_baru'))::int as belum_lulus,
  count(*) filter (where s.status_akademik='cuti')::int as cuti,
  round(100.0*count(*) filter (where s.status_akademik in ('lulus','alumni'))/nullif(count(*),0),1) as pct_lulus_dari_terdaftar,
  round(100.0*count(*) filter (where s.status_akademik in ('lulus','alumni'))
     /nullif(count(*) filter (where s.status_akademik in ('lulus','alumni','mengundurkan_diri','do')),0),1) as pct_lulus_dari_selesai,
  round(avg(g.ipk),2) as rata_ipk,
  round(avg((g.graduation_date - s.tanggal_masuk)/30.4375),1) as rata_masa_studi_bulan,
  count(*) filter (where g.graduation_date is not null and g.graduation_date <= s.tanggal_masuk + make_interval(years => (select yrs from r)))::int as lulus_tepat_waktu,
  count(*) filter (where g.graduation_date is not null and g.graduation_date >  s.tanggal_masuk + make_interval(years => (select yrs from r)))::int as lulus_terlambat
from public.students s left join public.student_graduation g on g.student_id=s.id
where s.status_akademik not in ('calon','pendaftar','peserta_seleksi','diterima','registrasi_ulang') and s.angkatan is not null
group by s.angkatan;

create or replace view public.v_graduation_yearly with (security_invoker=true) as
select extract(year from g.graduation_date)::int as tahun, count(*)::int as lulusan, round(avg(g.ipk),2) as rata_ipk,
  round(avg((g.graduation_date - s.tanggal_masuk)/30.4375),1) as rata_masa_studi_bulan
from public.student_graduation g join public.students s on s.id=g.student_id group by 1;

create or replace view public.v_ipk_distribution with (security_invoker=true) as
select case when ipk>=3.5 then '3,50 - 4,00' when ipk>=3.0 then '3,00 - 3,49' when ipk>=2.5 then '2,50 - 2,99' else '< 2,50' end as rentang,
  count(*)::int as jumlah from public.student_graduation where ipk is not null group by 1;

create or replace view public.v_pmb_summary with (security_invoker=true) as
select p.id period_id, p.name, p.quota,
  count(a.id)::int as pendaftar,
  count(a.id) filter (where a.status in ('peserta_seleksi','diterima','registrasi_ulang'))::int as ikut_seleksi,
  count(a.id) filter (where a.status in ('diterima','registrasi_ulang'))::int as diterima,
  count(a.id) filter (where a.status='tidak_lolos')::int as tidak_lolos,
  count(a.id) filter (where a.status='mengundurkan_diri')::int as mengundurkan_diri,
  count(a.id) filter (where a.status='registrasi_ulang')::int as registrasi_ulang,
  p.program_id
from public.pmb_periods p left join public.pmb_applicants a on a.period_id=p.id group by p.id;

create or replace view public.v_finance_student_summary with (security_invoker=true) as
select to_char(date_trunc('month', coalesce(py.verified_at, py.created_at)),'YYYY-MM') bulan,
  sum(py.amount) filter (where py.status='terverifikasi') as diterima,
  count(*) filter (where py.status='menunggu')::int as menunggu
from public.payments py group by 1;

-- Varian per prodi (dipakai filter Fakultas/Prodi di dashboard)
create or replace view public.v_lifecycle_summary_p with (security_invoker=true) as
select program_id, status_akademik, count(*)::int as total from public.students group by program_id, status_akademik;

create or replace view public.v_cohort_graduation_p with (security_invoker=true) as
with r as (select coalesce((value->>'max_years_on_time')::int,4) yrs from public.app_settings where key='graduation_rules')
select s.program_id, s.angkatan,
  count(*)::int as terdaftar,
  count(*) filter (where s.status_akademik in ('lulus','alumni'))::int as lulus,
  count(*) filter (where s.status_akademik='mengundurkan_diri')::int as resign,
  count(*) filter (where s.status_akademik='do')::int as do_count,
  count(*) filter (where s.status_akademik in ('aktif','cuti','nonaktif','proses_penyelesaian','mengajukan_kelulusan','belum_memenuhi_syarat','mahasiswa_baru'))::int as belum_lulus,
  count(*) filter (where s.status_akademik='cuti')::int as cuti,
  round(100.0*count(*) filter (where s.status_akademik in ('lulus','alumni'))/nullif(count(*),0),1) as pct_lulus_dari_terdaftar,
  round(100.0*count(*) filter (where s.status_akademik in ('lulus','alumni'))
     /nullif(count(*) filter (where s.status_akademik in ('lulus','alumni','mengundurkan_diri','do')),0),1) as pct_lulus_dari_selesai,
  round(avg(g.ipk),2) as rata_ipk,
  round(avg((g.graduation_date - s.tanggal_masuk)/30.4375),1) as rata_masa_studi_bulan,
  count(*) filter (where g.graduation_date is not null and g.graduation_date <= s.tanggal_masuk + make_interval(years => (select yrs from r)))::int as lulus_tepat_waktu,
  count(*) filter (where g.graduation_date is not null and g.graduation_date >  s.tanggal_masuk + make_interval(years => (select yrs from r)))::int as lulus_terlambat
from public.students s left join public.student_graduation g on g.student_id=s.id
where s.status_akademik not in ('calon','pendaftar','peserta_seleksi','diterima','registrasi_ulang') and s.angkatan is not null
group by s.program_id, s.angkatan;

create or replace view public.v_graduation_yearly_p with (security_invoker=true) as
select s.program_id, extract(year from g.graduation_date)::int as tahun, count(*)::int as lulusan, round(avg(g.ipk),2) as rata_ipk,
  round(avg((g.graduation_date - s.tanggal_masuk)/30.4375),1) as rata_masa_studi_bulan
from public.student_graduation g join public.students s on s.id=g.student_id group by 1, 2;

create or replace view public.v_ipk_distribution_p with (security_invoker=true) as
select s.program_id, case when g.ipk>=3.5 then '3,50 - 4,00' when g.ipk>=3.0 then '3,00 - 3,49' when g.ipk>=2.5 then '2,50 - 2,99' else '< 2,50' end as rentang,
  count(*)::int as jumlah from public.student_graduation g join public.students s on s.id=g.student_id where g.ipk is not null group by 1, 2;

create or replace view public.v_program_summary with (security_invoker=true) as
select sp.id program_id, sp.code, sp.name program_name, sp.level, f.id faculty_id, f.name faculty_name,
  count(s.id) filter (where s.status_akademik not in ('calon','pendaftar','peserta_seleksi','diterima','registrasi_ulang'))::int as terdaftar,
  count(s.id) filter (where s.status_akademik in ('mahasiswa_baru','aktif'))::int as aktif,
  count(s.id) filter (where s.status_akademik in ('lulus','alumni'))::int as lulus,
  round(100.0*count(s.id) filter (where s.status_akademik in ('lulus','alumni'))
     /nullif(count(s.id) filter (where s.status_akademik not in ('calon','pendaftar','peserta_seleksi','diterima','registrasi_ulang')),0),1) as pct_lulus_dari_terdaftar
from public.study_programs sp left join public.faculties f on f.id=sp.faculty_id left join public.students s on s.program_id=sp.id
where public.program_in_scope(sp.id) group by sp.id, f.id order by f.name, sp.name;

grant select on public.v_class_roster, public.v_invoices, public.v_grades, public.v_khs, public.v_ipk, public.v_lifecycle_summary,
  public.v_cohort_graduation, public.v_graduation_yearly, public.v_ipk_distribution, public.v_pmb_summary, public.v_finance_student_summary,
  public.v_lifecycle_summary_p, public.v_cohort_graduation_p, public.v_graduation_yearly_p, public.v_ipk_distribution_p, public.v_program_summary to authenticated;

-- ===== 100_pmb_otp =====
-- 100_pmb_otp.sql — Pendaftaran PMB mandiri dengan verifikasi email OTP.
-- Jalankan SETELAH 095. Aman dijalankan ulang.
-- Kode OTP TIDAK PERNAH dikembalikan ke browser: fungsi penerbit hanya bisa dipanggil service_role (Edge Function pmb-register),
-- yang mengirimkannya lewat SMTP. Di database hanya tersimpan HMAC-SHA256 (bukan teks biasa).

-- 1) Role baru untuk akun calon mahasiswa (hanya boleh melihat pendaftarannya sendiri)
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check check (role in
 ('km','sekretaris','bendahara','dosen','super_admin','admin_prodi','admin_pmb','admin_keuangan','mahasiswa','asisten_lab',
  'kaprodi','dekan','admin_universitas','calon_mahasiswa'));

-- app_role() dipakai oleh banyak policy "app_role() is not null" (profil, mata kuliah, storage, dst).
-- Calon mahasiswa SENGAJA tidak dihitung agar tidak ikut membaca data internal kampus.
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select ur.role
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
  where ur.user_id = auth.uid() and p.is_active and ur.role <> 'calon_mahasiswa'
$$;
grant execute on function public.app_role() to authenticated, anon;

-- 2) Kolom pendaftar mandiri
alter table public.pmb_applicants
  add column if not exists user_id uuid unique references auth.users(id) on delete set null,
  add column if not exists self_registered boolean not null default false,
  add column if not exists email_verified_at timestamptz;
create unique index if not exists ux_pa_selfreg_email on public.pmb_applicants (lower(email)) where self_registered and email is not null;

-- 3) Tabel OTP (tanpa akses dari browser)
create table if not exists public.pmb_email_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  max_attempts int not null default 5,
  used_at timestamptz,
  invalidated_at timestamptz,
  ip_hash text,
  created_at timestamptz not null default now());
create index if not exists ix_otp_email on public.pmb_email_otps(email, created_at desc);
create index if not exists ix_otp_ip on public.pmb_email_otps(ip_hash, created_at desc);

create table if not exists public.pmb_email_verified (
  token_hash text primary key,
  email text not null,
  full_name text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now());

alter table public.pmb_email_otps enable row level security;
alter table public.pmb_email_verified enable row level security;
revoke all on public.pmb_email_otps, public.pmb_email_verified from anon, authenticated;

-- 4) Fungsi inti (hanya service_role)
create or replace function public.pmb_hmac(p_pepper text, p_msg text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(hmac(convert_to(p_msg,'utf8'), convert_to(p_pepper,'utf8'), 'sha256'), 'hex') $$;

create or replace function public.pmb_email_registered(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pmb_applicants where lower(email) = lower(trim(p_email))) $$;

create or replace function public.pmb_otp_issue(p_email text, p_name text, p_ip_hash text, p_pepper text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(trim(coalesce(p_email,'')));
  v_name text := trim(coalesce(p_name,''));
  v_last timestamptz; v_cnt int; v_oldest timestamptz; v_code text; v_reg boolean;
begin
  if length(v_email) > 254 or v_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email'); end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'error', 'invalid_name'); end if;
  if coalesce(length(p_pepper),0) < 16 then raise exception 'OTP_PEPPER belum dikonfigurasi'; end if;

  -- jeda kirim ulang 60 detik
  select max(created_at) into v_last from public.pmb_email_otps where email = v_email;
  if v_last is not null and v_last > now() - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'retry_after', ceil(extract(epoch from (v_last + interval '60 seconds' - now())))::int);
  end if;
  -- rate limit: 5 permintaan / jam / email, 20 / jam / IP
  select count(*), min(created_at) into v_cnt, v_oldest from public.pmb_email_otps where email = v_email and created_at > now() - interval '1 hour';
  if v_cnt >= 5 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'retry_after', ceil(extract(epoch from (v_oldest + interval '1 hour' - now())))::int); end if;
  if p_ip_hash is not null then
    select count(*), min(created_at) into v_cnt, v_oldest from public.pmb_email_otps where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if v_cnt >= 20 then
      return jsonb_build_object('ok', false, 'error', 'rate_limited', 'retry_after', ceil(extract(epoch from (v_oldest + interval '1 hour' - now())))::int); end if;
  end if;

  -- OTP lama langsung tidak berlaku
  update public.pmb_email_otps set invalidated_at = now() where email = v_email and used_at is null and invalidated_at is null;

  v_reg := public.pmb_email_registered(v_email);
  if v_reg then
    -- Email sudah terdaftar: tidak ada kode. Tetap dicatat agar jeda dan rate limit berlaku sama (tanpa membocorkan status).
    insert into public.pmb_email_otps(email, full_name, code_hash, expires_at, invalidated_at, ip_hash)
    values (v_email, v_name, 'registered', now(), now(), p_ip_hash);
    return jsonb_build_object('ok', true, 'registered', true);
  end if;

  v_code := lpad(((('x' || encode(gen_random_bytes(4),'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into public.pmb_email_otps(email, full_name, code_hash, expires_at, ip_hash)
  values (v_email, v_name, public.pmb_hmac(p_pepper, v_email || ':' || v_code), now() + interval '5 minutes', p_ip_hash);
  return jsonb_build_object('ok', true, 'registered', false, 'code', v_code, 'expires_in', 300, 'name', v_name);
end $$;

create or replace function public.pmb_otp_verify(p_email text, p_code text, p_pepper text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(trim(coalesce(p_email,'')));
  r public.pmb_email_otps%rowtype; v_token text; v_left int;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  select * into r from public.pmb_email_otps
   where email = v_email and used_at is null and invalidated_at is null
   order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if r.expires_at < now() then
    update public.pmb_email_otps set invalidated_at = now() where id = r.id;
    return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if r.attempts >= r.max_attempts then
    update public.pmb_email_otps set invalidated_at = now() where id = r.id;
    return jsonb_build_object('ok', false, 'error', 'locked'); end if;

  if r.code_hash <> public.pmb_hmac(p_pepper, v_email || ':' || p_code) then
    update public.pmb_email_otps set attempts = attempts + 1,
           invalidated_at = case when attempts + 1 >= max_attempts then now() end where id = r.id;
    v_left := greatest(r.max_attempts - r.attempts - 1, 0);
    if v_left = 0 then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
    return jsonb_build_object('ok', false, 'error', 'invalid', 'attempts_left', v_left);
  end if;

  -- benar: sekali pakai
  update public.pmb_email_otps set used_at = now() where id = r.id;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.pmb_email_verified(token_hash, email, full_name, expires_at)
  values (public.pmb_hmac(p_pepper, 'tok:' || v_token), v_email, coalesce(r.full_name,''), now() + interval '30 minutes');
  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

-- Periode PMB yang sedang dibuka (publik)
create or replace function public.pmb_open_periods()
returns table (id uuid, name text, program_id uuid, program_name text, level text, faculty_name text, open_date date, close_date date)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.program_id, sp.name, sp.level, f.name, p.open_date, p.close_date
  from public.pmb_periods p
  join public.study_programs sp on sp.id = p.program_id
  left join public.faculties f on f.id = sp.faculty_id
  where p.is_open and current_date between p.open_date and p.close_date and sp.is_active
  order by f.name nulls last, sp.name $$;
grant execute on function public.pmb_open_periods() to anon, authenticated;

-- Tahap 1 registrasi: validasi token, kuota, dan buat baris pendaftar (token ditandai terpakai dalam satu transaksi)
create or replace function public.pmb_register_prepare(p_token text, p_email text, p_period uuid, p_data jsonb, p_pepper text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(trim(coalesce(p_email,'')));
  t public.pmb_email_verified%rowtype; per public.pmb_periods%rowtype; v_id uuid; v_reg text; v_cnt int;
  v_gender text := nullif(trim(p_data->>'gender'),'');
  v_bd date;
begin
  select * into t from public.pmb_email_verified
   where token_hash = public.pmb_hmac(p_pepper, 'tok:' || coalesce(p_token,'')) for update;
  if not found or t.email <> v_email then return jsonb_build_object('ok', false, 'error', 'token_invalid'); end if;
  if t.used_at is not null then return jsonb_build_object('ok', false, 'error', 'token_used'); end if;
  if t.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'token_expired'); end if;
  if public.pmb_email_registered(v_email) then return jsonb_build_object('ok', false, 'error', 'registered'); end if;

  select * into per from public.pmb_periods where id = p_period;
  if not found or not per.is_open or current_date not between per.open_date and per.close_date or per.program_id is null then
    return jsonb_build_object('ok', false, 'error', 'period_closed'); end if;
  if per.quota is not null then
    select count(*) into v_cnt from public.pmb_applicants where period_id = per.id and status not in ('mengundurkan_diri','tidak_lolos');
    if v_cnt >= per.quota * 5 then return jsonb_build_object('ok', false, 'error', 'period_full'); end if;  -- batas pendaftar 5x kuota
  end if;
  if v_gender is not null and v_gender not in ('L','P') then return jsonb_build_object('ok', false, 'error', 'invalid_data'); end if;
  begin v_bd := nullif(p_data->>'birth_date','')::date; exception when others then return jsonb_build_object('ok', false, 'error', 'invalid_data'); end;
  if v_bd is not null and (v_bd > current_date - interval '10 years' or v_bd < date '1940-01-01') then return jsonb_build_object('ok', false, 'error', 'invalid_data'); end if;

  insert into public.pmb_applicants(period_id, full_name, gender, birth_place, birth_date, phone, email, address, school_origin, school_major, grad_year, self_registered, email_verified_at)
  values (per.id, t.full_name, v_gender, left(nullif(trim(p_data->>'birth_place'),''),80), v_bd, left(nullif(trim(p_data->>'phone'),''),20), v_email,
          left(nullif(trim(p_data->>'address'),''),300), left(nullif(trim(p_data->>'school_origin'),''),120), left(nullif(trim(p_data->>'school_major'),''),80),
          nullif(p_data->>'grad_year','')::int, true, now())
  returning id, reg_number into v_id, v_reg;
  update public.pmb_email_verified set used_at = now() where token_hash = t.token_hash;
  return jsonb_build_object('ok', true, 'applicant_id', v_id, 'reg_number', v_reg, 'full_name', t.full_name);
end $$;

-- Dipanggil setelah akun login berhasil dibuat
create or replace function public.pmb_register_finish(p_applicant uuid, p_user uuid)
returns void language sql security definer set search_path = public as $$
  update public.pmb_applicants set user_id = p_user where id = p_applicant $$;

-- Dipanggil bila pembuatan akun gagal: batalkan pendaftar dan kembalikan token agar pengguna tidak perlu OTP ulang
create or replace function public.pmb_register_rollback(p_applicant uuid, p_token text, p_pepper text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.pmb_applicants where id = p_applicant and user_id is null and self_registered;
  update public.pmb_email_verified set used_at = null where token_hash = public.pmb_hmac(p_pepper, 'tok:' || coalesce(p_token,''));
end $$;

-- Pembersihan data OTP lama (opsional dijadwalkan)
create or replace function public.pmb_otp_cleanup() returns void language sql security definer set search_path = public as $$
  delete from public.pmb_email_otps where created_at < now() - interval '2 days';
  delete from public.pmb_email_verified where created_at < now() - interval '2 days' $$;

revoke execute on function public.pmb_hmac(text,text), public.pmb_email_registered(text), public.pmb_otp_issue(text,text,text,text),
  public.pmb_otp_verify(text,text,text), public.pmb_register_prepare(text,text,uuid,jsonb,text), public.pmb_register_finish(uuid,uuid),
  public.pmb_register_rollback(uuid,text,text), public.pmb_otp_cleanup() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.pmb_hmac(text,text), public.pmb_email_registered(text), public.pmb_otp_issue(text,text,text,text),
      public.pmb_otp_verify(text,text,text), public.pmb_register_prepare(text,text,uuid,jsonb,text), public.pmb_register_finish(uuid,uuid),
      public.pmb_register_rollback(uuid,text,text), public.pmb_otp_cleanup() to service_role;
    grant select, insert, update, delete on public.pmb_email_otps, public.pmb_email_verified to service_role;
  end if;
end $$;

-- 5) Calon mahasiswa hanya boleh membaca pendaftarannya sendiri (policy permisif, ditambahkan ke policy staf yang sudah ada)
drop policy if exists pmb_app_self_sel on public.pmb_applicants;
create policy pmb_app_self_sel on public.pmb_applicants for select to authenticated using (user_id = auth.uid());
drop policy if exists pmb_hist_self_sel on public.pmb_status_history;
create policy pmb_hist_self_sel on public.pmb_status_history for select to authenticated
  using (exists (select 1 from public.pmb_applicants a where a.id = applicant_id and a.user_id = auth.uid()));
drop policy if exists pmb_period_self_sel on public.pmb_periods;
create policy pmb_period_self_sel on public.pmb_periods for select to authenticated
  using (exists (select 1 from public.pmb_applicants a where a.period_id = pmb_periods.id and a.user_id = auth.uid()));
drop policy if exists pmb_doc_self_sel on public.pmb_documents;
create policy pmb_doc_self_sel on public.pmb_documents for select to authenticated
  using (exists (select 1 from public.pmb_applicants a where a.id = applicant_id and a.user_id = auth.uid()));

-- ===== 110_pmb_test =====
-- 110_pmb_test.sql — Tes PMB online, unggah berkas oleh calon mahasiswa, dan sinkron jadwal otomatis ke kalender.
-- Aturan kelulusan: nilai > 75 => diterima ; nilai <= 75 => tidak_lolos (Admin PMB tetap bisa mengoreksi).

-- ============ 1. Tabel tes ============
create table if not exists public.pmb_tests (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null unique references public.pmb_periods(id) on delete cascade,
  title text not null default 'Tes Seleksi PMB',
  duration_minutes int not null default 60 check (duration_minutes between 5 and 300),
  pass_score numeric(5,2) not null default 75 check (pass_score between 0 and 100),
  scheduled_start timestamptz, scheduled_end timestamptz,
  is_published boolean not null default false,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(),
  check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start));

create table if not exists public.pmb_test_questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.pmb_tests(id) on delete cascade,
  position int not null default 1,
  question text not null check (char_length(question) >= 3),
  opt_a text not null, opt_b text not null, opt_c text, opt_d text,
  correct char(1) not null check (correct in ('a','b','c','d')),
  points int not null default 1 check (points between 1 and 100),
  created_at timestamptz not null default now());
create index if not exists ix_ptq_test on public.pmb_test_questions(test_id, position);

create table if not exists public.pmb_test_attempts (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.pmb_tests(id) on delete cascade,
  applicant_id uuid not null references public.pmb_applicants(id) on delete cascade,
  started_at timestamptz not null default now(), deadline timestamptz not null,
  submitted_at timestamptz, answers jsonb not null default '{}'::jsonb,
  score numeric(5,2), passed boolean,
  unique (test_id, applicant_id));

alter table public.pmb_tests enable row level security;
alter table public.pmb_test_questions enable row level security;
alter table public.pmb_test_attempts enable row level security;

create or replace function public.program_of_test(tid uuid) returns uuid language sql stable security definer set search_path=public as $$
  select public.program_of_period(period_id) from public.pmb_tests where id=tid $$;
create or replace function public.my_applicant_id() returns uuid language sql stable security definer set search_path=public as $$
  select id from public.pmb_applicants where user_id = auth.uid() limit 1 $$;
grant execute on function public.program_of_test(uuid), public.my_applicant_id() to authenticated;

drop policy if exists pt_staff on public.pmb_tests;
create policy pt_staff on public.pmb_tests for all to authenticated
  using (public.pmb_of_program(public.program_of_period(period_id))) with check (public.pmb_of_program(public.program_of_period(period_id)));
drop policy if exists pt_view on public.pmb_tests;
create policy pt_view on public.pmb_tests for select to authenticated using (public.pmb_view_of_program(public.program_of_period(period_id)));
-- soal & kunci: hanya staf PMB (calon mahasiswa mengambil soal lewat fungsi tanpa kunci jawaban)
drop policy if exists ptq_staff on public.pmb_test_questions;
create policy ptq_staff on public.pmb_test_questions for all to authenticated
  using (public.pmb_of_program(public.program_of_test(test_id))) with check (public.pmb_of_program(public.program_of_test(test_id)));
drop policy if exists pta_staff_sel on public.pmb_test_attempts;
create policy pta_staff_sel on public.pmb_test_attempts for select to authenticated using (public.pmb_view_of_program(public.program_of_test(test_id)));
drop policy if exists pta_self_sel on public.pmb_test_attempts;
create policy pta_self_sel on public.pmb_test_attempts for select to authenticated using (applicant_id = public.my_applicant_id());
revoke all on public.pmb_tests, public.pmb_test_questions, public.pmb_test_attempts from anon;
grant select, insert, update, delete on public.pmb_tests, public.pmb_test_questions to authenticated;
grant select on public.pmb_test_attempts to authenticated;

-- ============ 2. Unggah berkas oleh calon mahasiswa ============
drop policy if exists pmb_doc_self_ins on public.pmb_documents;
create policy pmb_doc_self_ins on public.pmb_documents for insert to authenticated
  with check (applicant_id = public.my_applicant_id() and verified = false and uploaded_by = auth.uid()
              and file_path like 'pmb/' || applicant_id::text || '/%');
drop policy if exists pmb_doc_self_del on public.pmb_documents;
create policy pmb_doc_self_del on public.pmb_documents for delete to authenticated
  using (applicant_id = public.my_applicant_id() and verified = false);

create or replace function public.academic_file_ok(p_name text, p_write boolean) returns boolean language plpgsql stable security definer set search_path=public as $$
declare parts text[] := string_to_array(p_name,'/'); kind text := parts[1]; id uuid := public.safe_uuid(parts[2]);
begin
  if id is null then return false; end if;
  if kind='pmb' then
    return public.pmb_of_program(public.program_of_applicant(id))
        or (not p_write and public.pmb_view_of_program(public.program_of_applicant(id)))
        or exists (select 1 from public.pmb_applicants a where a.id=id and a.user_id=auth.uid());
  elsif kind='payments' then
    return public.fin_of_program(public.program_of_invoice(id))
       or (not p_write and public.fin_view_of_program(public.program_of_invoice(id)))
       or exists (select 1 from public.invoices i where i.id=id and i.applicant_id is not null and public.pmb_of_program(public.program_of_applicant(i.applicant_id)))
       or exists (select 1 from public.invoices i where i.id=id and i.student_id=public.my_student_id());
  elsif kind='thesis' then
    return public.staff_of_student(public.student_of_thesis(id)) or (not p_write and public.view_of_student(public.student_of_thesis(id)))
        or public.is_thesis_owner(id) or public.is_thesis_supervisor(id);
  end if;
  return false;
end $$;
grant execute on function public.academic_file_ok(text,boolean) to authenticated;

-- ============ 3. Fungsi tes untuk calon mahasiswa ============
-- Berkas wajib: ktp, kk, ijazah, pas_foto — semuanya harus sudah DIVERIFIKASI admin.
create or replace function public.pmb_my_test_status() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a public.pmb_applicants; t public.pmb_tests; att public.pmb_test_attempts;
  req text[] := array['ktp','kk','ijazah','pas_foto']; missing text[] := '{}'; d text; reason text := null;
  docs jsonb;
begin
  select * into a from public.pmb_applicants where user_id = auth.uid() limit 1;
  if a.id is null then return jsonb_build_object('applicant', false); end if;
  select coalesce(jsonb_object_agg(doc_type, jsonb_build_object('uploaded', true, 'verified', v)), '{}'::jsonb) into docs
    from (select doc_type, bool_or(verified) as v from public.pmb_documents where applicant_id=a.id group by doc_type) x;
  docs := coalesce(docs,'{}'::jsonb);
  foreach d in array req loop
    if not exists (select 1 from public.pmb_documents where applicant_id=a.id and doc_type=d and verified) then missing := missing || d; end if;
  end loop;
  select * into t from public.pmb_tests where period_id=a.period_id;
  select * into att from public.pmb_test_attempts where test_id=t.id and applicant_id=a.id;
  if att.id is not null and att.submitted_at is null and att.deadline <= now() then
    perform public.pmb_test_finalize(att.id);
    select * into att from public.pmb_test_attempts where id=att.id;
    select * into a from public.pmb_applicants where id=a.id;
  end if;
  if att.id is not null and att.submitted_at is not null then reason := 'selesai';
  elsif a.status not in ('pendaftar','berkas_lengkap','peserta_seleksi') then reason := 'status';
  elsif array_length(missing,1) > 0 then reason := 'berkas';
  elsif t.id is null or not t.is_published then reason := 'belum_tersedia';
  elsif t.scheduled_start is not null and now() < t.scheduled_start then reason := 'belum_mulai';
  elsif t.scheduled_end is not null and now() > t.scheduled_end and att.id is null then reason := 'sudah_lewat';
  end if;
  return jsonb_build_object('applicant', true, 'applicant_id', a.id, 'reg_number', a.reg_number, 'status', a.status,
    'test_score', a.test_score, 'missing_docs', to_jsonb(missing), 'docs', docs,
    'eligible', reason is null, 'reason', reason,
    'test', case when t.id is null or not t.is_published then null else jsonb_build_object('id', t.id, 'title', t.title,
       'duration_minutes', t.duration_minutes, 'pass_score', t.pass_score, 'scheduled_start', t.scheduled_start, 'scheduled_end', t.scheduled_end,
       'question_count', (select count(*) from public.pmb_test_questions where test_id=t.id)) end,
    'attempt', case when att.id is null then null else jsonb_build_object('started_at', att.started_at, 'deadline', att.deadline,
       'submitted_at', att.submitted_at, 'score', att.score, 'passed', att.passed) end);
end $$;

create or replace function public.pmb_test_finalize(p_attempt uuid) returns void language plpgsql security definer set search_path=public as $$
declare att public.pmb_test_attempts; t public.pmb_tests; total numeric; earned numeric; sc numeric; ok boolean; a public.pmb_applicants;
begin
  select * into att from public.pmb_test_attempts where id=p_attempt for update;
  if att.id is null or att.submitted_at is not null then return; end if;
  select * into t from public.pmb_tests where id=att.test_id;
  select coalesce(sum(points),0) into total from public.pmb_test_questions where test_id=t.id;
  select coalesce(sum(q.points),0) into earned from public.pmb_test_questions q
    where q.test_id=t.id and lower(att.answers ->> q.id::text) = q.correct;
  sc := case when total = 0 then 0 else round(100.0 * earned / total, 2) end;
  ok := sc > t.pass_score;      -- tegas: harus LEBIH dari batas (75), sama dengan 75 = tidak lulus
  update public.pmb_test_attempts set submitted_at = now(), score = sc, passed = ok where id=att.id;
  select * into a from public.pmb_applicants where id=att.applicant_id for update;
  perform set_config('synora.pmb_note', 'Hasil tes otomatis: nilai ' || sc || case when ok then ' (> ' else ' (<= ' end || t.pass_score || ')', true);
  if a.status in ('pendaftar','berkas_lengkap','peserta_seleksi') then
    update public.pmb_applicants set test_score = sc, status = case when ok then 'diterima' else 'tidak_lolos' end where id=a.id;
  else
    update public.pmb_applicants set test_score = sc where id=a.id;
  end if;
  perform set_config('synora.pmb_note', '', true);
end $$;
revoke all on function public.pmb_test_finalize(uuid) from public, anon, authenticated;

create or replace function public.pmb_test_start() returns jsonb language plpgsql security definer set search_path=public as $$
declare st jsonb := public.pmb_my_test_status(); a uuid; t public.pmb_tests; att public.pmb_test_attempts; qs jsonb;
begin
  if (st->>'applicant') <> 'true' then raise exception 'Akun ini bukan calon mahasiswa'; end if;
  a := (st->>'applicant_id')::uuid;
  select * into att from public.pmb_test_attempts where applicant_id=a;
  if att.id is not null and att.submitted_at is null and att.deadline > now() then
    null; -- lanjutkan
  elsif (st->>'eligible') <> 'true' then
    raise exception 'Belum bisa mengikuti tes (%)', st->>'reason';
  else
    select t2.* into t from public.pmb_tests t2 join public.pmb_applicants pa on pa.period_id=t2.period_id where pa.id=a;
    if not exists (select 1 from public.pmb_test_questions where test_id=t.id) then raise exception 'Soal tes belum disiapkan'; end if;
    insert into public.pmb_test_attempts(test_id, applicant_id, deadline)
      values (t.id, a, least(now() + make_interval(mins => t.duration_minutes), coalesce(t.scheduled_end, 'infinity'::timestamptz)))
      returning * into att;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'position', q.position, 'question', q.question,
      'options', jsonb_strip_nulls(jsonb_build_object('a', q.opt_a, 'b', q.opt_b, 'c', q.opt_c, 'd', q.opt_d)), 'points', q.points)
      order by q.position, q.created_at), '[]'::jsonb) into qs from public.pmb_test_questions q where q.test_id=att.test_id;
  return jsonb_build_object('attempt_id', att.id, 'started_at', att.started_at, 'deadline', att.deadline, 'server_now', now(),
    'answers', att.answers, 'questions', qs);
end $$;

create or replace function public.pmb_test_save(p_answers jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare att public.pmb_test_attempts;
begin
  select * into att from public.pmb_test_attempts where applicant_id = public.my_applicant_id() and submitted_at is null;
  if att.id is null then raise exception 'Tidak ada tes yang sedang berjalan'; end if;
  if att.deadline <= now() then perform public.pmb_test_finalize(att.id); return jsonb_build_object('expired', true); end if;
  update public.pmb_test_attempts set answers = coalesce(p_answers,'{}'::jsonb) where id=att.id;
  return jsonb_build_object('saved', true, 'deadline', att.deadline);
end $$;

create or replace function public.pmb_test_submit(p_answers jsonb default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare att public.pmb_test_attempts; r public.pmb_test_attempts;
begin
  select * into att from public.pmb_test_attempts where applicant_id = public.my_applicant_id() and submitted_at is null;
  if att.id is null then raise exception 'Tidak ada tes yang sedang berjalan'; end if;
  -- jawaban terakhir diterima hanya jika belum lewat batas waktu (toleransi 10 detik untuk jaringan)
  if p_answers is not null and att.deadline + interval '10 seconds' > now() then
    update public.pmb_test_attempts set answers = p_answers where id=att.id; end if;
  perform public.pmb_test_finalize(att.id);
  select * into r from public.pmb_test_attempts where id=att.id;
  return jsonb_build_object('score', r.score, 'passed', r.passed, 'status', (select status from public.pmb_applicants where id=r.applicant_id));
end $$;

-- staf: tutup tes yang waktunya habis tetapi belum dikirim (mis. peserta menutup browser)
create or replace function public.pmb_test_close_expired(p_test uuid) returns int language plpgsql security definer set search_path=public as $$
declare r record; n int := 0;
begin
  if not public.pmb_of_program(public.program_of_test(p_test)) then raise exception 'Tidak berwenang'; end if;
  for r in select id from public.pmb_test_attempts where test_id=p_test and submitted_at is null and deadline <= now() loop
    perform public.pmb_test_finalize(r.id); n := n + 1; end loop;
  return n;
end $$;
grant execute on function public.pmb_my_test_status(), public.pmb_test_start(), public.pmb_test_save(jsonb), public.pmb_test_submit(jsonb),
  public.pmb_test_close_expired(uuid) to authenticated;

-- ============ 4. Jadwal otomatis masuk kalender ============
alter table public.academic_events add column if not exists source_type text, add column if not exists source_id uuid;
create unique index if not exists ux_events_source on public.academic_events(source_type, source_id) where source_type is not null;

-- agenda hasil sinkron tidak boleh diubah/dihapus manual (ubah dari jadwal asalnya)
drop policy if exists acad_events_upd on public.academic_events;
create policy acad_events_upd on public.academic_events for update to authenticated
  using (source_type is null and public.event_writable(level, class_id, program_id, faculty_id))
  with check (source_type is null and public.event_writable(level, class_id, program_id, faculty_id));
drop policy if exists acad_events_del on public.academic_events;
create policy acad_events_del on public.academic_events for delete to authenticated
  using (source_type is null and public.event_writable(level, class_id, program_id, faculty_id));
drop policy if exists acad_events_ins on public.academic_events;
create policy acad_events_ins on public.academic_events for insert to authenticated
  with check (source_type is null and created_by = auth.uid() and public.event_writable(level, class_id, program_id, faculty_id));

create or replace function public.sync_event(p_type text, p_id uuid, p_title text, p_cat text, p_start timestamptz, p_end timestamptz,
  p_location text, p_desc text, p_program uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if p_start is null or p_program is null then
    delete from public.academic_events where source_type=p_type and source_id=p_id; return; end if;
  insert into public.academic_events(title, category, start_at, end_at, all_day, location, description, level, program_id, created_by, source_type, source_id)
  values (p_title, p_cat, p_start, coalesce(p_end, p_start + interval '1 hour'), false, p_location, p_desc, 'prodi', p_program, auth.uid(), p_type, p_id)
  on conflict (source_type, source_id) where source_type is not null do update
    set title=excluded.title, category=excluded.category, start_at=excluded.start_at, end_at=excluded.end_at,
        location=excluded.location, description=excluded.description, program_id=excluded.program_id;
end $$;
revoke all on function public.sync_event(text,uuid,text,text,timestamptz,timestamptz,text,text,uuid) from public, anon, authenticated;

-- (a) jadwal tes PMB
create or replace function public.trg_sync_pmb_test() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'DELETE' then delete from public.academic_events where source_type='pmb_test' and source_id=old.id; return old; end if;
  perform public.sync_event('pmb_test', new.id, new.title || ' (PMB)', 'kampus',
    case when new.is_published then new.scheduled_start end, new.scheduled_end, 'Online — aplikasi SYNORA',
    'Tes seleksi PMB online. Durasi ' || new.duration_minutes || ' menit, nilai lulus > ' || new.pass_score || '. Otomatis dari jadwal PMB.',
    public.program_of_period(new.period_id));
  return new; end $$;
drop trigger if exists sync_pmb_test on public.pmb_tests;
create trigger sync_pmb_test after insert or update or delete on public.pmb_tests for each row execute function public.trg_sync_pmb_test();

-- (b) sidang skripsi
create or replace function public.trg_sync_defense() returns trigger language plpgsql security definer set search_path=public as $$
declare th record; st timestamptz;
begin
  if tg_op = 'DELETE' then delete from public.academic_events where source_type='sidang' and source_id=old.id; return old; end if;
  select t.title, s.full_name, s.program_id into th from public.thesis t join public.students s on s.id=t.student_id where t.id=new.thesis_id;
  st := (new.defense_date + coalesce(new.start_time, time '08:00')) at time zone 'Asia/Jakarta';
  perform public.sync_event('sidang', new.id, 'Sidang Skripsi — ' || th.full_name, 'penting', st, st + interval '90 minutes',
    new.room, 'Judul: ' || th.title || '. Otomatis dari jadwal sidang.', th.program_id);
  return new; end $$;
drop trigger if exists sync_defense on public.thesis_defenses;
create trigger sync_defense after insert or update or delete on public.thesis_defenses for each row execute function public.trg_sync_defense();

-- (c) sesi praktikum / lab
create or replace function public.trg_sync_practicum() returns trigger language plpgsql security definer set search_path=public as $$
declare prog uuid; st timestamptz; lab_name text; cname text;
begin
  if tg_op = 'DELETE' then delete from public.academic_events where source_type='praktikum' and source_id=old.id; return old; end if;
  select coalesce(c.program_id, (select program_id from public.classes where id=new.class_id)) into prog from public.courses c where c.id=new.course_id;
  select name into lab_name from public.labs where id=new.lab_id;
  select name into cname from public.courses where id=new.course_id;
  st := (new.session_date + coalesce(new.start_time, time '08:00')) at time zone 'Asia/Jakarta';
  perform public.sync_event('praktikum', new.id, 'Praktikum: ' || new.title, 'kuliah', st,
    case when new.end_time is not null then (new.session_date + new.end_time) at time zone 'Asia/Jakarta' end,
    lab_name, cname || '. Otomatis dari jadwal praktikum.', prog);
  return new; end $$;
drop trigger if exists sync_practicum on public.practicum_sessions;
create trigger sync_practicum after insert or update or delete on public.practicum_sessions for each row execute function public.trg_sync_practicum();

-- isi ulang untuk data yang sudah ada
update public.pmb_tests set title = title;
update public.thesis_defenses set room = room;
update public.practicum_sessions set title = title;

