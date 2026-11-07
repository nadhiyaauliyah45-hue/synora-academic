-- =====================================================================
-- SYNORA — add-user.sql : daftarkan akun yang SUDAH dibuat di Supabase Auth
-- (Authentication > Users) agar bisa login ke SYNORA.
-- Akun di Supabase Auth saja belum cukup: SYNORA juga butuh baris di
-- `profiles` (nama) dan `user_roles` (jabatan). Skrip ini membuat keduanya.
-- Ganti 3 nilai di bawah, jalankan di SQL Editor. Boleh diulang untuk akun lain.
-- =====================================================================
do $$
declare
  v_nim   text := '240511160';          -- <-- NIM (sama dengan bagian depan email)
  v_name  text := 'Nama Lengkap';       -- <-- nama lengkap
  v_role  text := 'sekretaris';         -- <-- km | sekretaris | bendahara | dosen
  v_uid   uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(v_nim) || '@synora.local';
  if v_uid is null then
    raise exception 'User %@synora.local belum ada di Authentication > Users.', v_nim;
  end if;
  insert into public.profiles(id, nim, full_name, is_active)
  values (v_uid, v_nim, v_name, true)
  on conflict (id) do update set nim = excluded.nim, full_name = excluded.full_name, is_active = true;
  insert into public.user_roles(user_id, role) values (v_uid, v_role)
  on conflict (user_id) do update set role = excluded.role;
end $$;
