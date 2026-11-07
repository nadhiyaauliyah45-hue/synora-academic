// settings.js — Pengaturan: Profil, Keamanan, Manajemen Pengguna (KM), Edit Background global (KM), Tema, Notifikasi.
import { sb } from './supabase.js';
import { initPage, setTheme } from './layout.js';
import { can, ROLES } from './permissions.js';
import { nimToEmail, logout } from './auth.js';
import { uploadFile, removeFiles, validateFile, BUCKETS } from './storage.js';
import { getBackgroundSetting, setBackground, resetBackground, setOverlay } from './background.js';
import { $, $$, esc, ok, fail, toast, confirmDialog, formModal, openModal, loadingHTML, emptyHTML, errorHTML, avatarHTML, fmtDateTime } from './utils.js';

const { ctx, content } = await initPage('settings');
const isKM = ['km', 'super_admin'].includes(ctx.role);
const isSA = ctx.role === 'super_admin'; // Manajemen Pengguna: hanya Super Admin
let profile = ctx.profile;
const SECTIONS = [
  { id: 'profile', label: 'Profil', icon: 'bi-person-fill' },
  { id: 'security', label: 'Keamanan', icon: 'bi-shield-lock-fill' },
  ...(isSA ? [{ id: 'users', label: 'Manajemen Pengguna', icon: 'bi-people-fill' }] : []),
  ...(isKM ? [{ id: 'background', label: 'Edit Background', icon: 'bi-image-fill' }] : []),
  { id: 'theme', label: 'Tema Tampilan', icon: 'bi-palette-fill' },
  { id: 'notif', label: 'Notifikasi', icon: 'bi-bell-fill' },
];
let section = (location.hash || '#profile').slice(1);
if (!SECTIONS.some((s) => s.id === section)) section = 'profile';

content.innerHTML = `<div class="settings-layout"><nav class="settings-nav" id="snav"><h3><i class="bi bi-gear-fill"></i> Pengaturan</h3>${SECTIONS.map((s) => `<button data-s="${s.id}"><i class="bi ${s.icon}"></i> ${s.label}</button>`).join('')}</nav><div id="sbody"></div></div>`;
const go = (id) => { section = id; history.replaceState(null, '', '#' + id); $$('[data-s]', $('#snav')).forEach((b) => b.classList.toggle('active', b.dataset.s === id)); ({ profile: pProfile, security: pSecurity, users: pUsers, background: pBackground, theme: pTheme, notif: pNotif })[id](); };
$$('[data-s]', $('#snav')).forEach((b) => b.addEventListener('click', () => go(b.dataset.s)));

/* ===================== PROFIL ===================== */
function pProfile() {
  $('#sbody').innerHTML = `<div class="card"><h3 class="mb">Profil</h3>
    <div class="flex mb">${avatarHTML(profile.full_name, profile.avatar_url, 'xl')}<div><button class="btn btn-secondary btn-sm" id="pick"><i class="bi bi-camera"></i> Ganti Foto</button> ${profile.avatar_path ? '<button class="btn btn-danger btn-sm" id="rm-photo">Hapus</button>' : ''}<input type="file" id="pf" class="hidden" accept=".png,.jpg,.jpeg,.webp"><div class="small muted mt">${BUCKETS.avatars.label}</div></div></div>
    <form id="pform" class="form-grid" novalidate><div class="form-group"><label>Nama lengkap <span class="req">*</span></label><input class="input" id="pn" maxlength="120" value="${esc(profile.full_name)}"><span class="err" id="pn-err"></span></div>
      <div class="form-group"><label>NIM / Username</label><input class="input" value="${esc(profile.nim)}" readonly><span class="help">Diubah oleh Ketua Kelas bila perlu.</span></div>
      <div class="form-group"><label>Jabatan</label><input class="input" value="${esc(ROLES[ctx.role])}" readonly></div>
      <div class="form-group"><label>Status akun</label><input class="input" value="${profile.is_active ? 'Aktif' : 'Nonaktif'}" readonly></div>
      <div class="form-group full"><button class="btn btn-primary">Simpan Profil</button></div></form></div>`;
  $('#pick').addEventListener('click', () => $('#pf').click());
  $('#pf').addEventListener('change', async () => {
    const file = $('#pf').files[0]; if (!file) return;
    const err = validateFile('avatars', file); if (err) { toast(err, 'warn'); $('#pf').value = ''; return; }
    let up;
    try {
      up = await uploadFile('avatars', file, ctx.user.id);
      const { error } = await sb.from('profiles').update({ avatar_url: up.url, avatar_path: up.path }).eq('id', ctx.user.id);
      if (error) throw error;
      if (profile.avatar_path) await removeFiles('avatars', profile.avatar_path);
      profile = { ...profile, avatar_url: up.url, avatar_path: up.path };
      ok('Foto profil diperbarui.'); pProfile();
    } catch (e) { if (up) await removeFiles('avatars', up.path); fail(e); }
  });
  $('#rm-photo')?.addEventListener('click', async () => {
    const { error } = await sb.from('profiles').update({ avatar_url: null, avatar_path: null }).eq('id', ctx.user.id);
    if (error) return fail(error);
    await removeFiles('avatars', profile.avatar_path);
    profile = { ...profile, avatar_url: null, avatar_path: null }; ok('Foto dihapus.'); pProfile();
  });
  $('#pform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#pn').value.trim();
    if (name.length < 2) { $('#pn-err').textContent = 'Nama minimal 2 karakter.'; return; }
    $('#pn-err').textContent = '';
    const { error } = await sb.from('profiles').update({ full_name: name }).eq('id', ctx.user.id);
    if (error) return fail(error);
    profile = { ...profile, full_name: name }; ok('Profil disimpan. Muat ulang halaman untuk melihat nama baru di sidebar.');
  });
}

/* ===================== KEAMANAN ===================== */
function pSecurity() {
  $('#sbody').innerHTML = `<div class="card"><h3 class="mb">Keamanan</h3><h4>Ubah password</h4>
    <form id="pwform" class="form-grid mt" novalidate>
      <div class="form-group full"><label>Password saat ini <span class="req">*</span></label><input class="input" type="password" id="cur" autocomplete="current-password"></div>
      <div class="form-group"><label>Password baru <span class="req">*</span></label><input class="input" type="password" id="np" autocomplete="new-password"><span class="help">Minimal 8 karakter, kombinasi huruf dan angka.</span></div>
      <div class="form-group"><label>Ulangi password baru <span class="req">*</span></label><input class="input" type="password" id="np2" autocomplete="new-password"></div>
      <div class="form-group full"><span class="err" id="pw-err"></span><button class="btn btn-primary">Ubah Password</button></div></form>
    <div class="divider"></div><h4>Pengelolaan sesi</h4><p class="muted mt mb">Keluarkan akun Anda dari perangkat lain bila Anda merasa akun digunakan orang lain.</p>
    <div class="flex" style="flex-wrap:wrap"><button class="btn btn-secondary" id="others"><i class="bi bi-phone"></i> Keluar dari perangkat lain</button><button class="btn btn-danger" id="out"><i class="bi bi-box-arrow-right"></i> Logout</button></div></div>`;
  $('#pwform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = (m) => { $('#pw-err').textContent = m; };
    const cur = $('#cur').value, np = $('#np').value, np2 = $('#np2').value;
    if (!cur) return err('Password saat ini wajib diisi.');
    if (np.length < 8 || !/[A-Za-z]/.test(np) || !/\d/.test(np)) return err('Password baru minimal 8 karakter dengan huruf dan angka.');
    if (np !== np2) return err('Konfirmasi password tidak sama.');
    if (np === cur) return err('Password baru harus berbeda dari yang lama.');
    err('');
    const { error: e1 } = await sb.auth.signInWithPassword({ email: nimToEmail(profile.nim), password: cur });
    if (e1) return err('Password saat ini salah.');
    const { error } = await sb.auth.updateUser({ password: np });
    if (error) return err(error.message);
    ok('Password berhasil diubah.'); $('#pwform').reset();
  });
  $('#others').addEventListener('click', async () => { const { error } = await sb.auth.signOut({ scope: 'others' }); error ? fail(error) : ok('Perangkat lain telah dikeluarkan.'); });
  $('#out').addEventListener('click', logout);
}

/* ===================== MANAJEMEN PENGGUNA (KM) ===================== */
async function callAdmin(body) {
  const { data, error } = await sb.functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch { /* abaikan */ }
    if (/Failed to send|FunctionsFetchError|not found|404/i.test(msg)) msg = 'Edge Function "admin-users" belum di-deploy. Lihat README langkah 5.';
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function pUsers() {
  const box = $('#sbody'); box.innerHTML = `<div class="card">${loadingHTML()}</div>`;
  const [{ data, error }, fq, pq, sq] = await Promise.all([
    sb.from('profiles').select('*,user_roles(role)').order('full_name'),
    sb.from('faculties').select('id,code,name').order('name'),
    sb.from('study_programs').select('id,name,level,faculty_id').order('name'),
    sb.from('user_scopes').select('user_id,faculty_id,program_id'),
  ]);
  if (error) { box.innerHTML = `<div class="card">${errorHTML(error)}</div>`; return; }
  const facs = fq.data || [], progs = pq.data || [];
  const scopeOf = Object.fromEntries((sq.data || []).map((x) => [x.user_id, x]));
  const scopeLabel = (uid, role) => {
    if (['super_admin', 'admin_universitas'].includes(role)) return 'Seluruh universitas';
    const sc = scopeOf[uid]; if (!sc) return ['km', 'sekretaris', 'bendahara', 'dosen', 'mahasiswa', 'asisten_lab'].includes(role) ? '-' : '<span class="badge danger">Belum diatur</span>';
    if (sc.program_id) { const p = progs.find((x) => x.id === sc.program_id); return esc(p ? `${p.level || ''} ${p.name}`.trim() : 'Prodi'); }
    const f = facs.find((x) => x.id === sc.faculty_id); return esc(f ? `Fakultas ${f.name}` : 'Fakultas');
  };
  const facOpts = [{ value: '', label: '— tidak ada —' }, ...facs.map((f) => ({ value: f.id, label: f.name }))];
  const progOpts = [{ value: '', label: '— tidak ada —' }, ...progs.map((p) => ({ value: p.id, label: `${p.level || ''} ${p.name}`.trim() }))];
  const scopeFields = [
    { name: 'faculty_id', label: 'Cakupan Fakultas', type: 'select', options: facOpts, help: 'Wajib untuk Dekan. Opsional untuk Admin PMB/Keuangan (seluruh fakultas).' },
    { name: 'program_id', label: 'Cakupan Program Studi', type: 'select', options: progOpts, help: 'Wajib untuk Kaprodi & Admin Prodi. Isi salah satu: fakultas ATAU prodi. Kosongkan untuk Super Admin/Admin Universitas.' },
  ];
  box.innerHTML = `<div class="card"><div class="flex-between mb"><h3>Manajemen Pengguna</h3><button class="btn btn-primary" id="add-user"><i class="bi bi-person-plus-fill"></i> Tambah Akun</button></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Nama</th><th>NIM/Username</th><th>Role</th><th>Cakupan</th><th>Status</th><th></th></tr></thead><tbody>
    ${data.map((u) => { const role = Array.isArray(u.user_roles) ? u.user_roles[0]?.role : u.user_roles?.role; const self = u.id === ctx.user.id;
      return `<tr><td><div class="flex">${avatarHTML(u.full_name, u.avatar_url, 'sm')}<b>${esc(u.full_name)}</b>${self ? ' <span class="badge orange">Anda</span>' : ''}</div></td><td>${esc(u.nim)}</td><td><span class="badge">${esc(ROLES[role] || '-')}</span></td><td>${scopeLabel(u.id, role)}</td>
      <td><span class="badge ${u.is_active ? 'ok' : 'danger'}">${u.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
      <td><div class="actions"><button class="btn btn-ghost btn-icon" data-edit="${u.id}" title="Ubah nama/role"><i class="bi bi-pencil"></i></button><button class="btn btn-ghost btn-icon" data-pw="${u.id}" title="Reset password"><i class="bi bi-key"></i></button>
      ${self ? '' : `<button class="btn ${u.is_active ? 'btn-danger' : 'btn-secondary'} btn-sm" data-act="${u.id}">${u.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>`}</div></td></tr>`; }).join('')}</tbody></table></div>
    <p class="small muted mt">Pembuatan akun, perubahan role, dan reset password diproses aman lewat Edge Function (service key tidak pernah ada di browser).</p></div>`;
  const byId = Object.fromEntries(data.map((u) => [u.id, { ...u, role: Array.isArray(u.user_roles) ? u.user_roles[0]?.role : u.user_roles?.role }]));
  const roleOpts = Object.entries(ROLES).map(([v, l]) => ({ value: v, label: l }));
  $('#add-user').addEventListener('click', () => formModal({ title: 'Tambah Akun', values: { role: 'sekretaris' },
    fields: [{ name: 'full_name', label: 'Nama lengkap', required: true, maxlength: 120, full: true }, { name: 'nim', label: 'NIM / Username', required: true, pattern: '^[A-Za-z0-9._-]{3,30}$', patternMsg: '3–30 karakter huruf/angka . _ -' },
      { name: 'role', label: 'Role', type: 'select', options: roleOpts }, ...scopeFields, { name: 'password', label: 'Password awal', type: 'text', required: true, validate: (v) => (v.length < 8 ? 'Minimal 8 karakter.' : ''), full: true, help: 'Berikan ke pemilik akun; sarankan segera diganti di Pengaturan > Keamanan.' }],
    onSubmit: async (v) => { await callAdmin({ action: 'create', nim: v.nim, full_name: v.full_name, role: v.role, password: v.password, faculty_id: v.faculty_id || null, program_id: v.program_id || null }); ok('Akun berhasil dibuat.'); pUsers(); } }));
  $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => { const u = byId[b.dataset.edit]; formModal({ title: 'Ubah Akun', values: { full_name: u.full_name, role: u.role, faculty_id: scopeOf[u.id]?.faculty_id || '', program_id: scopeOf[u.id]?.program_id || '' },
    fields: [{ name: 'full_name', label: 'Nama lengkap', required: true, maxlength: 120, full: true }, { name: 'role', label: 'Role', type: 'select', options: roleOpts, full: true }, ...scopeFields],
    onSubmit: async (v) => { await callAdmin({ action: 'update', user_id: u.id, full_name: v.full_name, role: v.role, faculty_id: v.faculty_id || null, program_id: v.program_id || null }); ok('Akun diperbarui.'); pUsers(); } }); }));
  $$('[data-pw]', box).forEach((b) => b.addEventListener('click', () => { const u = byId[b.dataset.pw]; formModal({ title: `Reset Password — ${u.full_name}`, size: 'sm',
    fields: [{ name: 'password', label: 'Password sementara baru', required: true, full: true, validate: (v) => (v.length < 8 ? 'Minimal 8 karakter.' : '') }],
    onSubmit: async (v) => { await callAdmin({ action: 'set_password', user_id: u.id, password: v.password }); ok('Password direset. Sampaikan ke pemilik akun.'); } }); }));
  $$('[data-act]', box).forEach((b) => b.addEventListener('click', async () => {
    const u = byId[b.dataset.act]; const to = !u.is_active;
    if (!(await confirmDialog(`${to ? 'Aktifkan' : 'Nonaktifkan'} akun ${u.full_name}?`, { danger: !to }))) return;
    try { await callAdmin({ action: 'set_active', user_id: u.id, active: to }); ok(to ? 'Akun diaktifkan.' : 'Akun dinonaktifkan.'); pUsers(); } catch (e) { fail(e); }
  }));
}

/* ===================== EDIT BACKGROUND GLOBAL (KM) ===================== */
async function pBackground() {
  const box = $('#sbody'); box.innerHTML = `<div class="card">${loadingHTML()}</div>`;
  let cur;
  try { cur = await getBackgroundSetting(); } catch (e) { box.innerHTML = `<div class="card">${errorHTML(e)}</div>`; return; }
  let file = null, previewUrl = null;
  box.innerHTML = `<div class="card"><div class="bg-section-title">GLOBAL BACKGROUND CUSTOMIZATION</div><p class="muted mb">Ubah background seluruh halaman SYNORA hanya dengan satu gambar. Semua pengguna akan melihat gambar yang sama.</p>
    <div class="grid grid-2"><div><h4 class="mb">Background saat ini</h4><div class="bg-preview" id="cur-prev" style="${cur.url ? `background-image:url('${esc(cur.url)}')` : 'background:linear-gradient(135deg,#FFF9F0,#F4E8D6)'}"><span class="tag">${cur.url ? 'Kustom' : 'Default SYNORA'}</span><div class="ov" style="background:rgba(255,249,240,${cur.overlay})"></div></div></div>
      <div><h4 class="mb">Upload Background</h4><div class="dropzone" id="dz" tabindex="0"><i class="bi bi-cloud-arrow-up-fill"></i><strong>Upload Gambar</strong><small>Klik untuk memilih file<br>${BUCKETS.backgrounds.label}</small></div><input type="file" id="bgf" class="hidden" accept=".png,.jpg,.jpeg,.webp"><div id="new-prev" class="mt"></div></div></div>
    <div class="form-group mt"><label>Ketebalan overlay (agar teks tetap terbaca): <b id="ov-v">${Math.round(cur.overlay * 100)}%</b></label><input type="range" id="ov" min="30" max="95" value="${Math.round(cur.overlay * 100)}"></div>
    <div class="flex mt" style="flex-wrap:wrap"><button class="btn btn-primary" id="apply" disabled>Terapkan Background</button><button class="btn btn-secondary" id="reset">Reset Background</button><button class="btn btn-ghost" id="save-ov">Simpan Ketebalan Overlay</button></div></div>`;
  const dz = $('#dz'), inp = $('#bgf');
  const pick = (f) => {
    const err = validateFile('backgrounds', f); if (err) { toast(err, 'warn'); return; }
    file = f; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = URL.createObjectURL(f);
    $('#new-prev').innerHTML = `<div class="bg-preview" style="background-image:url('${previewUrl}')"><span class="tag">Preview: ${esc(f.name)}</span><div class="ov" style="background:rgba(255,249,240,${$('#ov').value / 100})"></div></div>`;
    $('#apply').disabled = false;
  };
  dz.addEventListener('click', () => inp.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') inp.click(); });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); }); dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); });
  inp.addEventListener('change', () => inp.files[0] && pick(inp.files[0]));
  $('#ov').addEventListener('input', () => { $('#ov-v').textContent = $('#ov').value + '%'; $$('.bg-preview .ov', box).forEach((o) => { o.style.background = `rgba(255,249,240,${$('#ov').value / 100})`; }); });
  $('#apply').addEventListener('click', async () => {
    if (!file) return; const b = $('#apply'); b.disabled = true; b.textContent = 'Menerapkan...';
    try { await setBackground(file, ctx.user.id, $('#ov').value / 100); ok('Background diterapkan ke seluruh halaman SYNORA.'); pBackground(); } catch (e) { fail(e); b.disabled = false; b.textContent = 'Terapkan Background'; }
  });
  $('#reset').addEventListener('click', async () => { if (!(await confirmDialog('Kembalikan background ke default SYNORA untuk semua pengguna?', { okText: 'Reset', danger: false }))) return; try { await resetBackground(ctx.user.id); ok('Background dikembalikan ke default.'); pBackground(); } catch (e) { fail(e); } });
  $('#save-ov').addEventListener('click', async () => { try { await setOverlay($('#ov').value / 100, ctx.user.id); ok('Ketebalan overlay disimpan.'); } catch (e) { fail(e); } });
}

/* ===================== TEMA ===================== */
function pTheme() {
  let t = 'light'; try { t = localStorage.getItem('synora_theme') || 'light'; } catch { /* abaikan */ }
  $('#sbody').innerHTML = `<div class="card"><h3 class="mb">Tema Tampilan</h3><p class="muted mb">Pilihan tema disimpan di perangkat ini. Background global tetap sama untuk semua pengguna.</p>
    <div class="grid grid-2"><label class="card" style="cursor:pointer"><span class="check"><input type="radio" name="th" value="light" ${t === 'light' ? 'checked' : ''}> <b>Terang</b></span><p class="small muted mt">Tampilan cream hangat (default SYNORA).</p></label>
    <label class="card" style="cursor:pointer"><span class="check"><input type="radio" name="th" value="dark" ${t === 'dark' ? 'checked' : ''}> <b>Gelap</b></span><p class="small muted mt">Nyaman untuk malam hari.</p></label></div></div>`;
  $$('[name=th]').forEach((r) => r.addEventListener('change', () => { setTheme(r.value); ok('Tema diterapkan.'); }));
}

/* ===================== NOTIFIKASI ===================== */
async function pNotif() {
  const box = $('#sbody'); box.innerHTML = `<div class="card">${loadingHTML()}</div>`;
  const { data, error } = await sb.from('notifications').select('*').eq('user_id', ctx.user.id).order('created_at', { ascending: false }).limit(50);
  if (error) { box.innerHTML = `<div class="card">${errorHTML(error)}</div>`; return; }
  box.innerHTML = `<div class="card"><div class="flex-between mb"><h3>Notifikasi</h3><div class="flex"><button class="btn btn-secondary btn-sm" id="rd">Tandai semua dibaca</button><button class="btn btn-danger btn-sm" id="clr">Hapus semua</button></div></div>
    ${data.length ? data.map((n) => `<div class="act-item"><i class="bi ${n.is_read ? 'bi-bell' : 'bi-bell-fill'}" style="color:${n.is_read ? 'var(--muted)' : 'var(--orange)'};margin-top:3px"></i><div><strong>${esc(n.title)}</strong><div>${esc(n.body || '')}</div><small>${fmtDateTime(n.created_at)}</small></div></div>`).join('') : emptyHTML('Belum ada notifikasi.', 'bi-bell-slash')}</div>`;
  $('#rd').addEventListener('click', async () => { await sb.from('notifications').update({ is_read: true }).eq('user_id', ctx.user.id); ok('Semua ditandai dibaca.'); pNotif(); });
  $('#clr').addEventListener('click', async () => { if (!(await confirmDialog('Hapus semua notifikasi Anda?'))) return; const { error: e } = await sb.from('notifications').delete().eq('user_id', ctx.user.id); e ? fail(e) : (ok('Notifikasi dihapus.'), pNotif()); });
}

go(section);
