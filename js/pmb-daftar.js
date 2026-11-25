// pmb-daftar.js — pendaftaran PMB mandiri dengan verifikasi email OTP.
// Halaman publik. Hanya memakai anon key; OTP dibuat, di-hash, dan dikirim oleh Edge Function pmb-register (SMTP).
// Kode OTP tidak pernah dikirim ke browser maupun ditulis ke log/console.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const card = $('#card');
const S = { email: '', name: '', token: '', expiresAt: 0, resendAt: 0, tick: null, periods: [] };

function toast(msg, kind = 'ok') {
  const t = $('#toast'); t.textContent = msg; t.className = `toast ${kind} show`;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 4200);
}
const steps = (n) => `<div class="steps">${[['Email', 'bi-envelope'], ['Verifikasi', 'bi-shield-check'], ['Data diri', 'bi-person']].map(([l], i) => `${i ? `<div class="bar ${i < n ? 'on' : ''}"></div>` : ''}<div class="stp ${i + 1 < n ? 'done' : i + 1 === n ? 'on' : ''}"><div class="c">${i + 1 < n ? '<i class="bi bi-check-lg"></i>' : i + 1}</div><small>${l}</small></div>`).join('')}</div>`;
const busy = (btn, on, label) => { btn.disabled = on; btn.innerHTML = on ? '<span class="spin"></span> Memproses...' : label; };

async function call(action, payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/pmb-register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ action, ...payload }),
  });
  let data = {}; try { data = await res.json(); } catch { /* respons bukan JSON */ }
  if (!res.ok || data.error) { const e = new Error(data.error || 'Terjadi kesalahan jaringan. Coba lagi.'); e.data = data; e.status = res.status; throw e; }
  return data;
}
async function loadPeriods() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pmb_open_periods`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }, body: '{}' });
  if (!res.ok) throw new Error('Gagal memuat daftar program studi.');
  return res.json();
}

/* ---------- Langkah 1: nama & email ---------- */
function viewEmail() {
  clearInterval(S.tick);
  card.innerHTML = `${steps(1)}<h1>Daftar Calon Mahasiswa Baru</h1>
    <p class="sub">Masukkan nama dan email aktif Anda. Kami akan mengirim kode verifikasi 6 digit ke email tersebut.</p>
    <form id="f1" novalidate>
      <label for="name">Nama lengkap</label><input id="name" autocomplete="name" maxlength="120" required value="${esc(S.name)}" placeholder="Sesuai ijazah">
      <label for="email">Alamat email aktif</label><input id="email" type="email" inputmode="email" autocomplete="email" maxlength="254" required value="${esc(S.email)}" placeholder="nama@gmail.com">
      <div class="hint">Gunakan email pribadi yang bisa Anda buka sekarang.</div>
      <button class="btn" id="go" type="submit"><i class="bi bi-send-fill"></i> Kirim Kode Verifikasi</button>
    </form>`;
  $('#f1').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#name').value.trim().replace(/\s+/g, ' '), email = $('#email').value.trim().toLowerCase();
    if (name.length < 2) return toast('Nama lengkap wajib diisi.', 'err');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return toast('Format email tidak valid.', 'err');
    const btn = $('#go'); busy(btn, true);
    try {
      const r = await call('send_otp', { email, full_name: name });
      S.email = email; S.name = name; S.expiresAt = Date.now() + r.expires_in * 1000; S.resendAt = Date.now() + (r.resend_in || 60) * 1000;
      toast('Kode verifikasi telah dikirim ke email Anda.');
      viewOtp();
    } catch (err) {
      toast(err.message, 'err'); busy(btn, false, '<i class="bi bi-send-fill"></i> Kirim Kode Verifikasi');
    }
  });
}

/* ---------- Langkah 2: OTP ---------- */
function viewOtp() {
  card.innerHTML = `${steps(2)}<h1>Verifikasi Email</h1>
    <p class="sub">Kode 6 digit telah dikirim ke <b>${esc(S.email)}</b>. Masukkan kode tersebut di bawah ini.</p>
    <form id="f2" novalidate>
      <div class="otp" id="otp">${[0, 1, 2, 3, 4, 5].map((i) => `<input inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" aria-label="Digit ${i + 1}">`).join('')}</div>
      <div class="timer">Kode berlaku <b id="left">5:00</b></div>
      <button class="btn" id="verify" type="submit"><i class="bi bi-shield-check"></i> Verifikasi Sekarang</button>
    </form>
    <div class="timer" style="margin-top:14px">Belum menerima kode? <button class="link" id="resend" disabled>Kirim ulang kode</button> <span id="cd"></span></div>
    <button class="btn ghost" id="back" type="button">Ganti email</button>
    <div class="help"><b>Email tidak masuk?</b> Periksa folder <b>Spam/Promosi</b>, pastikan alamat email benar, lalu tunggu beberapa menit. Anda bisa meminta kode baru setelah 60 detik. <b>Jangan berikan kode kepada siapa pun.</b></div>`;
  const boxes = [...document.querySelectorAll('#otp input')];
  const code = () => boxes.map((b) => b.value).join('');
  boxes[0].focus();
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => { b.value = b.value.replace(/\D/g, '').slice(-1); if (b.value && i < 5) boxes[i + 1].focus(); if (code().length === 6) $('#f2').requestSubmit(); });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !b.value && i > 0) { boxes[i - 1].focus(); boxes[i - 1].value = ''; }
      if (e.key === 'ArrowLeft' && i > 0) boxes[i - 1].focus(); if (e.key === 'ArrowRight' && i < 5) boxes[i + 1].focus();
    });
    b.addEventListener('paste', (e) => {
      const t = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6); if (!t) return;
      e.preventDefault(); t.split('').forEach((c, k) => { boxes[k].value = c; }); boxes[Math.min(t.length, 5)].focus(); if (t.length === 6) $('#f2').requestSubmit();
    });
  });
  const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  clearInterval(S.tick);
  const tick = () => {
    const left = S.expiresAt - Date.now(), cd = Math.ceil((S.resendAt - Date.now()) / 1000);
    $('#left').textContent = left > 0 ? fmt(left) : 'habis';
    if (left <= 0) $('#left').style.color = '#b91c1c';
    $('#resend').disabled = cd > 0; $('#cd').textContent = cd > 0 ? `(${cd} dtk)` : '';
  };
  tick(); S.tick = setInterval(tick, 500);

  $('#back').addEventListener('click', viewEmail);
  $('#resend').addEventListener('click', async () => {
    const btn = $('#resend'); btn.disabled = true;
    try {
      const r = await call('send_otp', { email: S.email, full_name: S.name });
      S.expiresAt = Date.now() + r.expires_in * 1000; S.resendAt = Date.now() + (r.resend_in || 60) * 1000;
      boxes.forEach((b) => { b.value = ''; }); boxes[0].focus(); $('#left').style.color = ''; toast('Kode baru telah dikirim. Kode sebelumnya tidak berlaku lagi.');
    } catch (err) {
      if (err.data?.retry_after) S.resendAt = Date.now() + err.data.retry_after * 1000;
      toast(err.message, 'err');
    }
  });
  $('#f2').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (code().length !== 6) return toast('Masukkan 6 digit kode verifikasi.', 'err');
    const btn = $('#verify'); busy(btn, true);
    try {
      const r = await call('verify_otp', { email: S.email, code: code() });
      S.token = r.token; clearInterval(S.tick); toast('Email berhasil diverifikasi.'); await viewData();
    } catch (err) {
      toast(err.message, 'err'); busy(btn, false, '<i class="bi bi-shield-check"></i> Verifikasi Sekarang');
      boxes.forEach((b) => { b.value = ''; }); boxes[0].focus();
    }
  });
}

/* ---------- Langkah 3: data & password ---------- */
async function viewData() {
  card.innerHTML = `${steps(3)}<div style="text-align:center;padding:30px"><span class="spin" style="border-color:var(--line);border-top-color:var(--red)"></span></div>`;
  try { S.periods = await loadPeriods(); } catch (e) { S.periods = []; toast(e.message, 'err'); }
  const opts = S.periods.map((p) => `<option value="${esc(p.id)}">${esc(`${p.level || ''} ${p.program_name}`.trim())}${p.faculty_name ? ` — ${esc(p.faculty_name)}` : ''} (${esc(p.name)})</option>`).join('');
  card.innerHTML = `${steps(3)}<h1>Lengkapi Pendaftaran</h1>
    <p class="sub">Email <b>${esc(S.email)}</b> sudah terverifikasi. Buat kata sandi dan lengkapi data Anda.</p>
    ${S.periods.length ? '' : '<div class="empty"><i class="bi bi-info-circle"></i> Saat ini belum ada periode pendaftaran yang dibuka. Silakan kembali lagi nanti.</div>'}
    <form id="f3" novalidate>
      <label for="period">Program studi yang dipilih</label><select id="period" required><option value="">— Pilih program studi —</option>${opts}</select>
      <div class="row"><div><label for="gender">Jenis kelamin</label><select id="gender"><option value="">—</option><option value="L">Laki-laki</option><option value="P">Perempuan</option></select></div>
        <div><label for="phone">No. HP / WhatsApp</label><input id="phone" inputmode="tel" maxlength="20" placeholder="08xxxxxxxxxx"></div></div>
      <div class="row"><div><label for="bp">Tempat lahir</label><input id="bp" maxlength="80"></div><div><label for="bd">Tanggal lahir</label><input id="bd" type="date"></div></div>
      <label for="addr">Alamat</label><textarea id="addr" rows="2" maxlength="300"></textarea>
      <div class="row"><div><label for="school">Asal sekolah</label><input id="school" maxlength="120"></div><div><label for="major">Jurusan</label><input id="major" maxlength="80"></div></div>
      <label for="gy">Tahun lulus</label><input id="gy" type="number" min="1990" max="${new Date().getFullYear() + 1}" placeholder="${new Date().getFullYear()}">
      <label for="pw">Buat kata sandi</label><div class="pw"><input id="pw" type="password" autocomplete="new-password" minlength="8" maxlength="72"><button type="button" id="eye" aria-label="Tampilkan kata sandi"><i class="bi bi-eye"></i></button></div>
      <div class="hint">Minimal 8 karakter, mengandung huruf dan angka.</div>
      <label for="pw2">Ulangi kata sandi</label><input id="pw2" type="password" autocomplete="new-password" maxlength="72">
      <button class="btn" id="submit" type="submit" ${S.periods.length ? '' : 'disabled'}><i class="bi bi-check2-circle"></i> Selesaikan Pendaftaran</button>
    </form>`;
  $('#eye').addEventListener('click', () => { const i = $('#pw'); i.type = i.type === 'password' ? 'text' : 'password'; $('#eye i').className = i.type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash'; });
  $('#f3').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#pw').value;
    if (!$('#period').value) return toast('Pilih program studi.', 'err');
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return toast('Kata sandi minimal 8 karakter dan mengandung huruf serta angka.', 'err');
    if (pw !== $('#pw2').value) return toast('Konfirmasi kata sandi tidak sama.', 'err');
    const btn = $('#submit'); busy(btn, true);
    try {
      const r = await call('register', { email: S.email, token: S.token, period_id: $('#period').value, password: pw, data: {
        gender: $('#gender').value, phone: $('#phone').value.trim(), birth_place: $('#bp').value.trim(), birth_date: $('#bd').value,
        address: $('#addr').value.trim(), school_origin: $('#school').value.trim(), school_major: $('#major').value.trim(), grad_year: $('#gy').value } });
      viewDone(r.reg_number);
    } catch (err) { toast(err.message, 'err'); busy(btn, false, '<i class="bi bi-check2-circle"></i> Selesaikan Pendaftaran'); }
  });
}

function viewDone(reg) {
  S.token = '';
  card.innerHTML = `<div class="done"><div class="ic"><i class="bi bi-patch-check-fill"></i></div><h1>Pendaftaran Berhasil</h1>
    <p class="sub">Simpan nomor pendaftaran Anda. Nomor ini adalah ID untuk masuk bersama kata sandi yang baru dibuat (juga kami kirim ke email Anda).</p>
    <div class="regno">${esc(reg)}</div>
    <div class="next"><b>Langkah selanjutnya</b><ol><li>Masuk dengan nomor pendaftaran dan kata sandi Anda.</li><li>Unggah berkas: KTP, KK, ijazah, dan pas foto.</li><li>Tunggu berkas diverifikasi Admin PMB.</li><li>Ikuti tes seleksi online sesuai jadwal. Nilai di atas 75 dinyatakan lulus.</li></ol></div>
    <a class="btn" href="../index.html" style="text-decoration:none"><i class="bi bi-box-arrow-in-right"></i> Masuk untuk Memantau Status</a></div>`;
}

viewEmail();
