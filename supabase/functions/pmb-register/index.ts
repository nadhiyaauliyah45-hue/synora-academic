// Edge Function: pmb-register — pendaftaran PMB mandiri dengan verifikasi email OTP (6 digit, dikirim lewat SMTP sungguhan).
//
// Aksi (POST JSON):
//   send_otp   { email, full_name }                       -> kirim kode OTP ke email (jeda 60 dtk, rate limit)
//   verify_otp { email, code }                            -> validasi OTP; sukses mengembalikan token verifikasi (berlaku 30 menit)
//   register   { email, token, period_id, password, data } -> buat pendaftaran + akun login (ID login = nomor pendaftaran)
//
// Keamanan: OTP dibuat & di-hash (HMAC-SHA256) di database; kode TIDAK pernah dikirim ke browser, response, ataupun log.
// Semua rahasia hanya di Secrets Edge Function (JANGAN di frontend):
//   supabase secrets set SMTP_HOST=... SMTP_PORT=587 SMTP_USER=... SMTP_PASS=... SMTP_FROM=pmb@domain.ac.id \
//                        SMTP_FROM_NAME="PMB Universitas Muhammadiyah Cirebon" OTP_PEPPER=<acak 32+ karakter>
// Deploy: supabase functions deploy pmb-register

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("PMB_ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const DOMAIN = Deno.env.get("EMAIL_DOMAIN") ?? "synora.local";
const FROM_NAME = Deno.env.get("SMTP_FROM_NAME") ?? "PMB Universitas Muhammadiyah Cirebon";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function sha256hex(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ---------- Email ----------
async function sendMail(to: string, subject: string, text: string, html: string) {
  const host = Deno.env.get("SMTP_HOST"), user = Deno.env.get("SMTP_USER"), pass = Deno.env.get("SMTP_PASS"), from = Deno.env.get("SMTP_FROM");
  if (!host || !user || !pass || !from) throw new Error("SMTP belum dikonfigurasi (SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM).");
  const port = Number(Deno.env.get("SMTP_PORT") ?? "587");
  const client = new SMTPClient({
    connection: { hostname: host, port, tls: port === 465, auth: { username: user, password: pass } },
  });
  try {
    await client.send({ from: `${FROM_NAME} <${from}>`, to, subject, content: text, html });
  } finally {
    try { await client.close(); } catch { /* abaikan */ }
  }
}

function layout(title: string, bodyHtml: string) {
  return `<!doctype html><html lang="id"><body style="margin:0;background:#f4f1ec;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6dfd5">
<tr><td style="background:#C8102E;color:#fff;padding:20px 28px">
  <div style="font-size:12px;letter-spacing:2px;opacity:.9">PENERIMAAN MAHASISWA BARU</div>
  <div style="font-size:20px;font-weight:bold;margin-top:4px">Universitas Muhammadiyah Cirebon</div></td></tr>
<tr><td style="padding:28px">${bodyHtml}</td></tr>
<tr><td style="background:#faf7f2;padding:16px 28px;font-size:12px;color:#777">Email ini dikirim otomatis oleh Sistem PMB Universitas Muhammadiyah Cirebon. Mohon tidak membalas email ini.</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendOtpMail(to: string, name: string, code: string) {
  const subject = "Kode Verifikasi Pendaftaran PMB Universitas Muhammadiyah Cirebon";
  const text = `Halo, Calon Mahasiswa Baru!\n\nTerima kasih telah mendaftar pada Sistem Penerimaan Mahasiswa Baru Universitas Muhammadiyah Cirebon.\n\nUntuk melanjutkan proses pendaftaran, silakan masukkan kode verifikasi berikut:\n\n${code}\n\nKode OTP ini berlaku selama 5 menit.\n\nJangan berikan kode OTP kepada siapa pun, termasuk pihak yang mengaku sebagai admin kampus.\n\nJika Anda tidak merasa melakukan pendaftaran, abaikan email ini.\n\nSalam,\nTim Penerimaan Mahasiswa Baru (PMB)\nUniversitas Muhammadiyah Cirebon.`;
  const html = layout(subject, `
    <p style="margin:0 0 12px;font-size:16px"><b>Halo, ${esc(name)}!</b></p>
    <p style="margin:0 0 12px;line-height:1.6">Terima kasih telah mendaftar pada Sistem Penerimaan Mahasiswa Baru Universitas Muhammadiyah Cirebon.</p>
    <p style="margin:0 0 16px;line-height:1.6">Untuk melanjutkan proses pendaftaran, silakan masukkan kode verifikasi berikut:</p>
    <div style="text-align:center;margin:20px 0"><span style="display:inline-block;font-size:34px;letter-spacing:10px;font-weight:bold;font-family:Consolas,monospace;background:#fff4f1;border:2px dashed #C8102E;color:#C8102E;border-radius:10px;padding:14px 22px">${code}</span></div>
    <p style="margin:0 0 12px;line-height:1.6">Kode OTP ini berlaku selama <b>5 menit</b>.</p>
    <p style="margin:0 0 12px;line-height:1.6;background:#fff8e1;border-left:4px solid #f0b429;padding:10px 12px"><b>Jangan berikan kode OTP kepada siapa pun</b>, termasuk pihak yang mengaku sebagai admin kampus.</p>
    <p style="margin:0 0 20px;line-height:1.6;color:#555">Jika Anda tidak merasa melakukan pendaftaran, abaikan email ini.</p>
    <p style="margin:0;line-height:1.6">Salam,<br><b>Tim Penerimaan Mahasiswa Baru (PMB)</b><br>Universitas Muhammadiyah Cirebon.</p>`);
  await sendMail(to, subject, text, html);
}

async function sendAlreadyMail(to: string, name: string) {
  const subject = "Informasi Pendaftaran PMB Universitas Muhammadiyah Cirebon";
  const text = `Halo, ${name}.\n\nAlamat email ini sudah terdaftar pada Sistem PMB Universitas Muhammadiyah Cirebon, sehingga kode verifikasi baru tidak dikirim.\n\nSilakan masuk menggunakan nomor pendaftaran (format PMB-TAHUN-NOMOR) dan kata sandi yang Anda buat. Jika Anda tidak merasa mendaftar, abaikan email ini.\n\nSalam,\nTim Penerimaan Mahasiswa Baru (PMB)\nUniversitas Muhammadiyah Cirebon.`;
  const html = layout(subject, `
    <p style="margin:0 0 12px;font-size:16px"><b>Halo, ${esc(name)}.</b></p>
    <p style="margin:0 0 12px;line-height:1.6">Alamat email ini <b>sudah terdaftar</b> pada Sistem PMB Universitas Muhammadiyah Cirebon, sehingga kode verifikasi baru tidak dikirim.</p>
    <p style="margin:0 0 12px;line-height:1.6">Silakan masuk menggunakan <b>nomor pendaftaran</b> (format <code>PMB-TAHUN-NOMOR</code>) dan kata sandi yang Anda buat. Jika Anda tidak merasa mendaftar, abaikan email ini.</p>
    <p style="margin:0;line-height:1.6">Salam,<br><b>Tim Penerimaan Mahasiswa Baru (PMB)</b></p>`);
  await sendMail(to, subject, text, html);
}

async function sendWelcomeMail(to: string, name: string, reg: string) {
  const subject = "Pendaftaran PMB Berhasil — Simpan Nomor Pendaftaran Anda";
  const text = `Halo, ${name}!\n\nPendaftaran Anda pada PMB Universitas Muhammadiyah Cirebon berhasil.\n\nNomor pendaftaran (ID login): ${reg}\n\nGunakan nomor ini dan kata sandi yang Anda buat untuk masuk dan memantau status pendaftaran. Jangan membagikan kata sandi kepada siapa pun.\n\nSalam,\nTim Penerimaan Mahasiswa Baru (PMB)\nUniversitas Muhammadiyah Cirebon.`;
  const html = layout(subject, `
    <p style="margin:0 0 12px;font-size:16px"><b>Halo, ${esc(name)}!</b></p>
    <p style="margin:0 0 12px;line-height:1.6">Pendaftaran Anda pada PMB Universitas Muhammadiyah Cirebon <b>berhasil</b>.</p>
    <div style="text-align:center;margin:18px 0"><span style="display:inline-block;font-size:22px;font-weight:bold;font-family:Consolas,monospace;background:#f4f1ec;border-radius:8px;padding:10px 18px">${esc(reg)}</span><div style="font-size:12px;color:#777;margin-top:6px">Nomor pendaftaran (ID login)</div></div>
    <p style="margin:0 0 12px;line-height:1.6">Gunakan nomor ini dan kata sandi yang Anda buat untuk masuk dan memantau status pendaftaran. Jangan membagikan kata sandi kepada siapa pun.</p>
    <p style="margin:0;line-height:1.6">Salam,<br><b>Tim Penerimaan Mahasiswa Baru (PMB)</b></p>`);
  await sendMail(to, subject, text, html);
}

// ---------- Handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const pepper = Deno.env.get("OTP_PEPPER") ?? "";
  if (pepper.length < 32) return json(500, { error: "Layanan belum dikonfigurasi (OTP_PEPPER)." });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "Permintaan tidak valid." }); }
  const action = String(body?.action ?? "");
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return json(400, { error: "Format email tidak valid." });

  try {
    // ===== 1. Kirim OTP =====
    if (action === "send_otp") {
      const name = String(body.full_name ?? "").trim().replace(/\s+/g, " ");
      if (name.length < 2 || name.length > 120) return json(400, { error: "Nama lengkap wajib diisi (2-120 karakter)." });
      const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
      const ipHash = await sha256hex(pepper + "|" + ip);
      const { data, error } = await admin.rpc("pmb_otp_issue", { p_email: email, p_name: name, p_ip_hash: ipHash, p_pepper: pepper });
      if (error || !data) return json(500, { error: "Terjadi kesalahan. Coba lagi sebentar." });
      if (!data.ok) {
        if (data.error === "cooldown") return json(429, { error: `Tunggu ${data.retry_after} detik sebelum meminta kode lagi.`, retry_after: data.retry_after });
        if (data.error === "rate_limited") return json(429, { error: "Terlalu banyak permintaan kode. Silakan coba lagi nanti.", retry_after: data.retry_after });
        return json(400, { error: data.error === "invalid_name" ? "Nama lengkap tidak valid." : "Format email tidak valid." });
      }
      try {
        if (data.registered) await sendAlreadyMail(email, name);
        else await sendOtpMail(email, name, String(data.code));
      } catch (e) {
        console.error("SMTP gagal:", (e as Error).message); // tidak pernah mencatat kode OTP
        // Batalkan OTP yang tidak sempat terkirim agar pengguna bisa mencoba lagi tanpa menunggu jeda
        await admin.from("pmb_email_otps").delete().eq("email", email).is("used_at", null).is("invalidated_at", null);
        return json(502, { error: "Email gagal dikirim. Periksa alamat email Anda atau coba lagi beberapa saat lagi." });
      }
      // Respons identik untuk email baru maupun yang sudah terdaftar (tidak membocorkan status akun)
      return json(200, { ok: true, expires_in: 300, resend_in: 60 });
    }

    // ===== 2. Verifikasi OTP =====
    if (action === "verify_otp") {
      const code = String(body.code ?? "").trim();
      const { data, error } = await admin.rpc("pmb_otp_verify", { p_email: email, p_code: code, p_pepper: pepper });
      if (error || !data) return json(500, { error: "Terjadi kesalahan. Coba lagi sebentar." });
      if (!data.ok) {
        const msg = data.error === "expired" ? "Kode sudah kedaluwarsa. Silakan minta kode baru."
          : data.error === "locked" ? "Terlalu banyak percobaan salah. Kode dinonaktifkan, silakan minta kode baru."
          : "Kode tidak valid." + (data.attempts_left != null ? ` Sisa percobaan: ${data.attempts_left}.` : "");
        return json(400, { error: msg, code: data.error, attempts_left: data.attempts_left ?? null });
      }
      return json(200, { ok: true, token: data.token });
    }

    // ===== 3. Selesaikan pendaftaran =====
    if (action === "register") {
      const token = String(body.token ?? "");
      const periodId = String(body.period_id ?? "");
      const password = String(body.password ?? "");
      if (!/^[0-9a-f]{64}$/.test(token)) return json(400, { error: "Verifikasi email belum selesai." });
      if (!UUID_RE.test(periodId)) return json(400, { error: "Pilih program studi yang tersedia." });
      if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password))
        return json(400, { error: "Password minimal 8 karakter dan mengandung huruf serta angka." });

      const { data: prep, error: pErr } = await admin.rpc("pmb_register_prepare", {
        p_token: token, p_email: email, p_period: periodId, p_data: body.data ?? {}, p_pepper: pepper });
      if (pErr || !prep) return json(500, { error: "Terjadi kesalahan. Coba lagi sebentar." });
      if (!prep.ok) {
        const m: Record<string, string> = {
          token_invalid: "Verifikasi email tidak valid. Ulangi dari awal.", token_used: "Verifikasi ini sudah digunakan.",
          token_expired: "Verifikasi email kedaluwarsa. Silakan verifikasi ulang.", registered: "Email ini sudah terdaftar. Silakan masuk.",
          period_closed: "Periode pendaftaran untuk prodi tersebut sudah ditutup.", period_full: "Pendaftaran untuk prodi tersebut sudah penuh.",
          invalid_data: "Data yang diisi tidak valid (periksa jenis kelamin dan tanggal lahir)." };
        return json(400, { error: m[prep.error] ?? "Pendaftaran gagal." });
      }
      const reg = String(prep.reg_number);
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: `${reg.toLowerCase()}@${DOMAIN}`, password, email_confirm: true });
      if (cErr || !created.user) {
        await admin.rpc("pmb_register_rollback", { p_applicant: prep.applicant_id, p_token: token, p_pepper: pepper });
        return json(500, { error: "Gagal membuat akun. Silakan coba lagi." });
      }
      const uid = created.user.id;
      const { error: e1 } = await admin.from("profiles").insert({ id: uid, nim: reg, full_name: prep.full_name, is_active: true });
      const { error: e2 } = e1 ? { error: e1 } : await admin.from("user_roles").insert({ user_id: uid, role: "calon_mahasiswa" });
      const { error: e3 } = e2 ? { error: e2 } : await admin.rpc("pmb_register_finish", { p_applicant: prep.applicant_id, p_user: uid });
      if (e1 || e2 || e3) {
        await admin.auth.admin.deleteUser(uid);
        await admin.rpc("pmb_register_rollback", { p_applicant: prep.applicant_id, p_token: token, p_pepper: pepper });
        return json(500, { error: "Gagal menyimpan akun. Silakan coba lagi." });
      }
      try { await sendWelcomeMail(email, prep.full_name, reg); } catch (e) { console.error("Email sambutan gagal:", (e as Error).message); }
      return json(200, { ok: true, reg_number: reg });
    }

    return json(400, { error: "Aksi tidak dikenal." });
  } catch (e) {
    console.error("pmb-register error:", (e as Error).message);
    return json(500, { error: "Terjadi kesalahan pada server." });
  }
});
