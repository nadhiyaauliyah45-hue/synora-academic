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
create policy acad_courses_sel on public.courses for select to authenticated using (public.app_role() is not null);
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
