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
