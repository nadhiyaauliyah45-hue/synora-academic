// thesis.js — Skripsi: mahasiswa (milik sendiri), dosen (bimbingan), staf Prodi (semua).
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { isAcademicStaff } from './permissions.js';
import { rpc, q, badge, label, table, opts, openPrivate } from './crud.js';
import { $, $$, esc, ok, fail, confirmDialog, openModal, formModal, loadingHTML, emptyHTML, errorHTML, fmtDate, hhmm } from './utils.js';

const { ctx, content } = await initPage('thesis');
const role = ctx.role;
const isStudent = role === 'mahasiswa' || role === 'asisten_lab';
const isStaff = isAcademicStaff(role);
const FLOW = ['diajukan', 'disetujui', 'bimbingan', 'layak_sidang', 'dijadwalkan', 'selesai'];
const FILE_EXTS = ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'webp'];

content.innerHTML = `<div class="page-header"><div><h1>Skripsi</h1><p>${isStudent ? 'Ajukan judul, catat bimbingan, dan pantau proses skripsi Anda.' : isStaff ? 'Penetapan judul, pembimbing, jadwal sidang, dan hasil.' : 'Skripsi mahasiswa bimbingan Anda.'}</p></div></div><div id="th-body">${loadingHTML()}</div>`;

const steps = (st) => {
  const idx = FLOW.indexOf(st === 'revisi_pasca_sidang' ? 'dijadwalkan' : st);
  return `<div class="steps">${FLOW.map((s, i) => `<span class="${i < idx || st === 'selesai' ? 'done' : i === idx ? 'now' : ''}">${esc(label(s))}</span>`).join('')}</div>${['revisi_judul', 'ditolak', 'revisi_pasca_sidang'].includes(st) ? `<div class="mt">${badge(st)}</div>` : ''}`;
};

/* ---------- unggah berkas ke bucket 'academic' ---------- */
async function uploadThesisFile(thesisId, file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!FILE_EXTS.includes(ext)) throw new Error('Tipe file tidak diizinkan. Diizinkan: PDF, DOC, DOCX, PNG, JPG, WEBP.');
  if (file.size > 20 * 1048576) throw new Error('Ukuran file melebihi 20 MB.');
  const path = `thesis/${thesisId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from('academic').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return path;
}

/* ---------- detail bersama (bimbingan, berkas, sidang) ---------- */
async function loadDetail(t) {
  const [sup, gui, files, def] = await Promise.all([
    q(sb.from('thesis_supervisors').select('role,lecturer_id,lecturers(full_name)').eq('thesis_id', t.id)),
    q(sb.from('thesis_guidance').select('*').eq('thesis_id', t.id).order('guidance_date', { ascending: false })),
    q(sb.from('thesis_files').select('*').eq('thesis_id', t.id).order('created_at', { ascending: false })),
    q(sb.from('thesis_defenses').select('*,e1:lecturers!thesis_defenses_examiner1_id_fkey(full_name),e2:lecturers!thesis_defenses_examiner2_id_fkey(full_name)').eq('thesis_id', t.id).order('defense_date', { ascending: false })),
  ]);
  return { sup, gui, files, def };
}

function detailHTML(t, d, { canReview, canGuide }) {
  const supTxt = d.sup.length ? d.sup.map((s) => `${s.role === 'pembimbing_1' ? 'Pembimbing 1' : 'Pembimbing 2'}: <b>${esc(s.lecturers?.full_name || '-')}</b>`).join(' · ') : '<span class="muted">Pembimbing belum ditetapkan</span>';
  return `<div class="card mt"><div class="flex-between"><div><h3>${esc(t.title)}</h3><div class="muted" style="font-size:13px">${supTxt}</div></div>${badge(t.status)}</div>
      ${t.abstract ? `<p class="mt" style="white-space:pre-wrap">${esc(t.abstract)}</p>` : ''}
      ${t.decision_note ? `<div class="card" style="background:var(--beige);padding:10px 14px"><b>Catatan:</b> ${esc(t.decision_note)}</div>` : ''}
      <div class="mt">${steps(t.status)}</div></div>
    <div class="grid grid-2 mt">
      <div class="card"><div class="flex-between"><h3>Bimbingan</h3>${canGuide ? '<button class="btn btn-primary btn-sm" data-act="add-guid"><i class="bi bi-plus-lg"></i> Catat</button>' : ''}</div>
        ${d.gui.length ? d.gui.map((g) => `<div class="mt" style="border-top:1px solid var(--border);padding-top:8px"><div class="flex-between"><b>${esc(g.topic)}</b>${badge(g.status)}</div>
          <small class="muted">${fmtDate(g.guidance_date)}</small>${g.notes ? `<div style="white-space:pre-wrap">${esc(g.notes)}</div>` : ''}
          ${g.file_path ? `<button class="btn btn-ghost btn-sm" data-open="${esc(g.file_path)}"><i class="bi bi-paperclip"></i> Lampiran</button>` : ''}
          ${g.lecturer_note ? `<div class="card" style="background:var(--beige);padding:8px 12px;margin-top:6px"><b>Dosen:</b> ${esc(g.lecturer_note)}</div>` : ''}
          ${canReview && g.status === 'diajukan' ? `<div class="flex mt"><button class="btn btn-secondary btn-sm" data-rev="${g.id}" data-st="disetujui">Setujui</button><button class="btn btn-ghost btn-sm" data-rev="${g.id}" data-st="revisi">Minta revisi</button></div>` : ''}
          ${isStudent && g.status === 'diajukan' ? `<button class="btn btn-danger btn-sm mt" data-delg="${g.id}"><i class="bi bi-trash"></i></button>` : ''}</div>`).join('') : emptyHTML('Belum ada catatan bimbingan.', 'bi-chat-left-text')}</div>
      <div class="card"><div class="flex-between"><h3>Berkas</h3>${isStudent || isStaff || canReview ? '<button class="btn btn-primary btn-sm" data-act="add-file"><i class="bi bi-upload"></i> Unggah</button>' : ''}</div>
        ${d.files.length ? d.files.map((f) => `<div class="flex-between mt"><div><b>${esc(f.title)}</b> <span class="badge">${esc(label(f.kind))}</span><br><small class="muted">${fmtDate(f.created_at)}</small></div>
          <div class="flex"><button class="btn btn-ghost btn-sm" data-open="${esc(f.file_path)}"><i class="bi bi-box-arrow-up-right"></i> Buka</button></div></div>`).join('') : emptyHTML('Belum ada berkas.', 'bi-file-earmark')}</div></div>
    <div class="card mt"><h3>Sidang</h3>${d.def.length ? table([
      { label: 'Tanggal', render: (x) => `${fmtDate(x.defense_date)} ${hhmm(x.start_time)}` }, { label: 'Ruang', render: (x) => esc(x.room || '-') },
      { label: 'Penguji 1', render: (x) => esc(x.e1?.full_name || '-') }, { label: 'Penguji 2', render: (x) => esc(x.e2?.full_name || '-') },
      { label: 'Hasil', render: (x) => (x.result ? badge(x.result) : '<span class="muted">Belum ada</span>') }, { label: 'Nilai', render: (x) => x.score ?? '-' },
      ...(isStaff ? [{ label: '', render: (x) => `<button class="btn btn-ghost btn-sm" data-result="${x.id}">Hasil</button>` }] : []),
    ], d.def) : emptyHTML('Belum dijadwalkan.', 'bi-calendar-event')}</div>`;
}

function bindDetail(root, t, d, refresh) {
  $$('[data-open]', root).forEach((b) => b.addEventListener('click', () => openPrivate(b.dataset.open)));
  $$('[data-rev]', root).forEach((b) => b.addEventListener('click', () => {
    const status = b.dataset.st;
    formModal({ title: status === 'disetujui' ? 'Setujui bimbingan' : 'Minta revisi', submitLabel: 'Kirim', values: {},
      fields: [{ name: 'note', label: 'Catatan dosen', type: 'textarea', full: true, required: status === 'revisi' }],
      onSubmit: async (v) => { await rpc('guidance_review', { p_id: b.dataset.rev, p_status: status, p_note: v.note }); ok('Bimbingan diperbarui.'); refresh(); } });
  }));
  $$('[data-delg]', root).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Hapus catatan bimbingan ini?'))) return;
    const { error } = await sb.from('thesis_guidance').delete().eq('id', b.dataset.delg);
    if (error) fail(error); else { ok('Dihapus.'); refresh(); }
  }));
  $('[data-act="add-guid"]', root)?.addEventListener('click', () => formModal({
    title: 'Catat bimbingan', size: 'lg',
    fields: [
      { name: 'guidance_date', label: 'Tanggal', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) },
      { name: 'topic', label: 'Topik', required: true, full: true, maxlength: 200 },
      { name: 'notes', label: 'Isi / hasil bimbingan', type: 'textarea', full: true },
      { name: 'file', label: 'Lampiran (opsional)', type: 'file', accept: '.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp', full: true },
    ],
    onSubmit: async (v) => {
      const file_path = v.file ? await uploadThesisFile(t.id, v.file) : null;
      const { error } = await sb.from('thesis_guidance').insert({ thesis_id: t.id, guidance_date: v.guidance_date, topic: v.topic, notes: v.notes, file_path, created_by: ctx.user.id });
      if (error) throw error;
      ok('Bimbingan dicatat.'); refresh();
    },
  }));
  $('[data-act="add-file"]', root)?.addEventListener('click', () => formModal({
    title: 'Unggah berkas skripsi',
    fields: [
      { name: 'kind', label: 'Jenis', type: 'select', required: true, options: ['proposal', 'bab', 'naskah_final', 'revisi', 'lainnya'].map((k) => ({ value: k, label: label(k) })) },
      { name: 'title', label: 'Judul berkas', required: true, full: true, maxlength: 160 },
      { name: 'file', label: 'Berkas', type: 'file', required: true, accept: '.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp', full: true, help: 'PDF, DOC/DOCX, gambar; maks 20 MB' },
    ],
    onSubmit: async (v) => {
      const file_path = await uploadThesisFile(t.id, v.file);
      const { error } = await sb.from('thesis_files').insert({ thesis_id: t.id, kind: v.kind, title: v.title, file_path, uploaded_by: ctx.user.id });
      if (error) throw error;
      ok('Berkas diunggah.'); refresh();
    },
  }));
  $$('[data-result]', root).forEach((b) => b.addEventListener('click', () => {
    const row = d.def.find((x) => x.id === b.dataset.result);
    formModal({ title: 'Hasil sidang', values: row,
      fields: [
        { name: 'result', label: 'Hasil', type: 'select', required: true, options: [{ value: '', label: '— pilih —' }, { value: 'lulus', label: 'Lulus' }, { value: 'lulus_revisi', label: 'Lulus dengan revisi' }, { value: 'mengulang', label: 'Mengulang' }] },
        { name: 'score', label: 'Nilai (0-100)', type: 'number', min: 0, max: 100, step: '0.01' },
        { name: 'note', label: 'Catatan', type: 'textarea', full: true },
      ],
      onSubmit: async (v) => {
        const { error } = await sb.from('thesis_defenses').update({ result: v.result, score: v.score, note: v.note }).eq('id', row.id);
        if (error) throw error;
        ok('Hasil sidang disimpan. Lanjutkan dengan mengubah status skripsi.'); refresh();
      } });
  }));
}

/* ---------- aksi status (dosen & staf) ---------- */
function setStatusModal(t, to, refresh, noteRequired = false) {
  formModal({ title: `Ubah status → ${label(to)}`, submitLabel: 'Simpan',
    fields: [{ name: 'note', label: 'Catatan', type: 'textarea', full: true, required: noteRequired }],
    onSubmit: async (v) => { await rpc('thesis_set_status', { p_thesis: t.id, p_to: to, p_note: v.note }); ok('Status diperbarui.'); refresh(); } });
}

/* =================== MAHASISWA =================== */
async function studentView() {
  const box = $('#th-body');
  const me = await q(sb.from('students').select('id,nim').eq('nim', ctx.profile.nim).limit(1));
  if (!me.length) { box.innerHTML = emptyHTML('Akun Anda belum terhubung ke data mahasiswa. Hubungi Admin Prodi.', 'bi-person-x'); return; }
  const sid = me[0].id;
  const th = await q(sb.from('thesis').select('*').eq('student_id', sid).limit(1));
  if (!th.length) {
    box.innerHTML = `<div class="card"><h3>Ajukan judul skripsi</h3><p class="muted">Judul akan ditinjau Admin Prodi sebelum pembimbing ditetapkan.</p><button class="btn btn-primary" id="new-thesis"><i class="bi bi-plus-lg"></i> Ajukan Judul</button></div>`;
    $('#new-thesis').addEventListener('click', () => formModal({
      title: 'Ajukan judul skripsi', size: 'lg',
      fields: [{ name: 'title', label: 'Judul (minimal 10 karakter)', required: true, full: true, maxlength: 300, validate: (v) => (v && v.length < 10 ? 'Judul minimal 10 karakter.' : '') },
        { name: 'abstract', label: 'Abstrak / latar belakang singkat', type: 'textarea', full: true }],
      onSubmit: async (v) => { const { error } = await sb.from('thesis').insert({ student_id: sid, title: v.title, abstract: v.abstract }); if (error) throw error; ok('Judul diajukan.'); studentView(); },
    }));
    return;
  }
  const t = th[0];
  const d = await loadDetail(t);
  const canEdit = ['diajukan', 'revisi_judul'].includes(t.status);
  box.innerHTML = `${canEdit ? `<div class="flex"><button class="btn btn-secondary" id="edit-title"><i class="bi bi-pencil"></i> Ubah judul/abstrak</button>${t.status === 'revisi_judul' ? '<button class="btn btn-primary" id="resubmit"><i class="bi bi-send"></i> Ajukan ulang</button>' : ''}</div>` : ''}
    ${detailHTML(t, d, { canReview: false, canGuide: !['diajukan', 'revisi_judul', 'ditolak'].includes(t.status) })}`;
  $('#edit-title')?.addEventListener('click', () => formModal({ title: 'Ubah judul', size: 'lg', values: t,
    fields: [{ name: 'title', label: 'Judul', required: true, full: true, maxlength: 300 }, { name: 'abstract', label: 'Abstrak', type: 'textarea', full: true }],
    onSubmit: async (v) => { const { error } = await sb.from('thesis').update({ title: v.title, abstract: v.abstract }).eq('id', t.id); if (error) throw error; ok('Tersimpan.'); studentView(); } }));
  $('#resubmit')?.addEventListener('click', async () => { try { await rpc('thesis_resubmit', { p_thesis: t.id }); ok('Judul diajukan ulang.'); studentView(); } catch (e) { fail(e); } });
  bindDetail(box, t, d, studentView);
}

/* =================== DOSEN & STAF: daftar =================== */
let filterStatus = '';
async function listView() {
  const box = $('#th-body');
  let rows;
  try { rows = await q(sb.from('thesis').select('*,students(nim,full_name,angkatan),thesis_supervisors(role,lecturers(full_name))').order('created_at', { ascending: false })); } catch (e) { box.innerHTML = errorHTML(e); return; }
  const shown = rows.filter((r) => !filterStatus || r.status === filterStatus);
  box.innerHTML = `<div class="toolbar"><select class="select" id="fst"><option value="">Semua status</option>${[...FLOW, 'revisi_judul', 'revisi_pasca_sidang', 'ditolak'].map((s) => `<option value="${s}" ${s === filterStatus ? 'selected' : ''}>${esc(label(s))}</option>`).join('')}</select><span class="badge info">${shown.length} skripsi</span></div>
    ${table([
      { label: 'Mahasiswa', render: (r) => `<b>${esc(r.students?.full_name || '-')}</b><br><small>${esc(r.students?.nim || '')}</small>` },
      { label: 'Judul', render: (r) => esc(r.title) },
      { label: 'Pembimbing', render: (r) => (r.thesis_supervisors || []).length ? r.thesis_supervisors.map((s) => esc(s.lecturers?.full_name || '-')).join('<br>') : '<span class="muted">-</span>' },
      { label: 'Status', render: (r) => badge(r.status) },
      { label: '', cls: 'actions', render: (r) => `<button class="btn btn-secondary btn-sm" data-det="${r.id}">Kelola</button>` },
    ], shown, 'Belum ada skripsi.')}`;
  $('#fst').addEventListener('change', (e) => { filterStatus = e.target.value; listView(); });
  $$('[data-det]', box).forEach((b) => b.addEventListener('click', () => openThesis(rows.find((r) => r.id === b.dataset.det))));
}

async function openThesis(t0) {
  const box = $('#th-body');
  box.innerHTML = loadingHTML();
  const { data: t } = await sb.from('thesis').select('*,students(nim,full_name)').eq('id', t0.id).single();
  const d = await loadDetail(t);
  const lecturers = isStaff ? await q(sb.from('lecturers').select('id,full_name').order('full_name')) : [];
  const supMine = !isStaff;
  const actions = [];
  if (isStaff) {
    if (t.status === 'diajukan') actions.push(['disetujui', 'Setujui judul', 'btn-primary', false], ['revisi_judul', 'Minta revisi judul', 'btn-secondary', true], ['ditolak', 'Tolak', 'btn-danger', true]);
    if (t.status === 'disetujui') actions.push(['bimbingan', 'Mulai bimbingan', 'btn-primary', false]);
  }
  if ((isStaff || supMine) && t.status === 'bimbingan') actions.push(['layak_sidang', 'Nyatakan layak sidang', 'btn-primary', false]);
  if ((isStaff || supMine) && t.status === 'revisi_pasca_sidang') actions.push(['selesai', 'Revisi disetujui → Selesai', 'btn-primary', false]);
  if (isStaff && t.status === 'dijadwalkan') actions.push(['selesai', 'Tandai selesai', 'btn-primary', false], ['revisi_pasca_sidang', 'Revisi pasca sidang', 'btn-secondary', false]);

  box.innerHTML = `<button class="btn btn-ghost" id="back"><i class="bi bi-arrow-left"></i> Kembali</button>
    <div class="card mt"><b>${esc(t.students?.full_name)}</b> · NIM ${esc(t.students?.nim)}
      <div class="flex mt" style="flex-wrap:wrap">${actions.map(([to, txt, cls, req]) => `<button class="btn ${cls}" data-to="${to}" data-req="${req ? 1 : 0}">${esc(txt)}</button>`).join('')}
      ${isStaff ? `<button class="btn btn-secondary" id="assign"><i class="bi bi-people"></i> Tetapkan pembimbing</button>` : ''}
      ${isStaff && ['layak_sidang', 'dijadwalkan'].includes(t.status) ? `<button class="btn btn-secondary" id="sched"><i class="bi bi-calendar-plus"></i> Jadwalkan sidang</button>` : ''}</div></div>
    ${detailHTML(t, d, { canReview: true, canGuide: false })}`;
  const refresh = () => openThesis(t);
  $('#back').addEventListener('click', listView);
  $$('[data-to]', box).forEach((b) => b.addEventListener('click', () => setStatusModal(t, b.dataset.to, refresh, b.dataset.req === '1')));
  $('#assign')?.addEventListener('click', () => {
    const cur = Object.fromEntries(d.sup.map((s) => [s.role, s.lecturer_id]));
    formModal({ title: 'Tetapkan pembimbing', values: { p1: cur.pembimbing_1 || '', p2: cur.pembimbing_2 || '' },
      fields: [{ name: 'p1', label: 'Pembimbing 1', type: 'select', required: true, options: opts(lecturers, 'id', 'full_name', '— pilih —') },
        { name: 'p2', label: 'Pembimbing 2 (opsional)', type: 'select', options: opts(lecturers, 'id', 'full_name', '— tidak ada —'),
          validate: (v, f) => (v && v === f.elements.p1.value ? 'Pembimbing 2 harus berbeda dari Pembimbing 1.' : '') }],
      onSubmit: async (v) => {
        const del = await sb.from('thesis_supervisors').delete().eq('thesis_id', t.id);
        if (del.error) throw del.error;
        const rowsIns = [{ thesis_id: t.id, lecturer_id: v.p1, role: 'pembimbing_1' }];
        if (v.p2) rowsIns.push({ thesis_id: t.id, lecturer_id: v.p2, role: 'pembimbing_2' });
        const { error } = await sb.from('thesis_supervisors').insert(rowsIns);
        if (error) throw error;
        ok('Pembimbing ditetapkan.'); refresh();
      } });
  });
  $('#sched')?.addEventListener('click', () => formModal({ title: 'Jadwalkan sidang', size: 'lg',
    fields: [{ name: 'defense_date', label: 'Tanggal', type: 'date', required: true }, { name: 'start_time', label: 'Jam', type: 'time' }, { name: 'room', label: 'Ruang' },
      { name: 'e1', label: 'Penguji 1', type: 'select', required: true, options: opts(lecturers, 'id', 'full_name', '— pilih —') },
      { name: 'e2', label: 'Penguji 2', type: 'select', options: opts(lecturers, 'id', 'full_name', '— tidak ada —') }],
    onSubmit: async (v) => {
      const { error } = await sb.from('thesis_defenses').insert({ thesis_id: t.id, defense_date: v.defense_date, start_time: v.start_time, room: v.room, examiner1_id: v.e1, examiner2_id: v.e2 || null });
      if (error) throw error;
      if (t.status === 'layak_sidang') await rpc('thesis_set_status', { p_thesis: t.id, p_to: 'dijadwalkan', p_note: null });
      ok('Sidang dijadwalkan.'); refresh();
    } }));
  bindDetail(box, t, d, refresh);
}

if (isStudent) await studentView(); else await listView();
