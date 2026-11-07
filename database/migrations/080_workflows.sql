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
