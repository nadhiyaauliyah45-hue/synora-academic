// class-spin.js — pembagian kelompok acak. Algoritma Fisher–Yates (crypto RNG) + pembagian merata; hasil bisa disimpan/ekspor.
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { can } from './permissions.js';
import { exportPdf, exportXlsx } from './export.js';
import { $, $$, esc, ok, fail, toast, confirmDialog, loadingHTML, emptyHTML, errorHTML, copyText, fmtDateTime, openModal } from './utils.js';

const { ctx, content } = await initPage('class-spin');
export const GROUP_COLORS = ['#E9593C', '#3E9B5A', '#3C7DB8', '#E98532', '#8B5FBF', '#E4B23B', '#2A9CA8', '#D6475F', '#6B7A2F', '#7D5A44'];

/** Angka acak seragam 0..n-1 tanpa modulo-bias, memakai crypto.getRandomValues. */
export function randInt(n) {
  const max = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= max);
  return buf[0] % n;
}
/** Fisher–Yates shuffle (tidak mengubah array asal). */
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** Bagi n orang ke g kelompok seadil mungkin: selisih ukuran maksimal 1 (28/5 -> 6,6,6,5,5). */
export function splitGroups(people, g) {
  const sh = shuffle(people);
  const base = Math.floor(sh.length / g), extra = sh.length % g;
  const out = []; let idx = 0;
  for (let k = 0; k < g; k++) { const size = base + (k < extra ? 1 : 0); out.push(sh.slice(idx, idx + size)); idx += size; }
  return out;
}

let students = [], excluded = new Set(), result = null, saved = false;
let numGroups = 5, perGroup = null, mode = 'groups';

content.innerHTML = `<div class="page-header"><div><h1>Class Spin</h1><p>Ayo bagi kelompok secara acak!</p></div></div>
  <div class="spin-layout">
    <div class="card" id="ctl">${loadingHTML()}</div>
    <div><div class="card"><div class="flex-between mb"><div class="card-title" style="margin:0"><i class="bi bi-diagram-3-fill"></i> Hasil Pembagian Kelompok</div><span id="res-meta" class="small muted"></span></div>
      <div id="shuffle-names" class="shuffle-names"></div><div id="res">${emptyHTML('Atur jumlah kelompok lalu tekan "Mulai Acak".', 'bi-shuffle')}</div>
      <div class="toolbar mt hidden" id="res-actions">
        <button class="btn btn-secondary btn-sm" id="re"><i class="bi bi-arrow-repeat"></i> Acak Ulang</button>
        <button class="btn btn-primary btn-sm" id="save"><i class="bi bi-save"></i> Simpan Hasil</button>
        <button class="btn btn-secondary btn-sm" id="copy"><i class="bi bi-clipboard"></i> Salin</button>
        <button class="btn btn-secondary btn-sm" id="pdf"><i class="bi bi-file-earmark-pdf"></i> Unduh PDF</button>
        <button class="btn btn-secondary btn-sm" id="xls"><i class="bi bi-file-earmark-excel"></i> Excel</button></div></div>
      <div class="card mt"><div class="card-title"><i class="bi bi-clock-history"></i> Riwayat Pembagian</div><div id="hist">${loadingHTML()}</div></div></div>
  </div>`;

const active = () => students.filter((s) => !excluded.has(s.id));

function drawControls() {
  const n = active().length;
  numGroups = Math.max(1, Math.min(numGroups, Math.max(1, n)));
  $('#ctl').innerHTML = `
    <div class="wheel-wrap"><div class="wheel-pointer"></div><div class="wheel" id="wheel"></div><div class="wheel-center"><i class="bi bi-shuffle"></i></div></div>
    <div class="tabs" style="display:flex"><button class="tab ${mode === 'groups' ? 'active' : ''}" data-mode="groups">Jumlah Kelompok</button><button class="tab ${mode === 'size' ? 'active' : ''}" data-mode="size">Anggota / Kelompok</button></div>
    <div class="form-group mb">${mode === 'groups' ? `<label>Jumlah Kelompok</label><div class="stepper"><button id="gm" aria-label="Kurangi">−</button><input id="gv" type="number" min="1" max="${n || 1}" value="${numGroups}"><button id="gp" aria-label="Tambah">+</button></div>`
      : `<label>Jumlah Anggota / Kelompok</label><div class="stepper"><button id="pm" aria-label="Kurangi">−</button><input id="pv" type="number" min="1" max="${n || 1}" value="${perGroup || Math.max(1, Math.round(n / numGroups))}"><button id="pp" aria-label="Tambah">+</button></div>`}
      <span class="help" id="split-preview"></span></div>
    <button class="btn btn-primary btn-block" id="go" ${n < 2 ? 'disabled' : ''}>Mulai Acak <i class="bi bi-dice-5-fill"></i></button>
    <div class="divider"></div>
    <div class="flex-between"><strong>Anggota Kelas (${n} dari ${students.length} ikut)</strong><button class="btn btn-ghost btn-sm" id="toggle-all">Pilih semua</button></div>
    <p class="small muted">Hilangkan centang untuk anggota yang tidak ikut (mis. sedang izin).</p>
    <div class="member-pick">${students.map((s) => `<label class="check"><input type="checkbox" data-sid="${s.id}" ${excluded.has(s.id) ? '' : 'checked'}> ${esc(s.full_name)}</label>`).join('') || '<span class="muted">Belum ada anggota.</span>'}</div>`;

  const upd = () => {
    const nn = active().length;
    if (mode === 'size') { const p = Math.max(1, Number($('#pv').value) || 1); perGroup = p; numGroups = Math.max(1, Math.ceil(nn / p)); }
    const sizes = nn ? splitSizes(nn, numGroups) : [];
    $('#split-preview').textContent = nn ? `${nn} orang → ${numGroups} kelompok: ${sizes.join(' / ')} anggota` : 'Belum ada anggota yang ikut.';
  };
  $$('[data-mode]', $('#ctl')).forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; if (mode === 'size') perGroup = Math.max(1, Math.round(active().length / numGroups)); drawControls(); }));
  $('#gm')?.addEventListener('click', () => { numGroups = Math.max(1, numGroups - 1); drawControls(); });
  $('#gp')?.addEventListener('click', () => { numGroups = Math.min(Math.max(1, active().length), numGroups + 1); drawControls(); });
  $('#gv')?.addEventListener('change', () => { numGroups = Math.max(1, Math.min(active().length || 1, Math.floor(Number($('#gv').value) || 1))); drawControls(); });
  $('#pm')?.addEventListener('click', () => { perGroup = Math.max(1, (Number($('#pv').value) || 1) - 1); drawControls(); });
  $('#pp')?.addEventListener('click', () => { perGroup = Math.min(active().length || 1, (Number($('#pv').value) || 1) + 1); drawControls(); });
  $('#pv')?.addEventListener('change', () => { perGroup = Math.max(1, Math.min(active().length || 1, Math.floor(Number($('#pv').value) || 1))); drawControls(); });
  $$('[data-sid]', $('#ctl')).forEach((c) => c.addEventListener('change', () => { c.checked ? excluded.delete(c.dataset.sid) : excluded.add(c.dataset.sid); drawControls(); }));
  $('#toggle-all').addEventListener('click', () => { excluded.clear(); drawControls(); });
  $('#go').addEventListener('click', run);
  upd();
}
export const splitSizes = (n, g) => Array.from({ length: g }, (_, k) => Math.floor(n / g) + (k < n % g ? 1 : 0));

let spinning = false;
async function run() {
  if (spinning) return;
  const people = active();
  if (people.length < 2) return toast('Minimal 2 anggota untuk dibagi.', 'warn');
  if (numGroups > people.length) return toast('Jumlah kelompok melebihi jumlah anggota.', 'warn');
  if (result && !saved && !(await confirmDialog('Hasil sebelumnya belum disimpan. Acak ulang?', { okText: 'Acak ulang', danger: false }))) return;
  spinning = true;
  const wheel = $('#wheel'), names = $('#shuffle-names');
  $('#go').disabled = true;
  wheel.style.transform = `rotate(${(Number(wheel.dataset.rot || 0)) + 1080 + randInt(360)}deg)`;
  wheel.dataset.rot = String((Number(wheel.dataset.rot || 0)) + 1440);
  const t0 = Date.now();
  const tick = setInterval(() => { names.textContent = shuffle(people).slice(0, 3).map((p) => p.full_name).join(' • '); }, 90);
  await new Promise((r) => setTimeout(r, 2200));
  clearInterval(tick); names.textContent = '';
  const groups = splitGroups(people, numGroups);
  result = { groups, total: people.length, at: new Date() };
  saved = false; spinning = false; $('#go').disabled = false;
  renderResult();
}

function renderResult() {
  if (!result) return;
  $('#res-actions').classList.remove('hidden');
  $('#res-meta').textContent = `${result.total} anggota · ${result.groups.length} kelompok${saved ? ' · tersimpan' : ''}`;
  $('#res').innerHTML = `<div class="group-cards">${result.groups.map((g, i) => `<div class="group-card" style="animation-delay:${i * 70}ms"><header style="background:${GROUP_COLORS[i % GROUP_COLORS.length]}"><span>Kelompok ${i + 1}</span><span>${g.length} Anggota</span></header><ol>${g.map((s) => `<li>${esc(s.full_name)}</li>`).join('')}</ol></div>`).join('')}</div>`;
  $('#save').disabled = saved;
}

const asText = () => result.groups.map((g, i) => `Kelompok ${i + 1} (${g.length} anggota)\n${g.map((s, k) => `${k + 1}. ${s.full_name}`).join('\n')}`).join('\n\n');
const asRows = () => result.groups.flatMap((g, i) => g.map((s, k) => [`Kelompok ${i + 1}`, k + 1, s.nim, s.full_name]));

async function save() {
  if (!result || saved) return;
  const defaultTitle = `Pembagian ${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  const title = prompt('Judul pembagian kelompok:', defaultTitle);
  if (title === null) return;
  const btn = $('#save'); btn.disabled = true;
  try {
    const { data: sp, error } = await sb.from('spin_history').insert({ title: title.trim() || defaultTitle, total_students: result.total, num_groups: result.groups.length, created_by: ctx.user.id }).select('id').single();
    if (error) throw error;
    const { data: gs, error: e2 } = await sb.from('groups').insert(result.groups.map((_, i) => ({ spin_id: sp.id, group_no: i + 1, name: `Kelompok ${i + 1}` }))).select('id,group_no');
    if (e2) { await sb.from('spin_history').delete().eq('id', sp.id); throw e2; }
    const idOf = Object.fromEntries(gs.map((g) => [g.group_no, g.id]));
    const members = result.groups.flatMap((g, i) => g.map((s) => ({ group_id: idOf[i + 1], student_id: s.id })));
    const { error: e3 } = await sb.from('group_members').insert(members);
    if (e3) { await sb.from('spin_history').delete().eq('id', sp.id); throw e3; }
    saved = true; ok('Hasil pembagian disimpan.'); renderResult(); loadHistory();
  } catch (e) { fail(e); btn.disabled = false; }
}

async function loadHistory() {
  const box = $('#hist');
  const { data, error } = await sb.from('spin_history').select('*,profiles:created_by(full_name)').order('created_at', { ascending: false }).limit(30);
  if (error) { box.innerHTML = errorHTML(error); return; }
  if (!data.length) { box.innerHTML = emptyHTML('Belum ada riwayat tersimpan.', 'bi-clock-history'); return; }
  box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Judul</th><th>Waktu</th><th class="num">Anggota</th><th class="num">Kelompok</th><th></th></tr></thead><tbody>
    ${data.map((h) => `<tr><td><b>${esc(h.title)}</b><br><small class="muted">${esc(h.profiles?.full_name || '-')}</small></td><td>${fmtDateTime(h.created_at)}</td><td class="num">${h.total_students}</td><td class="num">${h.num_groups}</td>
      <td><div class="actions"><button class="btn btn-secondary btn-sm" data-view="${h.id}">Lihat</button><button class="btn btn-danger btn-icon" data-del="${h.id}" title="Hapus"><i class="bi bi-trash"></i></button></div></td></tr>`).join('')}</tbody></table></div>`;
  const byId = Object.fromEntries(data.map((h) => [h.id, h]));
  $$('[data-view]', box).forEach((b) => b.addEventListener('click', () => viewHistory(byId[b.dataset.view])));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog(`Hapus riwayat "${byId[b.dataset.del].title}"?`))) return;
    const { error: e } = await sb.from('spin_history').delete().eq('id', b.dataset.del);
    if (e) fail(e); else { ok('Riwayat dihapus.'); loadHistory(); }
  }));
}

async function viewHistory(h) {
  const m = openModal({ title: h.title, size: 'lg', content: loadingHTML(), footer: '<button class="btn btn-secondary" data-close>Tutup</button>' });
  const { data, error } = await sb.from('groups').select('group_no,name,group_members(students(nim,full_name))').eq('spin_id', h.id).order('group_no');
  if (error) { m.body.innerHTML = errorHTML(error); return; }
  m.body.innerHTML = `<div class="group-cards">${data.map((g, i) => `<div class="group-card"><header style="background:${GROUP_COLORS[i % GROUP_COLORS.length]}"><span>${esc(g.name)}</span><span>${g.group_members.length} Anggota</span></header><ol>${g.group_members.map((x) => `<li>${esc(x.students?.full_name || '(anggota dihapus)')}</li>`).join('')}</ol></div>`).join('')}</div>`;
}

$('#re').addEventListener('click', run);
$('#save').addEventListener('click', save);
$('#copy').addEventListener('click', async () => { if (result) (await copyText(asText())) ? ok('Hasil disalin ke clipboard.') : toast('Gagal menyalin.', 'error'); });
$('#pdf').addEventListener('click', () => result && exportPdf({ title: 'Pembagian Kelompok Kelas TI24D', subtitle: `${result.total} anggota · ${result.groups.length} kelompok`, columns: ['Kelompok', 'No', 'NIM', 'Nama'], rows: asRows(), filename: 'pembagian-kelompok' }));
$('#xls').addEventListener('click', () => result && exportXlsx({ filename: 'pembagian-kelompok', sheets: [{ name: 'Kelompok', columns: ['Kelompok', 'No', 'NIM', 'Nama'], rows: asRows() }] }));

async function boot() {
  const { data, error } = await sb.from('students').select('id,nim,full_name').eq('is_active', true).order('full_name');
  if (error) { $('#ctl').innerHTML = errorHTML(error); return; }
  students = data;
  if (!students.length) { $('#ctl').innerHTML = emptyHTML('Belum ada anggota kelas. Tambahkan anggota lewat menu Memories.', 'bi-people'); } else drawControls();
  loadHistory();
}
boot();
