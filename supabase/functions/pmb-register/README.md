# pmb-register — pendaftaran PMB dengan email OTP

OTP 6 digit dibuat dan di-hash (HMAC-SHA256) di database, lalu **dikirim lewat SMTP sungguhan**. Tidak ada OTP simulasi di frontend.

## Aturan keamanan yang diterapkan
6 digit angka acak · berlaku 5 menit · sekali pakai · maksimal 5 percobaan per kode (lalu kode mati) · kirim ulang jeda 60 detik ·
kode lama mati saat kode baru dibuat · rate limit 5 permintaan/jam/email dan 20/jam/IP · hanya hash yang disimpan ·
kode tidak pernah ada di response, log, maupun frontend · pesan galat tidak membocorkan apakah email sudah terdaftar
(email terdaftar menerima email pemberitahuan, bukan kode; respons ke browser identik).

## Pasang (sekali)
1. Jalankan `database/migrations/100_pmb_otp.sql` (atau `synora-academic-FULL-migrasi.sql`).
2. Siapkan akun SMTP. Pilihan yang cocok:
   - **Brevo (Sendinblue)** gratis 300 email/hari: host `smtp-relay.brevo.com`, port `587`, user & "SMTP key" dari dashboard.
   - **Gmail**: `smtp.gmail.com`, port `587`, user = alamat Gmail, password = **App Password** (akun harus pakai verifikasi 2 langkah). Batas ±500 email/hari.
   - Layanan transaksional lain (Resend, Mailgun, SendGrid) lewat SMTP-nya.
3. Simpan rahasia (BUKAN di frontend, BUKAN di Git):
   ```
   npx supabase secrets set SMTP_HOST=smtp-relay.brevo.com SMTP_PORT=587 SMTP_USER=xxx SMTP_PASS=xxx \
        SMTP_FROM=pmb@domain-anda.ac.id SMTP_FROM_NAME="PMB Universitas Muhammadiyah Cirebon" \
        OTP_PEPPER=$(openssl rand -hex 32)
   ```
   `OTP_PEPPER` wajib ≥ 32 karakter acak. Jangan diganti setelah dipakai (kode yang sedang berlaku akan tidak valid).
4. Deploy: `npx supabase functions deploy pmb-register`

## Agar email masuk inbox (bukan spam)
- Kirim dari **domain sendiri** dan atur **SPF, DKIM, DMARC** di DNS domain pengirim (Brevo/Mailgun memberi rekamannya).
- `SMTP_FROM` harus alamat yang sudah diverifikasi di penyedia SMTP. Hindari mengirim dari Gmail pribadi untuk volume besar.
- Jika email tetap masuk spam saat uji, minta penerima menandai "Bukan spam" dan periksa skor di mail-tester.com.

## Pengujian yang WAJIB dilakukan dengan email sungguhan
Dari `pages/pmb-daftar.html`, buat satu periode PMB aktif (menu PMB) lalu uji: (1) daftar email baru, (2) OTP sampai di Gmail, (3) OTP benar, (4) OTP salah (sisa percobaan turun),
(5) OTP kedaluwarsa (tunggu >5 menit), (6) OTP dipakai dua kali, (7) kirim ulang (tombol aktif setelah 60 dtk; kode lama mati),
(8) permintaan berulang (tolak setelah 5x/jam), (9) email sudah terdaftar (terima email informasi, bukan kode), (10) SMTP salah/mati (muncul "Email gagal dikirim", bisa coba lagi).
