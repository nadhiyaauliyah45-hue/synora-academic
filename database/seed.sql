-- =====================================================================
-- SYNORA — seed.sql
-- Data awal MINIMAL yang dibutuhkan sistem (kategori, ruang chat, pengaturan, bucket).
-- Tidak ada data mahasiswa/dosen palsu: isi lewat antarmuka aplikasi (Memories, dll).
-- Jalankan SETELAH rls-policies.sql. Aman dijalankan ulang.
-- =====================================================================

-- Kategori keuangan
insert into public.finance_categories(name, type) values
  ('Iuran Kas','pemasukan'), ('Donasi','pemasukan'), ('Pemasukan Lainnya','pemasukan'),
  ('Konsumsi','pengeluaran'), ('ATK & Cetak','pengeluaran'), ('Acara Kelas','pengeluaran'),
  ('Pembelian Inventaris','pengeluaran'), ('Pengeluaran Lainnya','pengeluaran')
on conflict (name, type) do nothing;

-- Ruang komunikasi awal
insert into public.chat_rooms(name, description, kind)
select 'Pengurus Kelas', 'Diskusi internal KM, Sekretaris, dan Bendahara', 'pengurus'
where not exists (select 1 from public.chat_rooms where name = 'Pengurus Kelas');
insert into public.chat_rooms(name, description, kind)
select 'Dosen & Pengurus', 'Komunikasi antara dosen dan pengurus kelas', 'dosen_pengurus'
where not exists (select 1 from public.chat_rooms where name = 'Dosen & Pengurus');

-- Pengaturan global
insert into public.app_settings(key, value) values
  ('background',     '{"url": null, "path": null, "overlay": 0.80}'::jsonb),
  ('music_playlist', '[]'::jsonb)
on conflict (key) do nothing;

-- Storage buckets (batas ukuran & tipe file juga dijaga di level bucket)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars',     'avatars',     true,  2097152,  array['image/png','image/jpeg','image/webp']),
  ('memories',    'memories',    true,  3145728,  array['image/png','image/jpeg','image/webp']),
  ('backgrounds', 'backgrounds', true,  5242880,  array['image/png','image/jpeg','image/webp']),
  ('music',       'music',       true,  15728640, array['audio/mpeg','audio/mp3','audio/ogg','audio/wav','audio/x-wav']),
  ('documents',   'documents',   false, 20971520, array['application/pdf','application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg','image/webp']),
  ('proofs',      'proofs',      false, 5242880,  array['application/pdf','image/png','image/jpeg','image/webp']),
  ('chat',        'chat',        false, 10485760, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
