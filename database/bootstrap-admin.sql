-- =====================================================================
-- SYNORA Academic — bootstrap-admin.sql (SEKALI per akun staf pertama)
-- Membuat akun pertama untuk role apa pun (mis. super_admin) yang sudah dibuat di Authentication > Users.
-- 1. Authentication > Users > Add user: email <NIM>@synora.local, password, centang Auto Confirm.
-- 2. Ganti nilai di bawah lalu jalankan. Akun berikutnya dibuat dari aplikasi (Pengaturan > Manajemen Pengguna).
-- =====================================================================
do $$
declare
  v_nim  text := '240511160';                 -- <-- GANTI
  v_name text := 'Nadhiya Auliyah Ramadhani'; -- <-- GANTI
  v_role text := 'super_admin';               -- km | sekretaris | bendahara | dosen | super_admin | admin_prodi | admin_pmb | admin_keuangan | mahasiswa | asisten_lab
  v_uid  uuid;
begin
  select id into v_uid from auth.users where email = lower(v_nim) || '@synora.local';
  if v_uid is null then raise exception 'User auth %@synora.local belum dibuat.', v_nim; end if;
  insert into public.profiles(id, nim, full_name, is_active) values (v_uid, v_nim, v_name, true)
  on conflict (id) do update set nim = excluded.nim, full_name = excluded.full_name, is_active = true;
  insert into public.user_roles(user_id, role) values (v_uid, v_role)
  on conflict (user_id) do update set role = excluded.role;
  raise notice 'OK: % terdaftar sebagai %', v_nim, v_role;
end $$;
