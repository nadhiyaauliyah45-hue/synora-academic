// academic.js — Persetujuan KRS, input nilai, dan KHS. Hak akses sebenarnya: RLS + fungsi database (krs_decide, set_final_grade).
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { can, isAcademicStaff } from './permissions.js';
import { rpc, q, badge, table, opts, num, label, activeSemester } from './crud.js';
import { $, $$, esc, ok, fail, openModal, formModal, loadingHTML, errorHTML, emptyHTML, tabsHTML, fmtDate } from './utils.js';

const { ctx, content } = await initPage('academic');
const isStaff = isAcademicStaff(ctx.role);
let tab = 'krs';

const TABS = [
  { id: 'krs', label: 'Persetujuan KRS', icon: 'bi-check2-square' },
  { id: 'grade', label: 'Input Nilai', icon: 'bi-pencil-square' },
  ...(isStaff ? [{ id: 'khs', label: 'KHS Mahasiswa', icon: 'bi-file-earmark-text' }] : []),
];
const LOADERS = { krs: loadKrs, grade: loadGrades, khs: loadKhs };

function draw() {
  content.innerHTML = `<div class="page-header"><div><h1>KRS &amp; Nilai</h1><p>Setujui KRS, input nilai per mata kuliah, dan lihat KHS.</p></div></div>
    ${tabsHTML(TABS, tab)}<div id="tab-body">${loadingHTML()}</div>`;
  $$('[data-tab]', content).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  LOADERS[tab]().catch((e) => { $('#tab-body').innerHTML = errorHTML(e); });
}
const body = () => $('#tab-body');
const semLabel = (s) => `${s.academic_years?.name || ''} ${label(s.term)}${s.is_active ? ' (aktif)' : ''}`;
async function semesters() {
  return q(sb.from('semesters').select('id,term,is_active,academic_years(name)').order('start_date', { ascending: false, nullsFirst: false }));
}

/* ===================== PERSETUJUAN KRS ===================== */
async function loadKrs() {
  const sems = await semesters();
  const semId = window.__acSem && sems.find((s) => s.id === window.__acSem) ? window.__acSem : (sems.find((s) => s.is_active) || sems[0])?.id;
  const statusFilter = window.__acKrsStatus || 'diajukan';
  if (!semId) { body().innerHTML = emptyHTML('Belum ada semester. Buat di menu Prodi & Kelas.', 'bi-calendar-x'); return; }
  const rows = await q(sb.from('krs').select('*,students(nim,full_name),krs_items(id,courses(code,name,sks))').eq('semester_id', semId).eq('status', statusFilter).order('submitted_at'));
  body().innerHTML = `<div class="toolbar wrap"><select class="select" id="sem">${sems.map((s) => `<option value="${s.id}" ${s.id === semId ? 'selected' : ''}>${esc(semLabel(s))}</option>`).join('')}</select>
    <select class="select" id="st">${['diajukan', 'disetujui', 'ditolak', 'draft'].map((s) => `<option value="${s}" ${s === statusFilter ? 'selected' : ''}>${label(s)}</option>`).join('')}</select></div>
    <div class="mt">${table([
      { label: 'NIM', render: (k) => esc(k.students?.nim || '-') }, { label: 'Nama', render: (k) => `<b>${esc(k.students?.full_name || 'Mahasiswa')}</b>` },
      { label: 'Mata kuliah', render: (k) => (k.krs_items || []).map((i) => esc(i.courses?.code)).join(', ') || '-' },
      { label: 'SKS', cls: 'num', render: (k) => (k.krs_items || []).reduce((a, i) => a + (i.courses?.sks || 0), 0) },
      { label: 'Diajukan', render: (k) => (k.submitted_at ? fmtDate(k.submitted_at) : '-') },
      { label: 'Status', render: (k) => badge(k.status) },
      { label: '', render: (k) => `<div class="actions"><button class="btn btn-secondary btn-sm" data-view="${k.id}">Detail</button>${k.status === 'diajukan' ? `<button class="btn btn-primary btn-sm" data-ok="${k.id}">Setujui</button><button class="btn btn-danger btn-sm" data-no="${k.id}">Tolak</button>` : ''}</div>` },
    ], rows, 'Tidak ada KRS pada filter ini.')}</div>`;
  $('#sem').addEventListener('change', (e) => { window.__acSem = e.target.value; draw(); });
  $('#st').addEventListener('change', (e) => { window.__acKrsStatus = e.target.value; draw(); });
  const byId = Object.fromEntries(rows.map((k) => [k.id, k]));
  $$('[data-view]', content).forEach((b) => b.addEventListener('click', () => {
    const k = byId[b.dataset.view];
    openModal({ title: `KRS ${k.students?.full_name || ''}`, footer: '<button class="btn btn-secondary" data-close>Tutup</button>', content: `${table([
      { label: 'Kode', render: (i) => esc(i.courses?.code) }, { label: 'Mata kuliah', render: (i) => esc(i.courses?.name) }, { label: 'SKS', cls: 'num', render: (i) => i.courses?.sks },
    ], k.krs_items || [], 'KRS kosong.')}${k.note ? `<p class="mt"><b>Catatan:</b> ${esc(k.note)}</p>` : ''}` });
  }));
  $$('[data-ok]', content).forEach((b) => b.addEventListener('click', async () => {
    try { await rpc('krs_decide', { p_krs: b.dataset.ok, p_ok: true, p_note: null }); ok('KRS disetujui.'); draw(); } catch (e) { fail(e); }
  }));
  $$('[data-no]', content).forEach((b) => b.addEventListener('click', () => formModal({
    title: 'Tolak KRS', submitLabel: 'Tolak KRS', fields: [{ name: 'note', label: 'Alasan penolakan', type: 'textarea', required: true, full: true }],
    onSubmit: async (d) => { await rpc('krs_decide', { p_krs: b.dataset.no, p_ok: false, p_note: d.note }); ok('KRS ditolak.'); draw(); },
  })));
}

/* ===================== INPUT NILAI ===================== */
async function loadGrades() {
  const [sems, courses] = await Promise.all([semesters(), q(sb.from('courses').select('id,code,name,sks').order('name'))]);
  const semId = window.__acSem && sems.find((s) => s.id === window.__acSem) ? window.__acSem : (sems.find((s) => s.is_active) || sems[0])?.id;
  const courseId = window.__acCourse || '';
  if (!semId) { body().innerHTML = emptyHTML('Belum ada semester.', 'bi-calendar-x'); return; }
  body().innerHTML = `<div class="toolbar wrap"><select class="select" id="sem">${sems.map((s) => `<option value="${s.id}" ${s.id === semId ? 'selected' : ''}>${esc(semLabel(s))}</option>`).join('')}</select>
    <select class="select grow" id="crs"><option value="">— Pilih mata kuliah —</option>${courses.map((c) => `<option value="${c.id}" ${c.id === courseId ? 'selected' : ''}>${esc(c.code)} — ${esc(c.name)}</option>`).join('')}</select></div>
    <p class="muted mt">Bobot nilai akhir: kehadiran 10%, tugas 20%, UTS 30%, UAS 40%. Skala: A ≥ 85 (4,0), AB ≥ 80 (3,5), B ≥ 70 (3,0), BC ≥ 65 (2,5), C ≥ 55 (2,0), D ≥ 40 (1,0), E &lt; 40. Hanya nilai yang <b>difinalisasi</b> terlihat oleh mahasiswa dan dihitung ke IPS/IPK.</p>
    <div id="gbody" class="mt"></div>`;
  $('#sem').addEventListener('change', (e) => { window.__acSem = e.target.value; draw(); });
  $('#crs').addEventListener('change', (e) => { window.__acCourse = e.target.value; draw(); });
  if (!courseId) { $('#gbody').innerHTML = emptyHTML('Pilih mata kuliah untuk menampilkan daftar mahasiswa.', 'bi-journal'); return; }
  const rows = await q(sb.from('v_grades').select('*').eq('semester_id', semId).eq('course_id', courseId));
  if (!rows.length) { $('#gbody').innerHTML = emptyHTML('Belum ada mahasiswa dengan KRS disetujui (atau Anda bukan pengampu) untuk mata kuliah ini.', 'bi-people'); return; }
  let names = {};
  try {
    const st = await q(sb.from('students').select('id,nim,full_name').in('id', rows.map((r) => r.student_id)));
    names = Object.fromEntries(st.map((s) => [s.id, s]));
  } catch { /* nama bisa tidak terlihat oleh dosen non-wali */ }
  rows.sort((a, b) => (names[a.student_id]?.nim || '').localeCompare(names[b.student_id]?.nim || ''));
  $('#gbody').innerHTML = table([
    { label: 'NIM', render: (r) => esc(names[r.student_id]?.nim || '-') },
    { label: 'Nama', render: (r) => esc(names[r.student_id]?.full_name || 'Mahasiswa') },
    { label: 'Hadir', cls: 'num', render: (r) => num(r.attendance_score, 0) }, { label: 'Tugas', cls: 'num', render: (r) => num(r.assignment_score, 0) },
    { label: 'UTS', cls: 'num', render: (r) => num(r.mid_score, 0) }, { label: 'UAS', cls: 'num', render: (r) => num(r.final_score, 0) },
    { label: 'Total', cls: 'num', render: (r) => num(r.total) }, { label: 'Huruf', render: (r) => esc(r.letter || '-') },
    { label: 'Status', render: (r) => (r.is_final ? '<span class="badge ok">Final</span>' : '<span class="badge">Draf</span>') },
    { label: '', render: (r) => `<button class="btn btn-secondary btn-sm" data-edit="${r.krs_item_id}">${r.is_final && !isStaff ? 'Lihat' : 'Input'}</button>` },
  ], rows);
  const byItem = Object.fromEntries(rows.map((r) => [r.krs_item_id, r]));
  $$('[data-edit]', content).forEach((b) => b.addEventListener('click', () => gradeForm(byItem[b.dataset.edit], names[byItem[b.dataset.edit].student_id])));
}
function gradeForm(r, st) {
  const locked = r.is_final && !isStaff;
  const f = (name, lab) => ({ name, label: lab, type: 'number', min: 0, max: 100, step: '0.01', help: locked ? 'Nilai sudah final.' : '' });
  let mode = 'draft';
  const m = formModal({
    title: `Nilai — ${st?.full_name || 'Mahasiswa'} · ${r.code}`, size: 'sm',
    values: { att: r.attendance_score, asg: r.assignment_score, mid: r.mid_score, fin: r.final_score },
    fields: [f('att', 'Kehadiran (0–100)'), f('asg', 'Tugas (0–100)'), f('mid', 'UTS (0–100)'), f('fin', 'UAS (0–100)')],
    submitLabel: 'Simpan draf',
    extraHTML: locked ? '' : '<div class="mt"><button type="button" class="btn btn-primary" id="fin">Simpan &amp; finalisasi</button><p class="muted">Finalisasi mengunci nilai untuk dosen; mahasiswa langsung dapat melihatnya.</p></div>',
    afterRender: (form) => {
      if (locked) { $$('input', form).forEach((i) => { i.disabled = true; }); $('[data-submit]', form.closest('.modal'))?.setAttribute('disabled', ''); }
      $('#fin', form)?.addEventListener('click', () => { mode = 'final'; form.requestSubmit(); });
    },
    onSubmit: async (d) => {
      const isFinal = mode === 'final'; mode = 'draft';
      await rpc('set_final_grade', { p_item: r.krs_item_id, p_att: d.att, p_asg: d.asg, p_mid: d.mid, p_fin: d.fin, p_final: isFinal });
      ok(isFinal ? 'Nilai difinalisasi.' : 'Draf nilai disimpan.'); draw();
    },
  });
  return m;
}

/* ===================== KHS ===================== */
async function loadKhs() {
  const sid = window.__acStu || '';
  const students = await q(sb.from('students').select('id,nim,full_name').order('nim'));
  body().innerHTML = `<div class="toolbar"><select class="select grow" id="stu"><option value="">— Pilih mahasiswa —</option>${students.map((s) => `<option value="${s.id}" ${s.id === sid ? 'selected' : ''}>${esc(s.nim)} — ${esc(s.full_name)}</option>`).join('')}</select></div><div id="kb" class="mt"></div>`;
  $('#stu').addEventListener('change', (e) => { window.__acStu = e.target.value; draw(); });
  if (!sid) { $('#kb').innerHTML = emptyHTML('Pilih mahasiswa.', 'bi-person'); return; }
  const [grades, khs, ipk, sems] = await Promise.all([
    q(sb.from('v_grades').select('*').eq('student_id', sid)), q(sb.from('v_khs').select('*').eq('student_id', sid)),
    q(sb.from('v_ipk').select('*').eq('student_id', sid)), semesters(),
  ]);
  const khsBy = Object.fromEntries(khs.map((k) => [k.semester_id, k]));
  const groups = sems.filter((s) => grades.some((g) => g.semester_id === s.id));
  $('#kb').innerHTML = `<div class="stat-row"><div class="card"><div class="val">${num(ipk[0]?.ipk)}</div><div class="lbl">IPK (nilai final)</div></div><div class="card"><div class="val">${ipk[0]?.total_sks ?? 0}</div><div class="lbl">Total SKS lulus hitung</div></div></div>
    ${groups.length ? groups.map((s) => `<div class="card mt"><div class="flex-between"><h3>${esc(semLabel(s))}</h3><span class="badge orange">IPS ${num(khsBy[s.id]?.ips)} · ${khsBy[s.id]?.sks ?? 0} SKS</span></div>
      ${table([
        { label: 'Kode', render: (g) => esc(g.code) }, { label: 'Mata kuliah', render: (g) => esc(g.course_name) }, { label: 'SKS', cls: 'num', render: (g) => g.sks },
        { label: 'Total', cls: 'num', render: (g) => num(g.total) }, { label: 'Huruf', render: (g) => esc(g.letter || '-') }, { label: 'Mutu', cls: 'num', render: (g) => num(g.points, 1) },
        { label: 'Status', render: (g) => (g.is_final ? '<span class="badge ok">Final</span>' : '<span class="badge">Belum final</span>') },
      ], grades.filter((g) => g.semester_id === s.id))}</div>`).join('') : emptyHTML('Belum ada KRS disetujui untuk mahasiswa ini.', 'bi-file-earmark-x')}`;
}

void can; void opts; void activeSemester;
draw();
