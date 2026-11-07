// practicum.js — Praktikum & Laboratorium: lab, sesi, absensi & nilai, rekap.
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { can, isAcademicStaff } from './permissions.js';
import { q, badge, label, table, opts, num, activeSemester } from './crud.js';
import { $, $$, esc, ok, fail, confirmDialog, formModal, loadingHTML, emptyHTML, errorHTML, tabsHTML, fmtDate, hhmm } from './utils.js';

const { ctx, content } = await initPage('practicum');
const role = ctx.role;
const isStaff = isAcademicStaff(role);
const canManage = isStaff || role === 'dosen';
const canMark = canManage || role === 'asisten_lab';
const isStudent = role === 'mahasiswa';
let tab = isStudent ? 'sesi' : 'sesi';
const tabs = [{ id: 'sesi', label: 'Sesi Praktikum', icon: 'bi-calendar2-check' }, ...(canMark && !isStudent ? [{ id: 'nilai', label: 'Absensi & Nilai', icon: 'bi-clipboard-check' }, { id: 'rekap', label: 'Rekap', icon: 'bi-table' }] : []),
  ...(isStudent ? [{ id: 'saya', label: 'Kehadiran & Nilai Saya', icon: 'bi-person-check' }] : []), ...(canManage ? [{ id: 'lab', label: 'Laboratorium', icon: 'bi-pc-display' }] : [])];

function draw() {
  content.innerHTML = `<div class="page-header"><div><h1>Praktikum & Lab</h1><p>Laboratorium, sesi praktikum, absensi, dan nilai praktikum.</p></div></div>${tabsHTML(tabs, tab)}<div id="tb">${loadingHTML()}</div>`;
  $$('[data-tab]', content).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  ({ sesi, nilai, rekap, saya, lab }[tab])().catch((e) => { $('#tb').innerHTML = errorHTML(e); });
}

const sessionsQ = () => sb.from('practicum_sessions').select('*,courses(code,name),labs(name),classes(name),students:assistant_id(full_name,nim)').order('session_date', { ascending: false });

async function sesi() {
  const rows = await q(sessionsQ());
  const box = $('#tb');
  box.innerHTML = (canManage ? `<div class="toolbar"><button class="btn btn-primary" id="add"><i class="bi bi-plus-lg"></i> Tambah Sesi</button></div>` : '') +
    table([
      { label: 'Tanggal', render: (r) => `${fmtDate(r.session_date)}<br><small>${hhmm(r.start_time)}${r.end_time ? '–' + hhmm(r.end_time) : ''}</small>` },
      { label: 'Sesi', render: (r) => `<b>${esc(r.title)}</b><br><small>${esc(r.courses?.code || '')} ${esc(r.courses?.name || '')}</small>` },
      { label: 'Lab', render: (r) => esc(r.labs?.name || '-') }, { label: 'Kelas', render: (r) => esc(r.classes?.name || '-') },
      { label: 'Asisten', render: (r) => esc(r.students?.full_name || '-') },
      { label: '', cls: 'actions', render: (r) => (canManage ? `<button class="btn btn-ghost btn-icon" data-ed="${r.id}"><i class="bi bi-pencil"></i></button><button class="btn btn-danger btn-icon" data-del="${r.id}"><i class="bi bi-trash"></i></button>` : '') },
    ], rows, 'Belum ada sesi praktikum.');
  $('#add')?.addEventListener('click', () => sessionForm(null));
  $$('[data-ed]', box).forEach((b) => b.addEventListener('click', () => sessionForm(rows.find((r) => r.id === b.dataset.ed))));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Hapus sesi ini beserta absensi dan nilainya?'))) return;
    const { error } = await sb.from('practicum_sessions').delete().eq('id', b.dataset.del); if (error) fail(error); else { ok('Dihapus.'); draw(); }
  }));
}

async function sessionForm(r) {
  const [courses, labs, classes, studs, sem] = await Promise.all([q(sb.from('courses').select('id,code,name,has_practicum').order('name')), q(sb.from('labs').select('id,name').order('name')),
    q(sb.from('classes').select('id,name').order('name')), q(sb.from('students').select('id,nim,full_name').order('nim').limit(500)), activeSemester()]);
  const semesters = await q(sb.from('semesters').select('id,term,academic_years(name)'));
  formModal({ title: r ? 'Ubah Sesi' : 'Tambah Sesi', values: r || { semester_id: sem?.id }, fields: [
    { name: 'title', label: 'Judul sesi', required: true, full: true },
    { name: 'course_id', label: 'Mata kuliah', type: 'select', required: true, options: opts([...courses].sort((a, b) => b.has_practicum - a.has_practicum), 'id', (c) => `${c.code} — ${c.name}${c.has_practicum ? ' (praktikum)' : ''}`, 'Pilih...') },
    { name: 'semester_id', label: 'Semester', type: 'select', required: true, options: opts(semesters, 'id', (s) => `${s.academic_years?.name} ${label(s.term)}`, 'Pilih...') },
    { name: 'lab_id', label: 'Laboratorium', type: 'select', options: opts(labs, 'id', 'name', '— tidak ada —') },
    { name: 'class_id', label: 'Kelas', type: 'select', options: opts(classes, 'id', 'name', '— tidak ada —') },
    { name: 'assistant_id', label: 'Asisten (mahasiswa)', type: 'select', options: opts(studs, 'id', (s) => `${s.nim} — ${s.full_name}`, '— tidak ada —') },
    { name: 'session_date', label: 'Tanggal', type: 'date', required: true }, { name: 'start_time', label: 'Mulai', type: 'time' }, { name: 'end_time', label: 'Selesai', type: 'time' }],
    onSubmit: async (d) => {
      const row = { ...d, lab_id: d.lab_id || null, class_id: d.class_id || null, assistant_id: d.assistant_id || null, start_time: d.start_time || null, end_time: d.end_time || null };
      const { error } = r ? await sb.from('practicum_sessions').update(row).eq('id', r.id) : await sb.from('practicum_sessions').insert(row);
      if (error) throw error; ok('Tersimpan.'); draw();
    } });
}

async function nilai() {
  const sessions = await q(sessionsQ());
  const box = $('#tb');
  box.innerHTML = `<div class="toolbar"><select class="select grow" id="ss">${opts(sessions, 'id', (s) => `${fmtDate(s.session_date)} — ${s.title}`, 'Pilih sesi...').map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select></div><div id="sb">${emptyHTML('Pilih sesi untuk mengisi absensi dan nilai.', 'bi-clipboard')}</div>`;
  $('#ss').addEventListener('change', async () => {
    const id = $('#ss').value; if (!id) return;
    const s = sessions.find((x) => x.id === id);
    if (!s.class_id) { $('#sb').innerHTML = emptyHTML('Sesi ini belum memiliki kelas, sehingga daftar mahasiswa kosong. Ubah sesi dan pilih kelas.'); return; }
    const [roster, att, sc] = await Promise.all([q(sb.from('v_class_roster').select('student_id,nim,full_name').eq('class_id', s.class_id).order('nim')),
      q(sb.from('practicum_attendance').select('*').eq('session_id', id)), q(sb.from('practicum_scores').select('*').eq('session_id', id))]);
    const A = Object.fromEntries(att.map((x) => [x.student_id, x.status])), S = Object.fromEntries(sc.map((x) => [x.student_id, x.score]));
    $('#sb').innerHTML = table([{ label: 'NIM', render: (r) => esc(r.nim) }, { label: 'Nama', render: (r) => esc(r.full_name) },
      { label: 'Kehadiran', render: (r) => `<select class="select" data-a="${r.student_id}">${['', 'hadir', 'izin', 'sakit', 'alfa'].map((v) => `<option value="${v}" ${A[r.student_id] === v ? 'selected' : ''}>${v ? label(v) : '—'}</option>`).join('')}</select>` },
      { label: 'Nilai (0–100)', render: (r) => `<input class="input" type="number" min="0" max="100" step="0.01" data-n="${r.student_id}" value="${S[r.student_id] ?? ''}" style="max-width:110px">` }], roster, 'Kelas ini belum memiliki anggota.')
      + (roster.length ? '<div class="mt"><button class="btn btn-primary" id="save">Simpan</button></div>' : '');
    $('#save')?.addEventListener('click', async () => {
      const aRows = $$('[data-a]', $('#sb')).filter((e) => e.value).map((e) => ({ session_id: id, student_id: e.dataset.a, status: e.value }));
      const nRows = $$('[data-n]', $('#sb')).filter((e) => e.value !== '').map((e) => ({ session_id: id, student_id: e.dataset.n, score: Number(e.value) }));
      if (nRows.some((r) => r.score < 0 || r.score > 100)) return fail('Nilai harus 0–100.');
      try {
        if (aRows.length) { const { error } = await sb.from('practicum_attendance').upsert(aRows); if (error) throw error; }
        if (nRows.length) { const { error } = await sb.from('practicum_scores').upsert(nRows); if (error) throw error; }
        ok('Absensi dan nilai tersimpan.');
      } catch (e) { fail(e); }
    });
  });
}

async function rekap() {
  const [att, sc, studs] = await Promise.all([q(sb.from('practicum_attendance').select('student_id,status')), q(sb.from('practicum_scores').select('student_id,score')), q(sb.from('students').select('id,nim,full_name').order('nim').limit(1000))]);
  const by = {}; studs.forEach((s) => { by[s.id] = { ...s, h: 0, t: 0, n: 0, sum: 0 }; });
  att.forEach((a) => { const x = by[a.student_id]; if (x) { x.t++; if (a.status === 'hadir') x.h++; } });
  sc.forEach((a) => { const x = by[a.student_id]; if (x && a.score !== null) { x.n++; x.sum += Number(a.score); } });
  const rows = Object.values(by).filter((x) => x.t || x.n);
  $('#tb').innerHTML = table([{ label: 'NIM', render: (r) => esc(r.nim) }, { label: 'Nama', render: (r) => esc(r.full_name) },
    { label: 'Kehadiran', cls: 'num', render: (r) => (r.t ? `${r.h}/${r.t} (${Math.round((100 * r.h) / r.t)}%)` : '-') }, { label: 'Rata-rata nilai', cls: 'num', render: (r) => (r.n ? num(r.sum / r.n) : '-') }], rows, 'Belum ada data absensi/nilai praktikum.');
}

async function saya() {
  const [att, sc] = await Promise.all([q(sb.from('practicum_attendance').select('status,practicum_sessions(title,session_date,courses(name))')), q(sb.from('practicum_scores').select('score,note,practicum_sessions(title,session_date)'))]);
  $('#tb').innerHTML = `<h3>Kehadiran</h3>${table([{ label: 'Tanggal', render: (r) => fmtDate(r.practicum_sessions?.session_date) }, { label: 'Sesi', render: (r) => esc(r.practicum_sessions?.title) }, { label: 'Mata kuliah', render: (r) => esc(r.practicum_sessions?.courses?.name || '-') }, { label: 'Status', render: (r) => badge(r.status === 'hadir' ? 'disetujui' : r.status === 'alfa' ? 'ditolak' : 'diajukan').replace(/>[^<]*</, `>${esc(label(r.status))}<`) }], att, 'Belum ada data kehadiran.')}
    <h3 class="mt">Nilai</h3>${table([{ label: 'Tanggal', render: (r) => fmtDate(r.practicum_sessions?.session_date) }, { label: 'Sesi', render: (r) => esc(r.practicum_sessions?.title) }, { label: 'Nilai', cls: 'num', render: (r) => num(r.score) }, { label: 'Catatan', render: (r) => esc(r.note || '-') }], sc, 'Belum ada nilai.')}`;
}

async function lab() {
  const [labs, assist, studs] = await Promise.all([q(sb.from('labs').select('*').order('name')), q(sb.from('lab_assistants').select('lab_id,student_id,students(nim,full_name)')), isStaff ? q(sb.from('students').select('id,nim,full_name').order('nim').limit(500)) : []]);
  const box = $('#tb');
  box.innerHTML = (isStaff ? '<div class="toolbar"><button class="btn btn-primary" id="add"><i class="bi bi-plus-lg"></i> Tambah Lab</button></div>' : '') +
    table([{ label: 'Lab', render: (r) => `<b>${esc(r.name)}</b>` }, { label: 'Lokasi', render: (r) => esc(r.location || '-') }, { label: 'Kapasitas', cls: 'num', render: (r) => r.capacity ?? '-' },
      { label: 'Asisten', render: (r) => assist.filter((a) => a.lab_id === r.id).map((a) => esc(a.students?.full_name)).join(', ') || '-' },
      { label: '', cls: 'actions', render: (r) => (isStaff ? `<button class="btn btn-secondary btn-sm" data-as="${r.id}">Asisten</button><button class="btn btn-ghost btn-icon" data-ed="${r.id}"><i class="bi bi-pencil"></i></button><button class="btn btn-danger btn-icon" data-del="${r.id}"><i class="bi bi-trash"></i></button>` : '') }], labs, 'Belum ada laboratorium.');
  const form = (r) => formModal({ title: r ? 'Ubah Lab' : 'Tambah Lab', values: r || {}, fields: [{ name: 'name', label: 'Nama lab', required: true }, { name: 'location', label: 'Lokasi' }, { name: 'capacity', label: 'Kapasitas', type: 'number', min: 1 }],
    onSubmit: async (d) => { const { error } = r ? await sb.from('labs').update(d).eq('id', r.id) : await sb.from('labs').insert(d); if (error) throw error; ok('Tersimpan.'); draw(); } });
  $('#add')?.addEventListener('click', () => form(null));
  $$('[data-ed]', box).forEach((b) => b.addEventListener('click', () => form(labs.find((r) => r.id === b.dataset.ed))));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => { if (!(await confirmDialog('Hapus lab ini?'))) return; const { error } = await sb.from('labs').delete().eq('id', b.dataset.del); if (error) fail(error); else { ok('Dihapus.'); draw(); } }));
  $$('[data-as]', box).forEach((b) => b.addEventListener('click', () => formModal({ title: 'Tambah asisten lab', submitLabel: 'Tambah', fields: [{ name: 'student_id', label: 'Mahasiswa', type: 'select', required: true, options: opts(studs, 'id', (s) => `${s.nim} — ${s.full_name}`, 'Pilih...') }],
    onSubmit: async (d) => { const { error } = await sb.from('lab_assistants').upsert({ lab_id: b.dataset.as, student_id: d.student_id }); if (error) throw error; ok('Ditambahkan. Pastikan akun mahasiswa tersebut berole Asisten Laboratorium.'); draw(); } })));
}
draw();
