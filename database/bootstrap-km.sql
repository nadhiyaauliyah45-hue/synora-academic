-- =====================================================================
-- SYNORA — bootstrap-km.sql  (SEKALI SAJA, untuk akun Ketua Kelas pertama)
-- =====================================================================
-- Langkah:
-- 1. Supabase Dashboard > Authentication > Users > "Add user" > "Create new user"
--      Email   : <NIM-KM>@synora.local     (contoh: 240701047@synora.local)
--      Password: (password awal, minimal 8 karakter)
--      Centang "Auto Confirm User".
-- 2. Ganti nilai di bawah (NIM dan nama), lalu jalankan skrip ini.
-- 3. Login ke SYNORA memakai NIM tersebut. Akun lain dibuat lewat
--    Pengaturan > Manajemen Pengguna (memakai Edge Function admin-users).
-- =====================================================================
do $$
declare
  v_nim   text := '240701047';             -- <-- GANTI: NIM Ketua Kelas
  v_name  text := 'Nama Ketua Kelas';      -- <-- GANTI: nama lengkap
  v_uid   uuid;
begin
  select id into v_uid from auth.users where email = lower(v_nim) || '@synora.local';
  if v_uid is null then
    raise exception 'User auth dengan email %@synora.local belum dibuat (langkah 1).', v_nim;
  end if;

  insert into public.profiles(id, nim, full_name, is_active)
  values (v_uid, v_nim, v_name, true)
  on conflict (id) do update set nim = excluded.nim, full_name = excluded.full_name, is_active = true;

  insert into public.user_roles(user_id, role)
  values (v_uid, 'km')
  on conflict (user_id) do update set role = 'km';
end $$;
