-- =====================================================================
-- SYNORA — rls-policies.sql
-- Role-based access control di sisi database. Jalankan SETELAH relationships.sql.
-- Role: km (Ketua Kelas), sekretaris, bendahara, dosen.
-- Akun nonaktif (profiles.is_active = false) otomatis tidak punya role efektif.
-- =====================================================================

-- ---------- Fungsi bantu ----------------------------------------------------
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select ur.role
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
  where ur.user_id = auth.uid() and p.is_active
$$;

create or replace function public.has_role(roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = any(roles), false)
$$;

create or replace function public.can_access_room(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_rooms r
    where r.id = rid and (
      (r.kind = 'pengurus'       and public.has_role(array['km','sekretaris','bendahara'])) or
      (r.kind = 'dosen_pengurus' and public.has_role(array['km','sekretaris','bendahara','dosen']))
    )
  )
$$;

grant execute on function public.app_role() to authenticated, anon;
grant execute on function public.has_role(text[]) to authenticated, anon;
grant execute on function public.can_access_room(uuid) to authenticated;

-- ---------- Aktifkan RLS di semua tabel --------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','user_roles','students','lecturers','courses','schedules',
    'attendance','attendance_details','finance_categories','inventory','transactions',
    'inventory_history','documents','memories_profiles','academic_events','announcements',
    'chat_rooms','chat_messages','spin_history','groups','group_members','notifications','app_settings']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Hak dasar: RLS tetap menjadi penjaga utama.
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.app_settings to anon;
-- profiles: pengguna hanya boleh mengubah nama dan foto sendiri (role/status via Edge Function)
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, avatar_url, avatar_path) on public.profiles to authenticated;
revoke insert, update, delete on public.user_roles from authenticated;
revoke insert, update, delete on public.inventory_history from authenticated;
revoke insert, delete on public.notifications from authenticated;

-- Helper: hapus semua policy lama agar skrip dapat dijalankan ulang
do $$
declare p record;
begin
  -- Hanya policy milik tabel dasar SYNORA kelas. Policy modul Academic ada di migrations/090_rls.sql
  -- dan TIDAK ikut terhapus jika file ini dijalankan ulang.
  for p in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public'
             and tablename in ('profiles','user_roles','students','lecturers','courses','schedules',
    'attendance','attendance_details','finance_categories','inventory','transactions',
    'inventory_history','documents','memories_profiles','academic_events','announcements',
    'chat_rooms','chat_messages','spin_history','groups','group_members','notifications','app_settings')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- ---------- profiles & user_roles --------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (public.app_role() is not null or id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.app_role() = 'km');

-- ---------- students & memories_profiles (semua boleh lihat; KM/Sekretaris kelola)
create policy students_select on public.students for select to authenticated
  using (public.has_role(array['km','sekretaris','bendahara','dosen']));
create policy students_write on public.students for all to authenticated
  using (public.has_role(array['km','sekretaris'])) with check (public.has_role(array['km','sekretaris']));

create policy memories_select on public.memories_profiles for select to authenticated
  using (public.has_role(array['km','sekretaris','bendahara','dosen']));
create policy memories_write on public.memories_profiles for all to authenticated
  using (public.has_role(array['km','sekretaris'])) with check (public.has_role(array['km','sekretaris']));

-- ---------- akademik: dosen, mata kuliah, jadwal, absensi, kalender ------------
create policy lecturers_select on public.lecturers for select to authenticated
  using (public.has_role(array['km','sekretaris','dosen']));
create policy lecturers_write on public.lecturers for all to authenticated
  using (public.has_role(array['km','sekretaris'])) with check (public.has_role(array['km','sekretaris']));

create policy courses_select on public.courses for select to authenticated
  using (public.has_role(array['km','sekretaris','dosen']));
create policy courses_write on public.courses for all to authenticated
  using (public.has_role(array['km','sekretaris'])) with check (public.has_role(array['km','sekretaris']));

create policy schedules_select on public.schedules for select to authenticated
  using (public.has_role(array['km','sekretaris','dosen']));
create policy schedules_write on public.schedules for all to authenticated
  using (public.has_role(array['km','sekretaris'])) with check (public.has_role(array['km','sekretaris']));

create policy attendance_select on public.attendance for select to authenticated
  using (public.has_role(array['km','sekretaris','dosen']));
create policy attendance_write on public.attendance for all to authenticated
  using (public.has_role(array['km','sekretaris'])) with check (public.has_role(array['km','sekretaris']));

create policy att_details_select on public.attendance_details for select to authenticated
  using (public.has_role(array['km','sekretaris','dosen']));
create policy att_details_write on public.attendance_details for all to authenticated
  using (public.has_role(array['km','sekretaris'])) with check (public.has_role(array['km','sekretaris']));

create policy events_select on public.academic_events for select to authenticated
  using (public.has_role(array['km','sekretaris','dosen']));
create policy events_write on public.academic_events for all to authenticated
  using (public.has_role(array['km','sekretaris'])) with check (public.has_role(array['km','sekretaris']));

create policy announcements_select on public.announcements for select to authenticated
  using (public.has_role(array['km','sekretaris','bendahara','dosen']));
create policy announcements_write on public.announcements for all to authenticated
  using (public.has_role(array['km','sekretaris'])) with check (public.has_role(array['km','sekretaris']));

-- ---------- perpustakaan --------------------------------------------------------
create policy documents_select on public.documents for select to authenticated
  using (public.has_role(array['km','sekretaris']) or (public.has_role(array['dosen']) and visible_to_lecturers));
create policy documents_write on public.documents for all to authenticated
  using (public.has_role(array['km','sekretaris'])) with check (public.has_role(array['km','sekretaris']));

-- ---------- keuangan & inventaris (KM dan Bendahara) -----------------------------
create policy fin_categories_all on public.finance_categories for all to authenticated
  using (public.has_role(array['km','bendahara'])) with check (public.has_role(array['km','bendahara']));
create policy transactions_all on public.transactions for all to authenticated
  using (public.has_role(array['km','bendahara'])) with check (public.has_role(array['km','bendahara']));
create policy inventory_all on public.inventory for all to authenticated
  using (public.has_role(array['km','bendahara'])) with check (public.has_role(array['km','bendahara']));
create policy inventory_history_select on public.inventory_history for select to authenticated
  using (public.has_role(array['km','bendahara']));

-- ---------- ruang komunikasi -------------------------------------------------------
create policy rooms_select on public.chat_rooms for select to authenticated
  using (public.can_access_room(id));
create policy rooms_write on public.chat_rooms for all to authenticated
  using (public.app_role() = 'km') with check (public.app_role() = 'km');

create policy messages_select on public.chat_messages for select to authenticated
  using (public.can_access_room(room_id));
create policy messages_insert on public.chat_messages for insert to authenticated
  with check (sender_id = auth.uid() and public.can_access_room(room_id));
create policy messages_update_own on public.chat_messages for update to authenticated
  using (sender_id = auth.uid() and public.can_access_room(room_id))
  with check (sender_id = auth.uid());
create policy messages_delete on public.chat_messages for delete to authenticated
  using (public.can_access_room(room_id) and (sender_id = auth.uid() or public.app_role() = 'km'));

-- ---------- Class Spin (hanya KM) -----------------------------------------------------
create policy spin_all on public.spin_history for all to authenticated
  using (public.app_role() = 'km') with check (public.app_role() = 'km');
create policy groups_all on public.groups for all to authenticated
  using (public.app_role() = 'km') with check (public.app_role() = 'km');
create policy group_members_all on public.group_members for all to authenticated
  using (public.app_role() = 'km') with check (public.app_role() = 'km');

-- ---------- notifikasi (milik sendiri) ---------------------------------------------------
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- ---------- app_settings (background global & playlist) ------------------------------------
-- Background boleh dibaca anon agar halaman login ikut memakai background global.
create policy settings_select_anon on public.app_settings for select to anon
  using (key = 'background');
create policy settings_select_auth on public.app_settings for select to authenticated
  using (public.app_role() is not null);
create policy settings_write_km on public.app_settings for all to authenticated
  using (public.app_role() = 'km') with check (public.app_role() = 'km');
create policy settings_music_sekretaris on public.app_settings for all to authenticated
  using (public.app_role() = 'sekretaris' and key = 'music_playlist')
  with check (public.app_role() = 'sekretaris' and key = 'music_playlist');

-- =====================================================================
-- STORAGE POLICIES (bucket dibuat di seed.sql)
-- =====================================================================
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname like 'synora_%'
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

-- avatars: KM/Sekretaris di semua folder; pengguna lain hanya di folder bernama UID sendiri
create policy synora_avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.app_role() is not null);
create policy synora_avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.app_role() is not null and
    (public.has_role(array['km','sekretaris']) or (storage.foldername(name))[1] = auth.uid()::text));
create policy synora_avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and public.app_role() is not null and
    (public.has_role(array['km','sekretaris']) or (storage.foldername(name))[1] = auth.uid()::text));
create policy synora_avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.app_role() is not null and
    (public.has_role(array['km','sekretaris']) or (storage.foldername(name))[1] = auth.uid()::text));

-- memories: baca semua pengguna aktif; tulis KM/Sekretaris
create policy synora_memories_read on storage.objects for select to authenticated
  using (bucket_id = 'memories' and public.app_role() is not null);
create policy synora_memories_write on storage.objects for all to authenticated
  using (bucket_id = 'memories' and public.has_role(array['km','sekretaris']))
  with check (bucket_id = 'memories' and public.has_role(array['km','sekretaris']));

-- documents (privat): KM/Sekretaris penuh; dosen hanya dokumen yang diizinkan
create policy synora_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (
    public.has_role(array['km','sekretaris']) or
    (public.has_role(array['dosen']) and exists (
      select 1 from public.documents d where d.file_path = name and d.visible_to_lecturers))));
create policy synora_documents_write on storage.objects for all to authenticated
  using (bucket_id = 'documents' and public.has_role(array['km','sekretaris']))
  with check (bucket_id = 'documents' and public.has_role(array['km','sekretaris']));

-- proofs (privat): KM dan Bendahara
create policy synora_proofs_all on storage.objects for all to authenticated
  using (bucket_id = 'proofs' and public.has_role(array['km','bendahara']))
  with check (bucket_id = 'proofs' and public.has_role(array['km','bendahara']));

-- backgrounds: baca semua pengguna aktif; tulis hanya KM
create policy synora_backgrounds_read on storage.objects for select to authenticated
  using (bucket_id = 'backgrounds' and public.app_role() is not null);
create policy synora_backgrounds_write on storage.objects for all to authenticated
  using (bucket_id = 'backgrounds' and public.app_role() = 'km')
  with check (bucket_id = 'backgrounds' and public.app_role() = 'km');

-- music: baca semua; tulis KM/Sekretaris
create policy synora_music_read on storage.objects for select to authenticated
  using (bucket_id = 'music' and public.app_role() is not null);
create policy synora_music_write on storage.objects for all to authenticated
  using (bucket_id = 'music' and public.has_role(array['km','sekretaris']))
  with check (bucket_id = 'music' and public.has_role(array['km','sekretaris']));

-- chat (privat): lampiran hanya terbaca bila pemanggil boleh membaca pesan yang memuatnya
create policy synora_chat_read on storage.objects for select to authenticated
  using (bucket_id = 'chat' and exists (
    select 1 from public.chat_messages m where m.attachment_path = name));
create policy synora_chat_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat' and public.app_role() is not null);
create policy synora_chat_delete on storage.objects for delete to authenticated
  using (bucket_id = 'chat' and public.app_role() = 'km');
