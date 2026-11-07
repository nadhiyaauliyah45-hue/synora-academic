// courses.js — Informasi Mata Kuliah + Kontak Dosen (CRUD), jadwal, tugas, dan pengumuman per mata kuliah.
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { can } from './permissions.js';
import { uploadFile, removeFiles, BUCKETS } from './storage.js';
import { $, $$, esc, ok, fail, toast, confirmDialog, openModal, formModal, loadingHTML, emptyHTML, errorHTML, tabsHTML, avatarHTML, hhmm, DAYS, fmtDate, debounce } from './utils.js';

const { ctx, content } = await initPage('courses');
const canC = can(ctx.role, 'courses', 'c'), canU = can(ctx.role, 'courses', 'u'), canD = can(ctx.role, 'courses', 'd');
const canAnn = can(ctx.role, 'announcements', 'c');
let tab = 'courses';
let lecturers = [];

function draw() {
  content.innerHTML = `<div class="page-header"><div><h1>Informasi Mata Kuliah</h1><p>Mata kuliah, jadwal, tugas, dan kontak dosen TI24D.</p></div>
    <div class="flex">${canC ? `<button class="btn btn-primary" id="add">${tab === 'courses' ? '<i class="bi bi-plus-lg"></i> Tambah Mata Kuliah' : '<i class="bi bi-plus-lg"></i> Tambah Dosen'}</button>` : ''}</div></div>
    ${tabsHTML([{ id: 'courses', label: 'Mata Kuliah', icon: 'bi-journal-bookmark' }, { id: 'lecturers', label: 'Kontak Dosen', icon: 'bi-person-lines-fill' }], tab)}<div id="tab-body">${loadingHTML()}</div>`;
  $$('[data-tab]', content).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  $('#add')?.addEventListener('click', () => (tab === 'courses' ? courseForm() : lecturerForm()));
  (tab === 'courses' ? loadCourses : loadLecturers)();
}

async function fetchLecturers() {
  const { data, error } = await sb.from('lecturers').select('*').order('full_name');
  if (error) throw error;
  lecturers = data;
}

/* ===================== MATA KULIAH ===================== */
async function loadCourses() {
  const box = $('#tab-body');
  try { await fetchLecturers(); } catch (e) { box.innerHTML = errorHTML(e); return; }
  const { data, error } = await sb.from('courses').select('*,lecturers(full_name),schedules(id,day_of_week,start_time,end_time,room)').order('name');
  if (error) { box.innerHTML = errorHTML(error); return; }
  box.innerHTML = `<div class="toolbar"><input class="input grow" id="cq" placeholder="Cari nama atau kode mata kuliah..."></div><div id="clist"></div>`;
  const render = (q = '') => {
    const rows = data.filter((c) => !q || `${c.name} ${c.code}`.toLowerCase().includes(q.toLowerCase()));
    $('#clist').innerHTML = rows.length ? `<div class="grid grid-2">${rows.map((c) => `
      <div class="card"><div class="flex-between"><div><h3>${esc(c.name)}</h3><span class="badge orange">${esc(c.code)}</span> <span class="badge">${c.sks} SKS</span></div>
        <div class="flex gap-sm">${canU ? `<button class="btn btn-ghost btn-icon" data-edit="${c.id}" title="Ubah"><i class="bi bi-pencil"></i></button>` : ''}${canD ? `<button class="btn btn-danger btn-icon" data-del="${c.id}" title="Hapus"><i class="bi bi-trash"></i></button>` : ''}</div></div>
        <dl class="kv mt"><dt>Dosen pengampu</dt><dd>${esc(c.lecturers?.full_name || '-')}</dd><dt>Ruangan</dt><dd>${esc(c.room || '-')}</dd><dt>Semester</dt><dd>${esc(c.semester || '-')}</dd>
        <dt>Jadwal</dt><dd>${c.schedules.length ? c.schedules.sort((a, b) => a.day_of_week - b.day_of_week).map((s) => `${DAYS[s.day_of_week]}, ${hhmm(s.start_time)}–${hhmm(s.end_time)}${s.room ? ' (' + esc(s.room) + ')' : ''}`).join('<br>') : '-'}</dd></dl>
        <div class="flex mt" style="flex-wrap:wrap"><button class="btn btn-secondary btn-sm" data-detail="${c.id}">Deskripsi & Tugas</button>${canU ? `<button class="btn btn-secondary btn-sm" data-sch="${c.id}"><i class="bi bi-calendar-week"></i> Atur Jadwal</button>` : ''}</div></div>`).join('')}</div>`
      : emptyHTML('Belum ada mata kuliah.', 'bi-journal-x');
    const byId = Object.fromEntries(data.map((c) => [c.id, c]));
    $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => courseForm(byId[b.dataset.edit])));
    $$('[data-sch]', box).forEach((b) => b.addEventListener('click', () => scheduleManager(byId[b.dataset.sch])));
    $$('[data-detail]', box).forEach((b) => b.addEventListener('click', () => courseDetail(byId[b.dataset.detail])));
    $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
      const c = byId[b.dataset.del];
      if (!(await confirmDialog(`Hapus mata kuliah "${c.name}"? Jadwal dan absensi mata kuliah ini ikut terhapus.`))) return;
      const { error: e } = await sb.from('courses').delete().eq('id', c.id);
      if (e) fail(e); else { ok('Mata kuliah dihapus.'); draw(); }
    }));
  };
  render();
  $('#cq').addEventListener('input', debounce(() => render($('#cq').value.trim()), 250));
}

function courseForm(existing = null) {
  formModal({
    title: existing ? 'Ubah Mata Kuliah' : 'Tambah Mata Kuliah', size: 'lg', values: existing || { sks: 2 },
    fields: [
      { name: 'code', label: 'Kode mata kuliah', required: true, maxlength: 20, pattern: '^[A-Za-z0-9._-]+$', patternMsg: 'Gunakan huruf, angka, titik, atau strip.' },
      { name: 'name', label: 'Nama mata kuliah', required: true, maxlength: 120 },
      { name: 'sks', label: 'Jumlah SKS', type: 'number', required: true, min: 1, max: 6, step: 1 },
      { name: 'semester', label: 'Semester', maxlength: 20, placeholder: 'mis. 3 / Ganjil 2025' },
      { name: 'lecturer_id', label: 'Dosen pengampu', type: 'select', options: [{ value: '', label: '— Belum ditentukan —' }, ...lecturers.map((l) => ({ value: l.id, label: l.full_name }))] },
      { name: 'room', label: 'Ruangan default', maxlength: 60 },
      { name: 'description', label: 'Deskripsi mata kuliah', type: 'textarea', full: true },
      { name: 'assignment_info', label: 'Informasi tugas', type: 'textarea', full: true, placeholder: 'Tugas/proyek yang sedang berjalan, deadline, dsb.' },
    ],
    onSubmit: async (v) => {
      const payload = { code: v.code, name: v.name, sks: v.sks, semester: v.semester, lecturer_id: v.lecturer_id || null, room: v.room, description: v.description, assignment_info: v.assignment_info };
      const { error } = existing ? await sb.from('courses').update(payload).eq('id', existing.id) : await sb.from('courses').insert(payload);
      if (error) throw error;
      ok(existing ? 'Mata kuliah diperbarui.' : 'Mata kuliah ditambahkan.'); draw();
    },
  });
}

async function courseDetail(c) {
  const m = openModal({ title: c.name, size: 'lg', content: loadingHTML(), footer: '<button class="btn btn-secondary" data-close>Tutup</button>' });
  const { data: anns } = await sb.from('announcements').select('id,title,body,created_at').eq('course_id', c.id).order('created_at', { ascending: false }).limit(10);
  m.body.innerHTML = `<dl class="kv"><dt>Kode / SKS</dt><dd>${esc(c.code)} · ${c.sks} SKS</dd><dt>Dosen</dt><dd>${esc(c.lecturers?.full_name || '-')}</dd></dl>
    <div class="divider"></div><h4>Deskripsi</h4><p class="mt" style="white-space:pre-wrap">${esc(c.description || 'Belum ada deskripsi.')}</p>
    <div class="divider"></div><h4>Informasi Tugas</h4><p class="mt" style="white-space:pre-wrap">${esc(c.assignment_info || 'Belum ada informasi tugas.')}</p>
    <div class="divider"></div><div class="flex-between"><h4>Pengumuman Mata Kuliah</h4>${canAnn ? '<button class="btn btn-secondary btn-sm" id="new-ann"><i class="bi bi-plus-lg"></i> Pengumuman</button>' : ''}</div>
    <div id="ann-box" class="mt">${anns?.length ? anns.map((a) => `<div class="ann-item"><i class="bi bi-megaphone" style="color:var(--orange);margin-top:3px"></i><div style="flex:1"><strong>${esc(a.title)}</strong><div style="white-space:pre-wrap">${esc(a.body)}</div><small>${fmtDate(a.created_at)}</small></div>${canD ? `<button class="btn btn-danger btn-icon btn-sm" data-delann="${a.id}"><i class="bi bi-trash"></i></button>` : ''}</div>`).join('') : emptyHTML('Belum ada pengumuman untuk mata kuliah ini.', 'bi-megaphone')}</div>`;
  $('#new-ann', m.root)?.addEventListener('click', () => formModal({
    title: `Pengumuman — ${c.name}`,
    fields: [{ name: 'title', label: 'Judul', required: true, maxlength: 200, full: true }, { name: 'body', label: 'Isi pengumuman', type: 'textarea', required: true, full: true }],
    onSubmit: async (v) => { const { error } = await sb.from('announcements').insert({ title: v.title, body: v.body, course_id: c.id, created_by: ctx.user.id }); if (error) throw error; ok('Pengumuman dibuat.'); m.close(); courseDetail(c); },
  }));
  $$('[data-delann]', m.root).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Hapus pengumuman ini?'))) return;
    const { error } = await sb.from('announcements').delete().eq('id', b.dataset.delann);
    if (error) fail(error); else { ok('Pengumuman dihapus.'); m.close(); courseDetail(c); }
  }));
}

async function scheduleManager(c) {
  const m = openModal({ title: `Jadwal — ${c.name}`, content: loadingHTML(), footer: '<button class="btn btn-primary" data-close>Selesai</button>', onClose: loadCourses });
  const draw2 = async () => {
    const { data, error } = await sb.from('schedules').select('*').eq('course_id', c.id).order('day_of_week').order('start_time');
    if (error) { m.body.innerHTML = errorHTML(error); return; }
    m.body.innerHTML = `<form id="sf" class="form-grid mb">
        <div class="form-group"><label>Hari</label><select class="select" id="sd">${DAYS.slice(1).map((d, i) => `<option value="${i + 1}">${d}</option>`).join('')}</select></div>
        <div class="form-group"><label>Ruangan</label><input class="input" id="sr" maxlength="60" value="${esc(c.room || '')}"></div>
        <div class="form-group"><label>Mulai</label><input class="input" type="time" id="ss" required></div>
        <div class="form-group"><label>Selesai</label><input class="input" type="time" id="se" required></div>
        <div class="form-group full"><button class="btn btn-primary">Tambah Jadwal</button></div></form>
      ${data.length ? `<div class="table-wrap"><table class="table"><tbody>${data.map((s) => `<tr><td>${DAYS[s.day_of_week]}</td><td>${hhmm(s.start_time)}–${hhmm(s.end_time)}</td><td>${esc(s.room || '-')}</td><td class="right"><button class="btn btn-danger btn-icon" data-ds="${s.id}"><i class="bi bi-trash"></i></button></td></tr>`).join('')}</tbody></table></div>` : emptyHTML('Belum ada jadwal.', 'bi-calendar-x')}`;
    $('#sf', m.root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const s = $('#ss', m.root).value, en = $('#se', m.root).value;
      if (!s || !en) return toast('Jam mulai dan selesai wajib diisi.', 'warn');
      if (en <= s) return toast('Jam selesai harus setelah jam mulai.', 'warn');
      const { error: e2 } = await sb.from('schedules').insert({ course_id: c.id, day_of_week: Number($('#sd', m.root).value), start_time: s, end_time: en, room: $('#sr', m.root).value.trim() || null });
      if (e2) return fail(e2);
      ok('Jadwal ditambahkan.'); draw2();
    });
    $$('[data-ds]', m.root).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Hapus jadwal ini?'))) return;
      const { error: e3 } = await sb.from('schedules').delete().eq('id', b.dataset.ds);
      if (e3) fail(e3); else { ok('Jadwal dihapus.'); draw2(); }
    }));
  };
  draw2();
}

/* ===================== KONTAK DOSEN ===================== */
async function loadLecturers() {
  const box = $('#tab-body');
  const [{ data, error }, cs] = await Promise.all([sb.from('lecturers').select('*').order('full_name'), sb.from('courses').select('name,lecturer_id')]);
  if (error) { box.innerHTML = errorHTML(error); return; }
  lecturers = data;
  if (!data.length) { box.innerHTML = emptyHTML('Belum ada data dosen.', 'bi-person-x'); return; }
  box.innerHTML = `<div class="grid grid-3">${data.map((l) => `<div class="card"><div class="flex">${avatarHTML(l.full_name, l.photo_url, 'lg')}<div style="min-width:0"><h3>${esc(l.full_name)}</h3>${l.nidn ? `<small class="muted">NIDN ${esc(l.nidn)}</small>` : ''}</div></div>
    <dl class="kv mt"><dt>Mata kuliah</dt><dd>${esc((cs.data || []).filter((c) => c.lecturer_id === l.id).map((c) => c.name).join(', ') || '-')}</dd>
    <dt>Email</dt><dd>${l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : '-'}</dd><dt>Kontak</dt><dd>${esc(l.phone || '-')}</dd><dt>Info tambahan</dt><dd>${esc(l.notes || '-')}</dd></dl>
    ${(canU || canD) ? `<div class="flex mt">${canU ? `<button class="btn btn-secondary btn-sm" data-edit="${l.id}"><i class="bi bi-pencil"></i> Ubah</button>` : ''}${canD ? `<button class="btn btn-danger btn-sm" data-del="${l.id}"><i class="bi bi-trash"></i> Hapus</button>` : ''}</div>` : ''}</div>`).join('')}</div>`;
  const byId = Object.fromEntries(data.map((l) => [l.id, l]));
  $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => lecturerForm(byId[b.dataset.edit])));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
    const l = byId[b.dataset.del];
    if (!(await confirmDialog(`Hapus dosen "${l.full_name}"? Mata kuliah yang diampu menjadi tanpa dosen.`))) return;
    const { error: e } = await sb.from('lecturers').delete().eq('id', l.id);
    if (e) return fail(e);
    if (l.photo_path) await removeFiles('avatars', l.photo_path);
    ok('Dosen dihapus.'); draw();
  }));
}

function lecturerForm(existing = null) {
  formModal({
    title: existing ? 'Ubah Data Dosen' : 'Tambah Dosen', size: 'lg', values: existing || {},
    fields: [
      { name: 'full_name', label: 'Nama lengkap & gelar', required: true, maxlength: 120, full: true },
      { name: 'nidn', label: 'NIDN', maxlength: 30 },
      { name: 'email', label: 'Email', type: 'email', maxlength: 120 },
      { name: 'phone', label: 'Nomor kontak', maxlength: 30 },
      { name: 'photo', label: 'Foto profil', type: 'file', accept: '.png,.jpg,.jpeg,.webp', help: BUCKETS.avatars.label },
      { name: 'notes', label: 'Informasi tambahan', type: 'textarea', full: true },
    ],
    onSubmit: async (v) => {
      const payload = { full_name: v.full_name, nidn: v.nidn, email: v.email, phone: v.phone, notes: v.notes, photo_url: existing?.photo_url || null, photo_path: existing?.photo_path || null };
      let up = null;
      if (v.photo) { up = await uploadFile('avatars', v.photo, 'lecturers'); payload.photo_url = up.url; payload.photo_path = up.path; }
      const { error } = existing ? await sb.from('lecturers').update(payload).eq('id', existing.id) : await sb.from('lecturers').insert(payload);
      if (error) { if (up) await removeFiles('avatars', up.path); throw error; }
      if (up && existing?.photo_path) await removeFiles('avatars', existing.photo_path);
      ok(existing ? 'Data dosen diperbarui.' : 'Dosen ditambahkan.'); draw();
    },
  });
}

draw();
