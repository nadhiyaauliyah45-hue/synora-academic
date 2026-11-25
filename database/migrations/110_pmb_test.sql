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
