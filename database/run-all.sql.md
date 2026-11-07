# Urutan menjalankan SQL (SQL Editor Supabase, satu per satu)
Dasar (SYNORA kelas): schema.sql → relationships.sql → rls-policies.sql → seed.sql
Academic: migrations/010_lifecycle → 020_prodi → 030_pmb → 040_finance → 050_akademik → 060_praktikum → 070_skripsi → 080_workflows → **085_scope** → 090_rls → 092_rpc_extra → 095_views
(Atau jalankan sekaligus: synora-academic-FULL-migrasi.sql.)
Lalu **seed-umc.sql** (7 fakultas + 22 prodi UMC — periksa dulu daftar & kode prodi sebelum dijalankan).

Semua file aman dijalankan ulang; migrasi hanya menambah kolom/tabel.
Akun pertama: bootstrap-admin.sql (super_admin). Deploy Edge Function: `npx supabase functions deploy admin-users` (WAJIB deploy ulang setelah update ini).

## Cakupan akses (fakultas/prodi)
- super_admin & admin_universitas: seluruh universitas (tanpa cakupan).
- dekan: 1 fakultas (hanya baca). kaprodi/admin_prodi: 1 prodi. admin_pmb/admin_keuangan: 1 prodi atau 1 fakultas.
- Atur lewat Pengaturan > Manajemen Pengguna (kolom Cakupan), atau SQL:
  `insert into user_scopes(user_id, program_id) values ('<uuid user>', '<uuid prodi>') on conflict (user_id) do update set program_id=excluded.program_id, faculty_id=null;`
- Staf tanpa cakupan tidak melihat data apa pun.
- Ketua kelas/sekretaris: NIM harus ada di tabel students dan menjadi anggota kelas agar agenda kelas & prodi otomatis terisi.
- Batasan: modul tingkat kelas lama (absensi, kas, inventaris, perpustakaan, kenangan, chat) masih satu kelas (TI24D).
