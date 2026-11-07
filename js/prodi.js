// prodi.js — Prodi: tahun ajaran & semester, kelas, penugasan dosen, mata kuliah, dosen. Penegakan hak akses: RLS (090_rls.sql).
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { can, isUniWide } from './permissions.js';
import { rpc, q, badge, table, opts, label } from './crud.js';
import { $, $$, esc, ok, fail, confirmDialog, openModal, formModal, loadingHTML, errorHTML, tabsHTML, fmtDate } from './utils.js';

const { ctx, content } = await initPage('prodi');
const canW = can(ctx.role, 'prodi', 'c');
const uniWide = isUniWide(ctx.role);   // struktur universitas (fakultas, prodi, tahun ajaran) hanya tingkat universitas
const canStruct = uniWide && canW;
// Prodi yang boleh dikelola pemanggil (Kaprodi/Admin Prodi: prodinya; Dekan: prodi di fakultasnya; Universitas: semua)
const myProgs = await q(sb.from('v_my_programs').select('*').order('faculty_name', { nullsFirst: false }).order('name'));
const myProgIds = myProgs.map((p) => p.id);
const progLabel = (p) => `${p.name} (${p.level})${p.faculty_code ? ' · ' + p.faculty_code : ''}`;
const NONE = '00000000-0000-0000-0000-000000000000';
// Batasi daftar ke prodi dalam cakupan (kecuali tingkat universitas). includeNull: baris tanpa prodi ikut tampil.
const scoped = (qry, includeNull = false) => (uniWide ? qry : includeNull
  ? qry.or(`program_id.in.(${(myProgIds.length ? myProgIds : [NONE]).join(',')}),program_id.is.null`)
  : qry.in('program_id', myProgIds.length ? myProgIds : [NONE]));
let tab = uniWide ? 'org' : 'class';

const TABS = [
  { id: 'org', label: 'Fakultas & Prodi', icon: 'bi-bank2' },
  { id: 'year', label: 'Tahun Ajaran & Semester', icon: 'bi-calendar-range' },
  { id: 'class', label: 'Kelas', icon: 'bi-people' },
  { id: 'assign', label: 'Penugasan Dosen', icon: 'bi-person-workspace' },
  { id: 'course', label: 'Mata Kuliah', icon: 'bi-journal-bookmark' },
  { id: 'lect', label: 'Dosen', icon: 'bi-person-lines-fill' },
];
const LOADERS = { org: loadOrg, year: loadYears, class: loadClasses, assign: loadAssign, course: loadCourses, lect: loadLecturers };

function draw() {
  content.innerHTML = `<div class="page-header"><div><h1>Prodi &amp; Kelas</h1><p>Struktur akademik: tahun ajaran, semester, kelas, penugasan dosen, mata kuliah.</p></div></div>
    ${tabsHTML(TABS, tab)}<div id="tab-body">${loadingHTML()}</div>`;
  $$('[data-tab]', content).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  LOADERS[tab]().catch((e) => { $('#tab-body').innerHTML = errorHTML(e); });
}
const body = () => $('#tab-body');
const act = (html) => `<div class="actions">${html}</div>`;
const btn = (attr, icon, cls = 'btn-ghost', title = '') => `<button class="btn ${cls} btn-icon" ${attr} title="${title}"><i class="bi ${icon}"></i></button>`;

/* ===================== TAHUN AJARAN & SEMESTER ===================== */
async function loadYears() {
  const canW = canStruct; // tahun ajaran & semester dikelola tingkat universitas
  const [years, sems] = await Promise.all([
    q(sb.from('academic_years').select('*').order('start_date', { ascending: false })),
    q(sb.from('semesters').select('*').order('start_date', { ascending: false, nullsFirst: false })),
  ]);
  const yById = Object.fromEntries(years.map((y) => [y.id, y]));
  body().innerHTML = `
    <div class="flex-between"><h3>Tahun Ajaran</h3>${canW ? '<button class="btn btn-primary" id="add-y"><i class="bi bi-plus-lg"></i> Tambah Tahun Ajaran</button>' : ''}</div>
    <div class="mt">${table([
      { label: 'Tahun Ajaran', render: (y) => `<b>${esc(y.name)}</b>` },
      { label: 'Mulai', render: (y) => fmtDate(y.start_date) },
      { label: 'Selesai', render: (y) => fmtDate(y.end_date) },
      { label: 'Semester', render: (y) => sems.filter((s) => s.academic_year_id === y.id).map((s) => `${label(s.term)}${s.is_active ? ' ✔' : ''}`).join(', ') || '-' },
      ...(canW ? [{ label: '', cls: 'actions-cell', render: (y) => act(`${btn(`data-addsem="${y.id}"`, 'bi-plus-circle', 'btn-secondary', 'Tambah semester')}${btn(`data-edy="${y.id}"`, 'bi-pencil', 'btn-ghost', 'Ubah')}${btn(`data-dely="${y.id}"`, 'bi-trash', 'btn-danger', 'Hapus')}`) }] : []),
    ], years, 'Belum ada tahun ajaran.')}</div>
    <h3 class="mt">Semester</h3>
    <div class="mt">${table([
      { label: 'Tahun Ajaran', render: (s) => esc(yById[s.academic_year_id]?.name || '-') },
      { label: 'Semester', render: (s) => label(s.term) },
      { label: 'Periode', render: (s) => (s.start_date ? `${fmtDate(s.start_date)} – ${fmtDate(s.end_date)}` : '-') },
      { label: 'Status', render: (s) => (s.is_active ? '<span class="badge ok">Aktif</span>' : '<span class="badge">Tidak aktif</span>') },
      ...(canW ? [{ label: '', render: (s) => act(`${s.is_active ? '' : `<button class="btn btn-secondary btn-sm" data-act="${s.id}">Jadikan aktif</button>`}${btn(`data-edsem="${s.id}"`, 'bi-pencil', 'btn-ghost', 'Ubah')}${btn(`data-delsem="${s.id}"`, 'bi-trash', 'btn-danger', 'Hapus')}`) }] : []),
    ], sems, 'Belum ada semester.')}</div>`;
  const yb = Object.fromEntries(years.map((y) => [y.id, y])), sb2 = Object.fromEntries(sems.map((s) => [s.id, s]));
  $('#add-y')?.addEventListener('click', () => yearForm());
  $$('[data-edy]', content).forEach((b) => b.addEventListener('click', () => yearForm(yb[b.dataset.edy])));
  $$('[data-dely]', content).forEach((b) => b.addEventListener('click', () => del('academic_years', yb[b.dataset.dely].id, `Hapus tahun ajaran ${yb[b.dataset.dely].name}? Semester di dalamnya ikut terhapus.`)));
  $$('[data-addsem]', content).forEach((b) => b.addEventListener('click', () => semForm(null, b.dataset.addsem)));
  $$('[data-edsem]', content).forEach((b) => b.addEventListener('click', () => semForm(sb2[b.dataset.edsem])));
  $$('[data-delsem]', content).forEach((b) => b.addEventListener('click', () => del('semesters', b.dataset.delsem, 'Hapus semester ini? KRS & penugasan pada semester ini ikut terhapus.')));
  $$('[data-act]', content).forEach((b) => b.addEventListener('click', async () => {
    try {
      // Indeks unik parsial: hanya satu semester aktif, jadi nonaktifkan semua dulu.
      let r = await sb.from('semesters').update({ is_active: false }).eq('is_active', true); if (r.error) throw r.error;
      r = await sb.from('semesters').update({ is_active: true }).eq('id', b.dataset.act); if (r.error) throw r.error;
      ok('Semester aktif diubah.'); draw();
    } catch (e) { fail(e); draw(); }
  }));
}

async function del(table_, id, msg) {
  if (!(await confirmDialog(msg))) return;
  const { error } = await sb.from(table_).delete().eq('id', id);
  if (error) fail(error); else { ok('Data dihapus.'); draw(); }
}

function yearForm(y = null) {
  formModal({
    title: y ? 'Ubah Tahun Ajaran' : 'Tambah Tahun Ajaran', values: y || {},
    fields: [
      { name: 'name', label: 'Nama (contoh 2026/2027)', required: true, pattern: '^[0-9]{4}/[0-9]{4}$', patternMsg: 'Format harus 2026/2027.', full: true },
      { name: 'start_date', label: 'Mulai', type: 'date', required: true },
      { name: 'end_date', label: 'Selesai', type: 'date', required: true, validate: (v, f) => (v && f.elements.start_date.value && v <= f.elements.start_date.value ? 'Harus setelah tanggal mulai.' : '') },
    ],
    onSubmit: async (d) => {
      const r = y ? await sb.from('academic_years').update(d).eq('id', y.id) : await sb.from('academic_years').insert(d);
      if (r.error) throw r.error; ok('Tahun ajaran disimpan.'); draw();
    },
  });
}
async function semForm(s = null, yearId = null) {
  const years = await q(sb.from('academic_years').select('id,name').order('name', { ascending: false }));
  formModal({
    title: s ? 'Ubah Semester' : 'Tambah Semester', values: s || { academic_year_id: yearId },
    fields: [
      { name: 'academic_year_id', label: 'Tahun Ajaran', type: 'select', required: true, options: opts(years, 'id', 'name') },
      { name: 'term', label: 'Semester', type: 'select', required: true, options: [{ value: 'ganjil', label: 'Ganjil' }, { value: 'genap', label: 'Genap' }] },
      { name: 'start_date', label: 'Mulai', type: 'date' }, { name: 'end_date', label: 'Selesai', type: 'date' },
    ],
    onSubmit: async (d) => {
      const r = s ? await sb.from('semesters').update(d).eq('id', s.id) : await sb.from('semesters').insert(d);
      if (r.error) throw r.error; ok('Semester disimpan.'); draw();
    },
  });
}

/* ===================== KELAS ===================== */
async function loadClasses() {
  const [classes, lects, counts] = await Promise.all([
    q(scoped(sb.from('classes').select('*').order('name'))),
    q(scoped(sb.from('lecturers').select('id,full_name').order('full_name'), true)),
    q(sb.from('class_members').select('class_id')),
  ]);
  const lById = Object.fromEntries(lects.map((l) => [l.id, l.full_name]));
  const cnt = {}; counts.forEach((m) => { cnt[m.class_id] = (cnt[m.class_id] || 0) + 1; });
  body().innerHTML = `<div class="flex-between"><h3>Kelas</h3>${canW ? '<button class="btn btn-primary" id="add-c"><i class="bi bi-plus-lg"></i> Tambah Kelas</button>' : ''}</div>
    <div class="mt">${table([
      { label: 'Kelas', render: (c) => `<b>${esc(c.name)}</b>` },
      { label: 'Angkatan', render: (c) => esc(c.angkatan ?? '-') },
      { label: 'Dosen Wali', render: (c) => esc(lById[c.advisor_id] || '-') },
      { label: 'Anggota', cls: 'num', render: (c) => cnt[c.id] || 0 },
      { label: '', render: (c) => act(`<button class="btn btn-secondary btn-sm" data-mem="${c.id}"><i class="bi bi-people"></i> Anggota</button>${canW ? btn(`data-edc="${c.id}"`, 'bi-pencil', 'btn-ghost', 'Ubah') + btn(`data-delc="${c.id}"`, 'bi-trash', 'btn-danger', 'Hapus') : ''}`) },
    ], classes, 'Belum ada kelas.')}</div>`;
  const byId = Object.fromEntries(classes.map((c) => [c.id, c]));
  $('#add-c')?.addEventListener('click', () => classForm(null, lects));
  $$('[data-edc]', content).forEach((b) => b.addEventListener('click', () => classForm(byId[b.dataset.edc], lects)));
  $$('[data-delc]', content).forEach((b) => b.addEventListener('click', () => del('classes', b.dataset.delc, `Hapus kelas ${byId[b.dataset.delc].name}?`)));
  $$('[data-mem]', content).forEach((b) => b.addEventListener('click', () => membersModal(byId[b.dataset.mem])));
}
async function classForm(c, lects) {
  const progs = myProgs;
  formModal({
    title: c ? 'Ubah Kelas' : 'Tambah Kelas', values: c || { program_id: progs[0]?.id },
    fields: [
      { name: 'name', label: 'Nama kelas (contoh TI24D)', required: true, full: true },
      { name: 'program_id', label: 'Program Studi', type: 'select', required: true, options: opts(progs, 'id', progLabel, '— Pilih —') },
      { name: 'angkatan', label: 'Angkatan', type: 'number', min: 2000, max: 2100 },
      { name: 'advisor_id', label: 'Dosen Wali', type: 'select', options: opts(lects, 'id', 'full_name', '— Belum ditentukan —'), full: true },
    ],
    onSubmit: async (d) => {
      if (!d.advisor_id) d.advisor_id = null; if (!d.program_id) d.program_id = null;
      const r = c ? await sb.from('classes').update(d).eq('id', c.id) : await sb.from('classes').insert(d);
      if (r.error) throw r.error; ok('Kelas disimpan.'); draw();
    },
  });
}
async function membersModal(c) {
  const m = openModal({ title: `Anggota Kelas ${c.name}`, size: 'lg', content: loadingHTML(), footer: '<button class="btn btn-secondary" data-close>Tutup</button>', onClose: () => draw() });
  const render = async () => {
    try {
      const [members, students] = await Promise.all([
        q(sb.from('class_members').select('student_id,students(nim,full_name,status_akademik,angkatan)').eq('class_id', c.id)),
        canW ? q(sb.from('students').select('id,nim,full_name,angkatan').eq('program_id', c.program_id).order('nim')) : Promise.resolve([]),
      ]);
      const inIds = new Set(members.map((x) => x.student_id));
      const free = students.filter((s) => !inIds.has(s.id));
      const angk = [...new Set(free.map((s) => s.angkatan).filter(Boolean))].sort();
      m.body.innerHTML = `${canW ? `<div class="toolbar wrap"><select class="select" id="m-stu" style="min-width:220px"><option value="">+ Pilih mahasiswa…</option>${free.map((s) => `<option value="${s.id}">${esc(s.nim)} — ${esc(s.full_name)}</option>`).join('')}</select>
          <button class="btn btn-primary" id="m-add">Tambah</button>
          <select class="select" id="m-ang"><option value="">Angkatan…</option>${angk.map((a) => `<option>${a}</option>`).join('')}</select>
          <button class="btn btn-secondary" id="m-bulk">Tambah semua angkatan</button></div>` : ''}
        <div class="mt">${table([
          { label: 'NIM', render: (x) => esc(x.students?.nim) }, { label: 'Nama', render: (x) => esc(x.students?.full_name) },
          { label: 'Status', render: (x) => badge(x.students?.status_akademik) },
          ...(canW ? [{ label: '', render: (x) => act(btn(`data-rm="${x.student_id}"`, 'bi-x-lg', 'btn-danger', 'Keluarkan')) }] : []),
        ], members, 'Kelas ini belum punya anggota.')}</div>`;
      $('#m-add', m.body)?.addEventListener('click', async () => {
        const id = $('#m-stu', m.body).value; if (!id) return;
        const { error } = await sb.from('class_members').insert({ class_id: c.id, student_id: id });
        if (error) fail(error); else render();
      });
      $('#m-bulk', m.body)?.addEventListener('click', async () => {
        const a = Number($('#m-ang', m.body).value); if (!a) return;
        const rows = free.filter((s) => s.angkatan === a).map((s) => ({ class_id: c.id, student_id: s.id }));
        if (!rows.length) return;
        const { error } = await sb.from('class_members').insert(rows);
        if (error) fail(error); else { ok(`${rows.length} mahasiswa ditambahkan.`); render(); }
      });
      $$('[data-rm]', m.body).forEach((b) => b.addEventListener('click', async () => {
        const { error } = await sb.from('class_members').delete().eq('class_id', c.id).eq('student_id', b.dataset.rm);
        if (error) fail(error); else render();
      }));
    } catch (e) { m.body.innerHTML = errorHTML(e); }
  };
  render();
}

/* ===================== PENUGASAN DOSEN ===================== */
async function loadAssign() {
  const sems = await q(sb.from('semesters').select('id,term,is_active,academic_years(name)').order('start_date', { ascending: false, nullsFirst: false }));
  if (!sems.length) { body().innerHTML = '<div class="empty">Buat tahun ajaran dan semester terlebih dahulu.</div>'; return; }
  const semId = window.__prodiSem && sems.find((s) => s.id === window.__prodiSem) ? window.__prodiSem : (sems.find((s) => s.is_active) || sems[0]).id;
  const [rows, courses, classes, lects] = await Promise.all([
    q(sb.from('teaching_assignments').select('*,courses(code,name,sks),classes(name),lecturers(full_name)').eq('semester_id', semId).order('created_at')),
    q(scoped(sb.from('courses').select('id,code,name').order('name'))),
    q(scoped(sb.from('classes').select('id,name').order('name'))),
    q(scoped(sb.from('lecturers').select('id,full_name').order('full_name'), true)),
  ]);
  body().innerHTML = `<div class="toolbar wrap"><select class="select" id="sem">${sems.map((s) => `<option value="${s.id}" ${s.id === semId ? 'selected' : ''}>${esc(s.academic_years?.name)} ${label(s.term)}${s.is_active ? ' (aktif)' : ''}</option>`).join('')}</select>
    <span class="grow"></span>${canW ? '<button class="btn btn-primary" id="add-a"><i class="bi bi-plus-lg"></i> Tambah Penugasan</button>' : ''}</div>
    <div class="mt">${table([
      { label: 'Mata Kuliah', render: (a) => `<b>${esc(a.courses?.name)}</b> <small>${esc(a.courses?.code)}</small>` },
      { label: 'SKS', cls: 'num', render: (a) => a.courses?.sks },
      { label: 'Kelas', render: (a) => esc(a.classes?.name || 'Semua') },
      { label: 'Dosen', render: (a) => esc(a.lecturers?.full_name) },
      ...(canW ? [{ label: '', render: (a) => act(btn(`data-dela="${a.id}"`, 'bi-trash', 'btn-danger', 'Hapus')) }] : []),
    ], rows, 'Belum ada penugasan di semester ini.')}</div>`;
  $('#sem').addEventListener('change', (e) => { window.__prodiSem = e.target.value; draw(); });
  $$('[data-dela]', content).forEach((b) => b.addEventListener('click', () => del('teaching_assignments', b.dataset.dela, 'Hapus penugasan ini?')));
  $('#add-a')?.addEventListener('click', () => formModal({
    title: 'Tambah Penugasan Dosen',
    fields: [
      { name: 'course_id', label: 'Mata Kuliah', type: 'select', required: true, options: opts(courses, 'id', (c) => `${c.code} — ${c.name}`, '— Pilih —'), full: true },
      { name: 'class_id', label: 'Kelas', type: 'select', options: opts(classes, 'id', 'name', '— Semua kelas —') },
      { name: 'lecturer_id', label: 'Dosen', type: 'select', required: true, options: opts(lects, 'id', 'full_name', '— Pilih —') },
    ],
    onSubmit: async (d) => {
      d.semester_id = semId; if (!d.class_id) d.class_id = null;
      const { error } = await sb.from('teaching_assignments').insert(d);
      if (error) throw error; ok('Penugasan disimpan.'); draw();
    },
  }));
}

/* ===================== MATA KULIAH ===================== */
async function loadCourses() {
  const [courses, progs, lects] = await Promise.all([
    q(scoped(sb.from('courses').select('*').order('semester_no', { nullsFirst: false }).order('name'))),
    q(sb.from('study_programs').select('id,name')),
    q(scoped(sb.from('lecturers').select('id,full_name'), true)),
  ]);
  const pn = Object.fromEntries(progs.map((p) => [p.id, p.name])), ln = Object.fromEntries(lects.map((l) => [l.id, l.full_name]));
  body().innerHTML = `<div class="toolbar"><input class="input grow" id="cq" placeholder="Cari kode atau nama mata kuliah...">${canW ? '<button class="btn btn-primary" id="add-co"><i class="bi bi-plus-lg"></i> Tambah Mata Kuliah</button>' : ''}</div><div id="clist" class="mt"></div>`;
  const byId = Object.fromEntries(courses.map((c) => [c.id, c]));
  const render = (term = '') => {
    const rows = courses.filter((c) => !term || `${c.code} ${c.name}`.toLowerCase().includes(term.toLowerCase()));
    $('#clist').innerHTML = table([
      { label: 'Kode', render: (c) => `<b>${esc(c.code)}</b>` }, { label: 'Mata Kuliah', render: (c) => esc(c.name) },
      { label: 'SKS', cls: 'num', render: (c) => c.sks }, { label: 'Smt', cls: 'num', render: (c) => c.semester_no ?? '-' },
      { label: 'Prodi', render: (c) => esc(pn[c.program_id] || '-') }, { label: 'Dosen utama', render: (c) => esc(ln[c.lecturer_id] || '-') },
      { label: 'Praktikum', render: (c) => (c.has_practicum ? '<span class="badge orange">Ya</span>' : '-') },
      ...(canW ? [{ label: '', render: (c) => act(btn(`data-edco="${c.id}"`, 'bi-pencil', 'btn-ghost', 'Ubah') + btn(`data-delco="${c.id}"`, 'bi-trash', 'btn-danger', 'Hapus')) }] : []),
    ], rows, 'Belum ada mata kuliah.');
    $$('[data-edco]', content).forEach((b) => b.addEventListener('click', () => courseForm(byId[b.dataset.edco], progs, lects)));
    $$('[data-delco]', content).forEach((b) => b.addEventListener('click', () => del('courses', b.dataset.delco, `Hapus mata kuliah ${byId[b.dataset.delco].name}? Jadwal & absensi terkait ikut terhapus.`)));
  };
  render();
  $('#cq').addEventListener('input', (e) => render(e.target.value.trim()));
  $('#add-co')?.addEventListener('click', () => courseForm(null, progs, lects));
}
function courseForm(c, _progs, lects) {
  const progs = myProgs;
  formModal({
    title: c ? 'Ubah Mata Kuliah' : 'Tambah Mata Kuliah', size: 'lg', values: c || { sks: 2, program_id: progs.length === 1 ? progs[0].id : '' },
    fields: [
      { name: 'code', label: 'Kode', required: true }, { name: 'name', label: 'Nama', required: true },
      { name: 'sks', label: 'SKS', type: 'number', required: true, min: 1, max: 6 },
      { name: 'semester_no', label: 'Semester ke-', type: 'number', min: 1, max: 14 },
      { name: 'program_id', label: 'Program Studi', type: 'select', required: true, options: opts(progs, 'id', progLabel, '— Pilih —') },
      { name: 'lecturer_id', label: 'Dosen utama', type: 'select', options: opts(lects, 'id', 'full_name', '—') },
      { name: 'description', label: 'Deskripsi', type: 'textarea', full: true },
      { name: 'has_practicum', label: 'Mata kuliah ini memiliki praktikum', type: 'checkbox', full: true },
    ],
    onSubmit: async (d) => {
      if (!d.lecturer_id) d.lecturer_id = null;
      const r = c ? await sb.from('courses').update(d).eq('id', c.id) : await sb.from('courses').insert(d);
      if (r.error) throw r.error; ok('Mata kuliah disimpan.'); draw();
    },
  });
}

/* ===================== DOSEN ===================== */
async function loadLecturers() {
  const [lects, roleRows] = await Promise.all([
    q(scoped(sb.from('lecturers').select('*').order('full_name'), true)),
    canW ? q(sb.from('user_roles').select('user_id,role').eq('role', 'dosen')) : Promise.resolve([]),
  ]);
  let profs = [];
  if (canW && roleRows.length) profs = await q(sb.from('profiles').select('id,nim,full_name').in('id', roleRows.map((r) => r.user_id)));
  const pById = Object.fromEntries(profs.map((p) => [p.id, p]));
  const progName = Object.fromEntries(myProgs.map((p) => [p.id, p.name]));
  body().innerHTML = `<p class="muted">Hubungkan data dosen dengan akun login (role Dosen) agar dosen dapat menilai, membimbing skripsi, dan menyetujui KRS.</p>
    <div class="mt">${table([
      { label: 'Nama', render: (l) => `<b>${esc(l.full_name)}</b>` }, { label: 'NIDN', render: (l) => esc(l.nidn || '-') },
      { label: 'Email', render: (l) => esc(l.email || '-') },
      { label: 'Prodi', render: (l) => esc(progName[l.program_id] || '— belum diatur —') },
      { label: 'Akun login', render: (l) => (l.user_id ? `<span class="badge ok">${esc(pById[l.user_id]?.nim || 'terhubung')}</span>` : '<span class="badge">Belum</span>') },
      ...(canW ? [{ label: '', render: (l) => act(`<button class="btn btn-ghost btn-sm" data-lprog="${l.id}">Atur prodi</button>` + (l.user_id ? `<button class="btn btn-secondary btn-sm" data-unlink="${l.id}">Lepas akun</button>` : `<button class="btn btn-primary btn-sm" data-link="${l.id}">Hubungkan akun</button>`)) }] : []),
    ], lects, 'Belum ada data dosen. Tambahkan lewat menu Informasi Mata Kuliah > Kontak Dosen.')}</div>`;
  $$('[data-link]', content).forEach((b) => b.addEventListener('click', () => {
    const used = new Set(lects.map((l) => l.user_id).filter(Boolean));
    const free = profs.filter((p) => !used.has(p.id));
    if (!free.length) return fail('Tidak ada akun berrole Dosen yang belum terhubung. Buat akun dulu di Pengaturan > Manajemen Pengguna.');
    formModal({
      title: 'Hubungkan Akun Dosen', fields: [{ name: 'user_id', label: 'Akun (role Dosen)', type: 'select', required: true, options: opts(free, 'id', (p) => `${p.nim} — ${p.full_name}`, '— Pilih —'), full: true }],
      onSubmit: async (d) => { const { error } = await sb.from('lecturers').update({ user_id: d.user_id }).eq('id', b.dataset.link); if (error) throw error; ok('Akun dihubungkan.'); draw(); },
    });
  }));
  $$('[data-lprog]', content).forEach((b) => b.addEventListener('click', () => formModal({
    title: 'Prodi Dosen', values: { program_id: lects.find((l) => l.id === b.dataset.lprog)?.program_id || '' },
    fields: [{ name: 'program_id', label: 'Program Studi', type: 'select', required: true, options: opts(myProgs, 'id', progLabel, '— Pilih —'), full: true,
      help: 'Menentukan agenda prodi/fakultas yang tampil di kalender dosen.' }],
    onSubmit: async (d) => { const { error } = await sb.from('lecturers').update({ program_id: d.program_id }).eq('id', b.dataset.lprog); if (error) throw error; ok('Prodi dosen disimpan.'); draw(); },
  })));
  $$('[data-unlink]', content).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Lepas akun dari dosen ini?'))) return;
    const { error } = await sb.from('lecturers').update({ user_id: null }).eq('id', b.dataset.unlink);
    if (error) fail(error); else { ok('Akun dilepas.'); draw(); }
  }));
}

/* ===================== FAKULTAS & PRODI ===================== */
async function loadOrg() {
  const [facs, progs, stu] = await Promise.all([
    q(sb.from('faculties').select('*').order('name')),
    q(sb.from('study_programs').select('*').order('name')),
    q(sb.from('v_program_summary').select('program_id,terdaftar')),
  ]);
  const cnt = Object.fromEntries(stu.map((x) => [x.program_id, x.terdaftar]));
  const fById = Object.fromEntries(facs.map((f) => [f.id, f])), pById = Object.fromEntries(progs.map((p) => [p.id, p]));
  const mine = new Set(myProgIds);
  body().innerHTML = `${uniWide ? '' : '<p class="muted">Struktur fakultas dan program studi dikelola tingkat universitas. Anda melihat seluruh struktur; prodi dalam cakupan Anda ditandai.</p>'}
    <div class="flex-between"><h3>Fakultas</h3>${canStruct ? '<button class="btn btn-primary" id="add-f"><i class="bi bi-plus-lg"></i> Tambah Fakultas</button>' : ''}</div>
    <div class="mt">${table([
      { label: 'Kode', render: (f) => `<b>${esc(f.code)}</b>` }, { label: 'Fakultas', render: (f) => esc(f.name) },
      { label: 'Dekan', render: (f) => esc(f.dean_name || '-') },
      { label: 'Prodi', cls: 'num', render: (f) => progs.filter((p) => p.faculty_id === f.id).length },
      ...(canStruct ? [{ label: '', render: (f) => act(btn(`data-edf="${f.id}"`, 'bi-pencil', 'btn-ghost', 'Ubah') + btn(`data-delf="${f.id}"`, 'bi-trash', 'btn-danger', 'Hapus')) }] : []),
    ], facs, 'Belum ada fakultas.')}</div>
    <div class="flex-between mt"><h3>Program Studi</h3>${canStruct ? '<button class="btn btn-primary" id="add-p"><i class="bi bi-plus-lg"></i> Tambah Program Studi</button>' : ''}</div>
    <div class="mt">${table([
      { label: 'Kode', render: (p) => `<b>${esc(p.code)}</b>` },
      { label: 'Program Studi', render: (p) => `${esc(p.name)} ${mine.has(p.id) && !uniWide ? '<span class="badge orange">Cakupan Anda</span>' : ''}` },
      { label: 'Jenjang', render: (p) => esc(p.level) }, { label: 'Fakultas', render: (p) => esc(fById[p.faculty_id]?.name || '— belum diatur —') },
      { label: 'Kaprodi', render: (p) => esc(p.head_name || '-') }, { label: 'Mhs terdaftar', cls: 'num', render: (p) => (mine.has(p.id) ? (cnt[p.id] ?? 0) : '–') },
      { label: 'Status', render: (p) => (p.is_active ? '<span class="badge ok">Aktif</span>' : '<span class="badge">Nonaktif</span>') },
      ...(canStruct ? [{ label: '', render: (p) => act(btn(`data-edp="${p.id}"`, 'bi-pencil', 'btn-ghost', 'Ubah') + btn(`data-delp="${p.id}"`, 'bi-trash', 'btn-danger', 'Hapus')) }] : []),
    ], progs, 'Belum ada program studi.')}</div>`;
  $('#add-f')?.addEventListener('click', () => facForm());
  $$('[data-edf]', content).forEach((b) => b.addEventListener('click', () => facForm(fById[b.dataset.edf])));
  $$('[data-delf]', content).forEach((b) => b.addEventListener('click', () => del('faculties', b.dataset.delf, `Hapus fakultas ${fById[b.dataset.delf].name}? Program studi di dalamnya menjadi tanpa fakultas.`)));
  $('#add-p')?.addEventListener('click', () => progForm(null, facs));
  $$('[data-edp]', content).forEach((b) => b.addEventListener('click', () => progForm(pById[b.dataset.edp], facs)));
  $$('[data-delp]', content).forEach((b) => b.addEventListener('click', () => del('study_programs', b.dataset.delp, `Hapus program studi ${pById[b.dataset.delp].name}? Hanya bisa jika belum dipakai data lain.`)));
}
function facForm(f = null) {
  formModal({
    title: f ? 'Ubah Fakultas' : 'Tambah Fakultas', values: f || {},
    fields: [
      { name: 'code', label: 'Kode (contoh FT)', required: true, maxlength: 12 }, { name: 'name', label: 'Nama fakultas', required: true, full: true },
      { name: 'dean_name', label: 'Nama Dekan', full: true },
    ],
    onSubmit: async (d) => { d.code = d.code.toUpperCase(); const r = f ? await sb.from('faculties').update(d).eq('id', f.id) : await sb.from('faculties').insert(d); if (r.error) throw r.error; ok('Fakultas disimpan.'); draw(); },
  });
}
function progForm(p, facs) {
  formModal({
    title: p ? 'Ubah Program Studi' : 'Tambah Program Studi', size: 'lg', values: p || { level: 'S1', is_active: true },
    fields: [
      { name: 'code', label: 'Kode (contoh TI)', required: true, maxlength: 12 }, { name: 'name', label: 'Nama program studi', required: true },
      { name: 'level', label: 'Jenjang', type: 'select', required: true, options: ['D3', 'D4', 'S1', 'S2', 'S3', 'Profesi'].map((v) => ({ value: v, label: v })) },
      { name: 'faculty_id', label: 'Fakultas', type: 'select', required: true, options: opts(facs, 'id', 'name', '— Pilih —') },
      { name: 'head_name', label: 'Nama Kaprodi', full: true },
      { name: 'is_active', label: 'Program studi aktif', type: 'checkbox', full: true },
    ],
    onSubmit: async (d) => { d.code = d.code.toUpperCase(); const r = p ? await sb.from('study_programs').update(d).eq('id', p.id) : await sb.from('study_programs').insert(d); if (r.error) throw r.error; ok('Program studi disimpan.'); draw(); },
  });
}

void rpc;
draw();
