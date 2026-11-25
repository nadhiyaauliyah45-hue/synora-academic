# Urutan menjalankan SQL (SQL Editor Supabase, satu per satu)
Dasar (SYNORA kelas): schema.sql → relationships.sql → rls-policies.sql → seed.sql
Academic: migrations/010_lifecycle → 020_prodi → 030_pmb → 040_finance → 050_akademik → 060_praktikum → 070_skripsi → 080_workflows → **085_scope** → 090_rls → 092_rpc_extra → 095_views → **100_pmb_otp** → **110_pmb_test**
(Atau jalankan sekaligus: synora-academic-FULL-migrasi.sql.)
Lalu **seed-umc.sql** (7 fakultas + 22 prodi UMC — periksa dulu daftar & kode prodi sebelum dijalankan).

Semua file aman dijalankan ulang; migrasi hanya menambah kolom/tabel.
Akun pertama: bootstrap-admin.sql (super_admin). Deploy Edge Function: `npx supabase functions deploy admin-users` (WAJIB deploy ulang setelah update ini).

## Cakupan akses (fakultas/prodi)
- super_admin & admin_universitas: seluruh universitas (tanpa cakupan).
- dekan: 1 fakultas (hanya baca). kaprodi/admin_prodi: 1 prodi. admin_pmb: 1 prodi (PMB per prodi). admin_keuangan: 1 prodi atau 1 fakultas.
- Atur lewat Pengaturan > Manajemen Pengguna (kolom Cakupan), atau SQL:
  `insert into user_scopes(user_id, program_id) values ('<uuid user>', '<uuid prodi>') on conflict (user_id) do update set program_id=excluded.program_id, faculty_id=null;`
- Staf tanpa cakupan tidak melihat data apa pun.
- Ketua kelas/sekretaris: NIM harus ada di tabel students dan menjadi anggota kelas agar agenda kelas & prodi otomatis terisi.
- Batasan: modul tingkat kelas lama (absensi, kas, inventaris, perpustakaan, kenangan, chat) masih satu kelas (TI24D).

## Pendaftaran PMB mandiri (OTP email)
- Jalankan `100_pmb_otp.sql`, atur secret SMTP, dan deploy `pmb-register` (lihat `supabase/functions/pmb-register/README.md`).
- Halaman publik: `pages/pmb-daftar.html`. Login calon mahasiswa memakai **nomor pendaftaran** (PMB-TAHUN-NOMOR) + kata sandi; role `calon_mahasiswa` hanya melihat pendaftarannya sendiri.
- `100_pmb_otp.sql` mengubah `app_role()` agar tidak menghitung calon mahasiswa; jangan menjalankan ulang `rls-policies.sql` setelahnya tanpa menjalankan 100 lagi.
- Pendaftar hanya bisa memilih prodi yang punya periode PMB terbuka (dibuat Admin PMB/Kaprodi di menu PMB).

## Tes PMB online & kalender otomatis (110_pmb_test.sql)
- Calon mahasiswa daftar sendiri (OTP email), unggah berkas sendiri di menu *Pendaftaran Saya*; Admin PMB memverifikasi berkas (ktp, kk, ijazah, pas_foto wajib).
- Admin PMB/Kaprodi: menu PMB > tab *Tes Seleksi* — buat tes per periode (jadwal, durasi, batas lulus 75), isi soal pilihan ganda, publikasikan.
- Hasil otomatis: nilai **> 75** = Diterima, nilai **<= 75** = Tidak Lolos (Admin PMB tetap bisa mengoreksi status).
- Kalender otomatis (kolom `source_type/source_id`): jadwal tes PMB (saat dipublikasikan), sidang skripsi, dan sesi praktikum tersalin ke Kalender tingkat prodi; ubah/hapus lewat jadwal asalnya, bukan dari kalender.
