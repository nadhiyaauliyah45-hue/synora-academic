// auth.js — login, logout, sesi, dan pemuatan role pengguna.
import { sb, isConfigured } from './supabase.js';
import { EMAIL_DOMAIN, APP } from './config.js';
import { pageUrl } from './loader.js';
import { $, esc, openModal } from './utils.js';
import { ROLES } from './permissions.js';

export const nimToEmail = (nim) => `${String(nim).trim().toLowerCase()}@${EMAIL_DOMAIN}`;

export async function login(nim, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email: nimToEmail(nim), password });
  if (error) {
    if (/invalid login/i.test(error.message)) throw new Error('NIM/username atau password salah.');
    throw error;
  }
  const ctx = await loadContext(data.user);
  if (!ctx.profile) { await sb.auth.signOut(); throw new Error('Akun belum memiliki profil. Hubungi Ketua Kelas.'); }
  if (!ctx.profile.is_active) { await sb.auth.signOut(); throw new Error('Akun Anda dinonaktifkan. Hubungi Ketua Kelas.'); }
  if (!ctx.role) { await sb.auth.signOut(); throw new Error('Akun belum memiliki role. Hubungi Ketua Kelas.'); }
  return ctx;
}

export async function logout() {
  try { await sb.auth.signOut(); } catch { /* abaikan */ }
  sessionStorage.clear();
  location.href = pageUrl('login');
}

export async function loadContext(user) {
  const [{ data: profile }, { data: roleRow }] = await Promise.all([
    sb.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    sb.from('user_roles').select('role').eq('user_id', user.id).maybeSingle(),
  ]);
  return { user, profile, role: roleRow?.role || null };
}

/** Dipakai semua halaman terproteksi: kembalikan konteks atau arahkan ke login. */
export async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.replace(pageUrl('login')); return new Promise(() => {}); }
  const ctx = await loadContext(session.user);
  if (!ctx.profile?.is_active || !ctx.role) {
    await sb.auth.signOut();
    location.replace(pageUrl('login') + '?reason=inactive');
    return new Promise(() => {});
  }
  return ctx;
}

/* ---------- Halaman login (index.html) ---------- */
export async function initLoginPage() {
  const form = $('#login-form');
  const errBox = $('#login-error');
  const setupBox = $('#setup-banner');
  const showError = (msg) => { errBox.classList.remove('hidden'); errBox.innerHTML = `<i class="bi bi-exclamation-circle-fill"></i><span>${esc(msg)}</span>`; };

  const showPass = $('#show-pass');
  const passInput = $('#password');
  const eye = $('#toggle-eye');
  const setVisible = (v) => { passInput.type = v ? 'text' : 'password'; showPass.checked = v; eye.innerHTML = `<i class="bi ${v ? 'bi-eye-slash' : 'bi-eye'}"></i>`; };
  eye.addEventListener('click', () => setVisible(passInput.type === 'password'));
  showPass.addEventListener('change', () => setVisible(showPass.checked));

  $('#forgot-link').addEventListener('click', (e) => {
    e.preventDefault();
    openModal({
      title: 'Lupa Password?', size: 'sm', footer: '<button class="btn btn-primary" data-close>Mengerti</button>',
      content: `<p>Akun SYNORA dikelola oleh Ketua Kelas. Hubungi Ketua Kelas untuk mereset password Anda
      (Pengaturan &gt; Manajemen Pengguna &gt; Reset Password), lalu ganti password sementara setelah berhasil masuk.</p>`,
    });
  });

  if (new URLSearchParams(location.search).get('reason') === 'inactive')
    showError('Sesi berakhir atau akun Anda tidak aktif. Silakan masuk kembali atau hubungi Ketua Kelas.');

  if (!isConfigured) {
    setupBox.classList.remove('hidden');
    $('#btn-login').disabled = true;
    return;
  }

  // Sudah login? langsung ke dashboard.
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    const ctx = await loadContext(session.user);
    if (ctx.profile?.is_active && ctx.role) { location.replace(pageUrl('dashboard')); return; }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');
    let nim = $('#nim').value.trim();
    const pw = passInput.value;
    // Boleh mengetik NIM saja, atau email lengkap NIM@synora.local.
    if (nim.includes('@')) {
      const [u, d] = nim.split('@');
      if (d.toLowerCase() !== EMAIL_DOMAIN) return showError(`Cukup ketik NIM/username Anda (tanpa @${EMAIL_DOMAIN}).`);
      nim = u;
    }
    if (!nim) return showError('NIM atau username wajib diisi.');
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(nim)) return showError('Format NIM/username tidak valid.');
    if (!pw) return showError('Password wajib diisi.');
    const btn = $('#btn-login');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span> Memproses...';
    try {
      await login(nim, pw);
      location.href = pageUrl('dashboard');
    } catch (err) {
      showError(err.message || 'Gagal masuk.');
      btn.disabled = false;
      btn.innerHTML = 'Masuk <i class="bi bi-arrow-right"></i>';
    }
  });
}

export { ROLES, APP };
