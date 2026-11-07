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
