# SYNORA Academic — One Class, One Connected Space

Sistem informasi & manajemen kelas **TI24D**, Universitas Muhammadiyah Cirebon.
HTML + CSS + JavaScript murni (ES Modules) dengan **Supabase** (PostgreSQL, Auth, Storage, RLS, Realtime).
Tidak memakai framework frontend. Semua library (Supabase JS, jsPDF, SheetJS, Bootstrap Icons) sudah ada di folder `vendor/`, jadi tidak bergantung CDN (hanya font Poppins dari Google Fonts).


## SYNORA Academic (PMB → Lulus → Alumni)

Selain modul kelas, sistem kini mencakup siklus mahasiswa lengkap dalam satu database Supabase.

| Modul | Halaman | Role |
|---|---|---|
| Dashboard Kaprodi (status, kelulusan per angkatan, grafik) | `pages/kaprodi.html` | Super Admin, Admin Prodi |
| Prodi & Kelas (tahun ajaran, semester, kelas, penugasan dosen) | `pages/prodi.html` | Admin Prodi (dosen: lihat) |
| PMB (periode, pendaftar, berkas, seleksi, registrasi ulang → NIM) | `pages/pmb.html` | Admin PMB, Admin Prodi |
| KRS & Nilai (persetujuan KRS, input nilai, KHS) | `pages/academic.html` | Admin Prodi, Dosen |
| Portal Mahasiswa (mobile, navigasi bawah: status, KRS, KHS, tagihan, kelulusan) | `pages/student-portal.html` | Mahasiswa, Asisten Lab |
| Praktikum & Lab | `pages/practicum.html` | Admin Prodi, Dosen, Asisten Lab, Mahasiswa |
| Tagihan & Pembayaran (unggah bukti, verifikasi) | `pages/billing.html` | Admin Keuangan |
| Skripsi (judul, pembimbing, bimbingan, sidang) | `pages/thesis.html` | Mahasiswa, Dosen, Admin Prodi |
| Kelulusan & Alumni (syarat, yudisium, status + riwayat) | `pages/graduation.html` | Admin Prodi |

**Alur:** pendaftar → berkas lengkap → peserta seleksi → diterima / tidak lolos → (tagihan lunas) → registrasi ulang (NIM dibuat, riwayat PMB ikut terbawa) → mahasiswa baru → aktif → proses penyelesaian → mengajukan kelulusan → lulus → alumni. Status khusus (cuti, nonaktif, mengundurkan diri, DO, belum memenuhi syarat) wajib beralasan dan tercatat di `student_status_history`. "Belum memenuhi syarat" tidak pernah otomatis menjadi gagal/DO.

**Definisi laporan** (`migrations/095_views.sql`): *Terdaftar* = status mahasiswa baru ke atas (calon…registrasi ulang tidak dihitung). *% lulus dari terdaftar* = lulus ÷ terdaftar. *% lulus dari yang selesai* = lulus ÷ (lulus + mengundurkan diri + DO). Tepat waktu = batas 4 tahun (`app_settings.graduation_rules`). Syarat lulus default 144 SKS dan IPK 2,00 (ubah di `app_settings`). Bobot nilai 10/20/30/40 (kehadiran/tugas/UTS/UAS), skala A ≥ 85 … E < 40.

**Instalasi:** lihat `database/run-all.sql.md`. Akun staf pertama: `database/bootstrap-admin.sql`. Pendaftaran PMB dioperasikan Admin PMB (tidak ada pendaftaran mandiri publik). Akun mahasiswa dibuat otomatis saat registrasi ulang lewat Edge Function `admin-users` (wajib di-deploy ulang karena role baru). Pembayaran: unggah bukti + verifikasi Admin Keuangan; tidak ada payment gateway.

Status pengujian: migrasi diuji di PostgreSQL 16 (alur PMB sampai alumni dengan RLS per role, semua penolakan yang diharapkan, idempoten) dan halaman diuji di browser dengan API tiruan. **Belum diuji langsung pada proyek Supabase Anda.**

---

## Fitur (modul kelas)

| Modul | Isi |
|---|---|
| Login | NIM/username + password, tampilkan password, validasi, akun nonaktif ditolak |
| Dashboard | Sapaan, statistik, jadwal hari ini, pengumuman, agenda, aktivitas, **Mode Game**, **Drawing Board**, **Musik Instrumen** |
| Absensi | Input hadir/izin/sakit/alfa, riwayat, rekap per mahasiswa, laporan mingguan/bulanan, filter, ekspor PDF & Excel |
| Keuangan | Saldo (dihitung database, tidak disimpan), grafik 6 bulan, transaksi CRUD + bukti, kategori, laporan PDF/Excel |
| Inventaris | Bagian dari Keuangan: CRUD, riwayat perubahan otomatis (trigger), opsi catat pembelian sebagai pengeluaran kas |
| Info Mata Kuliah | Mata kuliah, jadwal mingguan, tugas, pengumuman per mata kuliah, **Kontak Dosen** |
| Perpustakaan | Upload PDF/PPT/DOC/gambar (Storage privat), link referensi, pencarian, filter, preview, unduh |
| Memories | Direktori anggota (grid 4/3/2/1 kolom), profil detail, CRUD + foto + info tambahan bebas |
| Pengaturan | Profil, Keamanan, Manajemen Pengguna, **Edit Background Global**, Tema, Notifikasi |
| Kalender | Bulanan & mingguan, 8 kategori berwarna, CRUD agenda, pengingat |
| Ruang Komunikasi | Chat Realtime per ruang, lampiran, pengumuman CRUD, notifikasi pesan baru |
| Class Spin | Pembagian kelompok acak (Fisher–Yates), merata, simpan riwayat, salin, PDF, Excel |

## Hak akses (ditegakkan oleh RLS di database)

| Modul | KM | Sekretaris | Bendahara | Dosen |
|---|---|---|---|---|
| Dashboard | Penuh | Tanpa saldo | Fokus keuangan | Tanpa saldo |
| Absensi | CRUD | CRUD | – | Lihat |
| Keuangan & Inventaris | CRUD | – | CRUD | – |
| Mata Kuliah & Kontak Dosen | CRUD | CRUD | – | Lihat |
| Perpustakaan | CRUD | CRUD | – | Lihat (yang diizinkan) |
| Memories | CRUD | CRUD | Lihat | Lihat |
| Kalender | CRUD | CRUD | – | Lihat |
| Ruang Komunikasi | Semua ruang | Semua ruang | Semua ruang pengurus | Ruang dosen–pengurus |
| Class Spin | Ya | – | – | – |
| Manajemen Pengguna & Background Global | Hanya KM | – | – | – |

Menu di frontend hanyalah pelengkap. Pembatasan sebenarnya ada di `database/rls-policies.sql`, jadi mengubah URL atau memanggil API langsung tetap ditolak.

## Struktur proyek

```
synora/
├── index.html              login
├── dashboard.html
├── pages/                  attendance, finance, inventory, courses, library,
│                           memories, settings, calendar, communication, class-spin
├── css/                    style, components, login, dashboard, responsive, themes
├── js/
│   ├── config.js           <-- SATU-SATUNYA file yang Anda isi (URL + anon key)
│   ├── supabase.js  auth.js  permissions.js  layout.js  background.js
│   ├── storage.js  export.js  utils.js  loader.js  widgets.js
│   └── dashboard.js attendance.js finance.js inventory.js courses.js library.js
│       memories.js settings.js calendar.js communication.js class-spin.js
├── database/               schema, relationships, rls-policies, seed, migrations/ (Academic), bootstrap-*.sql
├── supabase/functions/admin-users/index.ts    Edge Function manajemen akun
├── vendor/                 library lokal
└── assets/logo/
```

## Cara menjalankan (langkah demi langkah)

### 1. Buat proyek Supabase
Daftar di supabase.com, buat project baru. Catat **Project URL** dan **anon / publishable key** di *Project Settings → API*.

### 2. Jalankan SQL (urutan penting)
Buka *SQL Editor*, tempel dan jalankan satu per satu:
1. `database/schema.sql`
2. `database/relationships.sql`
3. `database/rls-policies.sql`
4. `database/seed.sql`

File ini aman dijalankan ulang. Catatan: `rls-policies.sql` menghapus semua policy lama di skema `public` lalu membuatnya kembali. Jika Anda menambah policy sendiri, simpan di file terpisah yang dijalankan sesudahnya.

### 3. Buat akun Ketua Kelas pertama
1. *Authentication → Users → Add user → Create new user*. Email: `NIM@synora.local` (contoh `240701047@synora.local`), isi password, centang **Auto Confirm User**.
2. Buka `database/bootstrap-km.sql`, ganti NIM dan nama, jalankan.

Akun lain dibuat dari dalam aplikasi: *Pengaturan → Manajemen Pengguna* (butuh langkah 5). Jika Anda sudah terlanjur membuat akun langsung di Supabase Auth, daftarkan dengan `database/add-user.sql` (mengisi `profiles` dan `user_roles`).

### 4. Konfigurasi (sudah terisi)
`js/config.js` sudah berisi Project URL `https://corpunnprtmguhpnyiqe.supabase.co` dan publishable key proyek Anda. **Jangan pernah memakai service_role key di frontend.** Password database (`postgresql://postgres:[PASSWORD]@db.corpunnprtmguhpnyiqe.supabase.co:5432/postgres`) tidak dibutuhkan aplikasi web dan tidak disimpan di mana pun dalam proyek ini.

### 5. Deploy Edge Function (untuk Manajemen Pengguna)
Membuat akun dan reset password membutuhkan hak admin yang tidak boleh ada di browser. Jalankan di terminal pada folder proyek (`supabase/config.toml` sudah disediakan, jadi **tidak perlu `supabase init`**):
```bash
# Windows: JANGAN pakai `npm i -g supabase` (tidak didukung). Pakai npx (butuh Node.js):
npx supabase login
npx supabase link --project-ref corpunnprtmguhpnyiqe
npx supabase functions deploy admin-users
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` otomatis tersedia di Edge Function. Tanpa langkah ini aplikasi tetap jalan, hanya menu Manajemen Pengguna yang menampilkan pesan "belum di-deploy".

Alternatif untuk SQL lewat CLI: `supabase db push` tidak dipakai di sini; cukup tempel 4 file SQL di SQL Editor (langkah 2).

### 6. Matikan pendaftaran mandiri
*Authentication → Providers → Email → matikan "Allow new users to sign up"*. SYNORA tidak punya fitur pendaftaran bebas, jadi tutup juga di sisi server.

### 7. Jalankan di VS Code
Aplikasi memakai ES Modules, sehingga **tidak bisa dibuka dengan klik dua kali (file://)**. Pilih salah satu:
- Pasang ekstensi **Live Server**, klik kanan `index.html` → *Open with Live Server*.
- Atau di terminal folder proyek: `python -m http.server 5500` lalu buka `http://localhost:5500`.

### 8. Deploy (opsional)
Folder ini statis. Bisa diunggah ke GitHub Pages, Netlify, atau Vercel tanpa build. Anon key memang boleh publik, karena keamanan dijaga RLS.

## Background global
*Pengaturan → Edit Background* (khusus KM): pilih gambar, lihat preview, **Terapkan Background**. Gambar masuk bucket `backgrounds`, referensinya disimpan di `app_settings` (key `background`), dan semua halaman memakai CSS variable `--app-bg-image`, sehingga satu gambar berlaku di seluruh halaman dan seluruh pengguna, termasuk setelah logout/login. Perubahan terlihat langsung oleh pengguna yang sedang membuka aplikasi (Realtime). *Reset* mengembalikan ke background default. `localStorage` hanya dipakai sebagai cache agar tidak berkedip.

## Class Spin
`js/class-spin.js` mengambil anggota dari tabel `students`, mengacak dengan Fisher–Yates memakai `crypto.getRandomValues` (tanpa modulo-bias), lalu membagi merata sehingga selisih ukuran kelompok paling banyak 1 (28 orang ÷ 5 kelompok = 6/6/6/5/5). Anggota yang tidak ikut bisa dihilangkan centangnya.

## Catatan & batasan
- **Musik Instrumen**: belum ada lagu bawaan. KM/Sekretaris menambah lagu lewat tombol "Tambah Lagu" (gunakan musik yang Anda berhak pakai).
- **Mode Game**: Memory Match, Kuis Informatika, dan Tebak Angka (bank soal kuis ada di `js/widgets.js`).
- **Tema gelap** disimpan per perangkat. Warna sidebar dan tombol tetap identitas SYNORA.
- **Tidak ada data dummy**: anggota, mata kuliah, dosen, dan transaksi diisi lewat antarmuka.
- Dosen tidak ditambahkan manual ke ruang chat: role `dosen` otomatis dapat mengakses ruang bertipe "Dosen & Pengurus".

## Pemecahan masalah
| Gejala | Penyebab / solusi |
|---|---|
| Banner "Supabase belum dikonfigurasi" | `js/config.js` kosong/berubah; harus berisi URL dan publishable key |
| "NIM/username atau password salah" | Email akun harus `NIM@synora.local` (huruf kecil) dan user sudah *Auto Confirm* |
| "Akun belum memiliki role/profil" | Jalankan `bootstrap-km.sql` (KM) atau buat akun lewat Manajemen Pengguna |
| "Anda tidak memiliki izin" | Wajar bila role tidak berhak; cek tabel hak akses |
| Upload gagal | Pastikan `seed.sql` sudah dijalankan (membuat bucket) dan tipe/ukuran file sesuai |
| Halaman kosong/modul tidak termuat | Jangan buka lewat `file://`; pakai Live Server |
