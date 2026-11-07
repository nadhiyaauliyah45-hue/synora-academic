// pmb.js — Penerimaan Mahasiswa Baru: periode, pendaftar (berkas, seleksi, registrasi ulang), ringkasan.
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { can } from './permissions.js';
import { rpc, q, badge, table, opts, label, openPrivate } from './crud.js';
import { exportXlsx } from './export.js';
import { $, $$, esc, ok, fail, toast, confirmDialog, openModal, formModal, loadingHTML, emptyHTML, errorHTML, tabsHTML, fmtDate, fmtDateTime, debounce, copyText } from './utils.js';

const { ctx, content } = await initPage('pmb');
const canC = can(ctx.role, 'pmb', 'c'), canU = can(ctx.role, 'pmb', 'u'), canD = can(ctx.role, 'pmb', 'd');
let tab = 'applicants';
let periods = [];
const filt = { period: '', status: '', text: '' };

const STATUSES = ['pendaftar', 'berkas_lengkap', 'peserta_seleksi', 'diterima', 'tidak_lolos', 'registrasi_ulang', 'mengundurkan_diri'];
const DOC_TYPES = ['ktp', 'kk', 'ijazah', 'transkrip', 'pas_foto', 'lainnya'];
// Langkah berikutnya yang diizinkan fungsi pmb_set_status
const NEXT = {
  pendaftar: [['berkas_lengkap', 'Berkas Lengkap'], ['tidak_lolos', 'Tidak Lolos', true], ['mengundurkan_diri', 'Mengundurkan Diri', true]],
  berkas_lengkap: [['peserta_seleksi', 'Jadikan Peserta Seleksi'], ['pendaftar', 'Kembalikan ke Pendaftar'], ['tidak_lolos', 'Tidak Lolos', true], ['mengundurkan_diri', 'Mengundurkan Diri', true]],
  peserta_seleksi: [['diterima', 'Terima'], ['tidak_lolos', 'Tidak Lolos', true], ['mengundurkan_diri', 'Mengundurkan Diri', true]],
  diterima: [['mengundurkan_diri', 'Mengundurkan Diri', true]],
};

const tempPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const a = new Uint32Array(12); crypto.getRandomValues(a);
  return Array.from(a, (n) => chars[n % chars.length]).join('');
};

function draw() {
  content.innerHTML = `<div class="page-header"><div><h1>Penerimaan Mahasiswa Baru (PMB)</h1><p>Periode, pendaftar, seleksi, dan registrasi ulang sampai NIM terbit.</p></div>
    <div class="flex">${canC && tab === 'periods' ? '<button class="btn btn-primary" id="add"><i class="bi bi-plus-lg"></i> Tambah Periode</button>' : ''}${canC && tab === 'applicants' ? '<button class="btn btn-primary" id="add"><i class="bi bi-plus-lg"></i> Tambah Pendaftar</button>' : ''}</div></div>
    ${tabsHTML([{ id: 'applicants', label: 'Pendaftar', icon: 'bi-people' }, { id: 'periods', label: 'Periode', icon: 'bi-calendar-range' }, { id: 'summary', label: 'Ringkasan', icon: 'bi-bar-chart' }], tab)}<div id="tab-body">${loadingHTML()}</div>`;
  $$('[data-tab]', content).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  $('#add')?.addEventListener('click', () => (tab === 'periods' ? periodForm() : applicantForm()));
  ({ applicants: loadApplicants, periods: loadPeriods, summary: loadSummary })[tab]();
}

async function fetchPeriods() { periods = await q(sb.from('pmb_periods').select('*,academic_years(name),study_programs(name,level)').order('open_date', { ascending: false })); }

/* ===================== PERIODE ===================== */
async function loadPeriods() {
  const box = $('#tab-body');
  try { await fetchPeriods(); } catch (e) { box.innerHTML = errorHTML(e); return; }
  box.innerHTML = table([
    { label: 'Nama', render: (p) => `<b>${esc(p.name)}</b>` },
    { label: 'Program Studi', render: (p) => esc(p.study_programs ? `${p.study_programs.name} (${p.study_programs.level})` : '-') },
    { label: 'Tahun Ajaran', render: (p) => esc(p.academic_years?.name || '-') },
    { label: 'Buka', render: (p) => fmtDate(p.open_date) }, { label: 'Tutup', render: (p) => fmtDate(p.close_date) },
    { label: 'Kuota', render: (p) => p.quota ?? '-' },
    { label: 'Status', render: (p) => (p.is_open ? '<span class="badge ok">Dibuka</span>' : '<span class="badge">Ditutup</span>') },
    { label: '', cls: 'actions', render: (p) => `${canU ? `<button class="btn btn-ghost btn-icon" data-edit="${p.id}" title="Ubah"><i class="bi bi-pencil"></i></button>` : ''}${canD ? `<button class="btn btn-danger btn-icon" data-del="${p.id}" title="Hapus"><i class="bi bi-trash"></i></button>` : ''}` },
  ], periods, 'Belum ada periode PMB.');
  const by = Object.fromEntries(periods.map((p) => [p.id, p]));
  $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => periodForm(by[b.dataset.edit])));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog(`Hapus periode "${by[b.dataset.del].name}"? Hanya bisa jika belum ada pendaftar.`))) return;
    const { error } = await sb.from('pmb_periods').delete().eq('id', b.dataset.del);
    if (error) fail(/foreign key|violates/i.test(error.message) ? 'Periode sudah memiliki pendaftar dan tidak dapat dihapus. Tutup saja periodenya.' : error); else { ok('Periode dihapus.'); draw(); }
  }));
}

async function periodForm(p = null) {
  let years = [], progs = [];
  try { [years, progs] = await Promise.all([q(sb.from('academic_years').select('id,name').order('name', { ascending: false })), q(sb.from('v_my_programs').select('id,name,level,faculty_code').order('name'))]); } catch (e) { fail(e); return; }
  formModal({
    title: p ? 'Ubah Periode PMB' : 'Tambah Periode PMB', values: p || { is_open: true },
    fields: [
      { name: 'name', label: 'Nama periode', required: true, full: true, placeholder: 'Gelombang 1 2026/2027' },
      { name: 'academic_year_id', label: 'Tahun ajaran', type: 'select', options: opts(years, 'id', 'name', '— pilih —') },
      { name: 'program_id', label: 'Program studi', type: 'select', required: true, options: opts(progs, 'id', (p) => `${p.name} (${p.level})${p.faculty_code ? ' · ' + p.faculty_code : ''}`, '— pilih —'), help: 'Pendaftar dan registrasi ulang mengikuti prodi periode ini.' },
      { name: 'open_date', label: 'Tanggal buka', type: 'date', required: true },
      { name: 'close_date', label: 'Tanggal tutup', type: 'date', required: true, validate: (v, f) => (v && f.elements.open_date.value && v < f.elements.open_date.value ? 'Tanggal tutup tidak boleh sebelum tanggal buka.' : '') },
      { name: 'quota', label: 'Kuota (kosongkan jika tanpa batas)', type: 'number', min: 1 },
      { name: 'is_open', label: 'Periode dibuka', type: 'checkbox' },
    ],
    onSubmit: async (d) => {
      const row = { ...d, academic_year_id: d.academic_year_id || null, program_id: d.program_id || null };
      const { error } = p ? await sb.from('pmb_periods').update(row).eq('id', p.id) : await sb.from('pmb_periods').insert(row);
      if (error) throw error; ok('Periode disimpan.'); draw();
    },
  });
}

/* ===================== PENDAFTAR ===================== */
async function loadApplicants() {
  const box = $('#tab-body');
  try { await fetchPeriods(); } catch (e) { box.innerHTML = errorHTML(e); return; }
  box.innerHTML = `<div class="toolbar wrap">
    <select class="select" id="fp"><option value="">Semua periode</option>${periods.map((p) => `<option value="${p.id}" ${filt.period === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <select class="select" id="fs"><option value="">Semua status</option>${STATUSES.map((s) => `<option value="${s}" ${filt.status === s ? 'selected' : ''}>${esc(label(s))}</option>`).join('')}</select>
    <input class="input grow" id="ft" placeholder="Cari nama atau nomor pendaftaran..." value="${esc(filt.text)}"></div><div id="alist">${loadingHTML()}</div>`;
  const run = async () => {
    let qb = sb.from('pmb_applicants').select('*,pmb_periods(name),students(nim)').order('created_at', { ascending: false }).limit(300);
    if (filt.period) qb = qb.eq('period_id', filt.period);
    if (filt.status) qb = qb.eq('status', filt.status);
    if (filt.text) qb = qb.or(`full_name.ilike.%${filt.text.replace(/[%,()]/g, '')}%,reg_number.ilike.%${filt.text.replace(/[%,()]/g, '')}%`);
    let rows; try { rows = await q(qb); } catch (e) { $('#alist').innerHTML = errorHTML(e); return; }
    $('#alist').innerHTML = table([
      { label: 'No. Pendaftaran', render: (a) => `<code>${esc(a.reg_number)}</code>` },
      { label: 'Nama', render: (a) => `<b>${esc(a.full_name)}</b><div class="small muted">${esc(a.school_origin || '')}</div>` },
      { label: 'Periode', render: (a) => esc(a.pmb_periods?.name || '-') },
      { label: 'Nilai', cls: 'num', render: (a) => a.test_score ?? '-' },
      { label: 'Status', render: (a) => badge(a.status) },
      { label: 'NIM', render: (a) => esc(a.students?.nim || '-') },
      { label: '', cls: 'actions', render: (a) => `<button class="btn btn-secondary btn-sm" data-open="${a.id}">Detail</button>` },
    ], rows, 'Belum ada pendaftar sesuai filter.');
    const by = Object.fromEntries(rows.map((a) => [a.id, a]));
    $$('[data-open]', $('#alist')).forEach((b) => b.addEventListener('click', () => applicantDetail(by[b.dataset.open])));
  };
  $('#fp').addEventListener('change', (e) => { filt.period = e.target.value; run(); });
  $('#fs').addEventListener('change', (e) => { filt.status = e.target.value; run(); });
  $('#ft').addEventListener('input', debounce((e) => { filt.text = e.target.value.trim(); run(); }, 300));
  run();
}

const applicantFields = (withPeriod) => [
  ...(withPeriod ? [{ name: 'period_id', label: 'Periode PMB', type: 'select', required: true, full: true, options: opts(periods.filter((p) => p.is_open), 'id', 'name', '— pilih periode —') }] : []),
  { name: 'full_name', label: 'Nama lengkap', required: true, full: true, maxlength: 120 },
  { name: 'gender', label: 'Jenis kelamin', type: 'select', options: [{ value: '', label: '—' }, { value: 'L', label: 'Laki-laki' }, { value: 'P', label: 'Perempuan' }] },
  { name: 'birth_place', label: 'Tempat lahir' }, { name: 'birth_date', label: 'Tanggal lahir', type: 'date' },
  { name: 'phone', label: 'No. HP' }, { name: 'email', label: 'Email', type: 'email' },
  { name: 'address', label: 'Alamat', type: 'textarea', full: true },
  { name: 'school_origin', label: 'Asal sekolah' }, { name: 'school_major', label: 'Jurusan' },
  { name: 'grad_year', label: 'Tahun lulus', type: 'number', min: 1990, max: 2100 },
  { name: 'test_score', label: 'Nilai seleksi (0–100)', type: 'number', min: 0, max: 100, step: '0.01' },
];
const clean = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === '' ? null : v]));

async function applicantForm() {
  if (!periods.length) { try { await fetchPeriods(); } catch (e) { fail(e); return; } }
  if (!periods.some((p) => p.is_open)) { toast('Belum ada periode PMB yang dibuka. Buat atau buka periode dulu.', 'warn'); return; }
  formModal({
    title: 'Tambah Pendaftar', size: 'lg', fields: applicantFields(true),
    onSubmit: async (d) => {
      const { error } = await sb.from('pmb_applicants').insert({ ...clean(d), created_by: ctx.user.id });
      if (error) throw error; ok('Pendaftar ditambahkan. Nomor pendaftaran dibuat otomatis.'); tab = 'applicants'; draw();
    },
  });
}

async function applicantDetail(a0) {
  let a = a0, sub = 'data';
  const m = openModal({ title: `${a.full_name} · ${a.reg_number}`, size: 'lg', content: '<div id="ad"></div>', footer: '<button class="btn btn-secondary" data-close>Tutup</button>' });
  $$('[data-close]', m.root).forEach((b) => b.addEventListener('click', m.close));
  const refresh = async () => {
    const { data } = await sb.from('pmb_applicants').select('*,pmb_periods(name),students(nim)').eq('id', a.id).maybeSingle();
    if (data) a = data; render();
  };
  const render = async () => {
    const box = $('#ad', m.root);
    box.innerHTML = `<div class="flex-between mb"><div>${badge(a.status)} <span class="small muted">${esc(a.pmb_periods?.name || '')}</span></div><div class="flex" id="wf" style="flex-wrap:wrap"></div></div>
      ${tabsHTML([{ id: 'data', label: 'Data', icon: 'bi-person' }, { id: 'docs', label: 'Berkas', icon: 'bi-paperclip' }, { id: 'hist', label: 'Riwayat', icon: 'bi-clock-history' }, { id: 'inv', label: 'Tagihan', icon: 'bi-receipt' }], sub)}<div id="sb">${loadingHTML()}</div>`;
    $$('[data-tab]', box).forEach((b) => b.addEventListener('click', () => { sub = b.dataset.tab; render(); }));
    // tombol alur
    const wf = $('#wf', box);
    if (canU) {
      (NEXT[a.status] || []).forEach(([to, text, needNote]) => {
        const b = document.createElement('button');
        b.className = `btn btn-sm ${needNote ? 'btn-danger' : 'btn-primary'}`; b.textContent = text;
        b.addEventListener('click', () => changeStatus(a, to, text, needNote, refresh));
        wf.appendChild(b);
      });
      if (a.status === 'diterima') {
        const b = document.createElement('button'); b.className = 'btn btn-primary btn-sm'; b.innerHTML = '<i class="bi bi-person-check"></i> Registrasi Ulang';
        b.addEventListener('click', () => reregister(a, async () => { await refresh(); loadApplicantsSoon(); })); wf.appendChild(b);
      }
    }
    const sbox = $('#sb', box);
    try {
      if (sub === 'data') subData(sbox); else if (sub === 'docs') await subDocs(sbox); else if (sub === 'hist') await subHist(sbox); else await subInv(sbox);
    } catch (e) { sbox.innerHTML = errorHTML(e); }
  };
  const subData = (sbox) => {
    sbox.innerHTML = `<dl class="kv"><dt>Nama</dt><dd>${esc(a.full_name)}</dd><dt>Jenis kelamin</dt><dd>${a.gender === 'L' ? 'Laki-laki' : a.gender === 'P' ? 'Perempuan' : '-'}</dd>
      <dt>TTL</dt><dd>${esc(a.birth_place || '-')}, ${a.birth_date ? fmtDate(a.birth_date) : '-'}</dd><dt>Kontak</dt><dd>${esc(a.phone || '-')} · ${esc(a.email || '-')}</dd>
      <dt>Alamat</dt><dd>${esc(a.address || '-')}</dd><dt>Sekolah</dt><dd>${esc(a.school_origin || '-')} ${esc(a.school_major || '')} ${a.grad_year ? '(' + a.grad_year + ')' : ''}</dd>
      <dt>Nilai seleksi</dt><dd>${a.test_score ?? '-'}</dd><dt>Catatan</dt><dd>${esc(a.selection_note || '-')}</dd><dt>NIM</dt><dd>${esc(a.students?.nim || '-')}</dd></dl>
      ${canU ? '<button class="btn btn-secondary mt" id="edit-a"><i class="bi bi-pencil"></i> Ubah Data / Nilai</button>' : ''}`;
    $('#edit-a', sbox)?.addEventListener('click', () => formModal({
      title: 'Ubah Data Pendaftar', size: 'lg', fields: applicantFields(false), values: a,
      onSubmit: async (d) => { const { error } = await sb.from('pmb_applicants').update(clean(d)).eq('id', a.id); if (error) throw error; ok('Data disimpan.'); await refresh(); loadApplicantsSoon(); },
    }));
  };
  const subDocs = async (sbox) => {
    const docs = await q(sb.from('pmb_documents').select('*').eq('applicant_id', a.id).order('created_at'));
    sbox.innerHTML = `${canU ? '<button class="btn btn-secondary mb" id="up"><i class="bi bi-upload"></i> Unggah Berkas</button>' : ''}${table([
      { label: 'Jenis', render: (d) => esc(label(d.doc_type)) },
      { label: 'Diunggah', render: (d) => fmtDateTime(d.created_at) },
      { label: 'Verifikasi', render: (d) => (canU ? `<label class="check"><input type="checkbox" data-ver="${d.id}" ${d.verified ? 'checked' : ''}> Sah</label>` : badge(d.verified ? 'terverifikasi' : 'menunggu')) },
      { label: '', cls: 'actions', render: (d) => `<button class="btn btn-ghost btn-sm" data-view="${d.id}"><i class="bi bi-eye"></i> Lihat</button>${canU ? `<button class="btn btn-danger btn-icon" data-rm="${d.id}"><i class="bi bi-trash"></i></button>` : ''}` },
    ], docs, 'Belum ada berkas. Untuk status "Berkas Lengkap" butuh KTP, ijazah, dan pas foto yang sudah diverifikasi.')}`;
    const by = Object.fromEntries(docs.map((d) => [d.id, d]));
    $$('[data-view]', sbox).forEach((b) => b.addEventListener('click', () => openPrivate(by[b.dataset.view].file_path)));
    $$('[data-ver]', sbox).forEach((c) => c.addEventListener('change', async () => {
      const { error } = await sb.from('pmb_documents').update({ verified: c.checked }).eq('id', c.dataset.ver);
      if (error) { fail(error); c.checked = !c.checked; } else ok(c.checked ? 'Berkas ditandai sah.' : 'Verifikasi dicabut.');
    }));
    $$('[data-rm]', sbox).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Hapus berkas ini?'))) return;
      const d = by[b.dataset.rm];
      await sb.storage.from('academic').remove([d.file_path]);
      const { error } = await sb.from('pmb_documents').delete().eq('id', d.id);
      if (error) fail(error); else { ok('Berkas dihapus.'); render(); }
    }));
    $('#up', sbox)?.addEventListener('click', () => formModal({
      title: 'Unggah Berkas', submitLabel: 'Unggah',
      fields: [{ name: 'doc_type', label: 'Jenis berkas', type: 'select', required: true, options: DOC_TYPES.map((t) => ({ value: t, label: label(t) })) },
        { name: 'file', label: 'File', type: 'file', required: true, accept: '.pdf,.png,.jpg,.jpeg,.webp', help: 'PDF/PNG/JPG/WEBP, maks 5 MB' }],
      onSubmit: async (d) => {
        const err = validateDoc(d.file); if (err) throw new Error(err);
        const ext = d.file.name.split('.').pop().toLowerCase();
        const path = `pmb/${a.id}/${crypto.randomUUID()}.${ext}`;
        const { error: e1 } = await sb.storage.from('academic').upload(path, d.file, { contentType: d.file.type || undefined, upsert: false });
        if (e1) throw e1;
        const { error: e2 } = await sb.from('pmb_documents').insert({ applicant_id: a.id, doc_type: d.doc_type, file_path: path, uploaded_by: ctx.user.id });
        if (e2) { await sb.storage.from('academic').remove([path]); throw e2; }
        ok('Berkas diunggah.'); render();
      },
    }));
  };
  const subHist = async (sbox) => {
    const h = await q(sb.from('pmb_status_history').select('*').eq('applicant_id', a.id).order('id'));
    sbox.innerHTML = h.length ? `<ul class="timeline">${h.map((x) => `<li>${x.from_status ? badge(x.from_status) + ' → ' : ''}${badge(x.to_status)}<small>${fmtDateTime(x.created_at)}${x.note ? ' · ' + esc(x.note) : ''}</small></li>`).join('')}</ul>` : emptyHTML('Belum ada riwayat.');
  };
  const subInv = async (sbox) => {
    const inv = await q(sb.from('v_invoices').select('*').eq('applicant_id', a.id).order('created_at'));
    sbox.innerHTML = table([
      { label: 'No.', render: (i) => `<code>${esc(i.number)}</code>` }, { label: 'Keterangan', render: (i) => esc(i.description) },
      { label: 'Jumlah', cls: 'num', render: (i) => 'Rp ' + Number(i.amount).toLocaleString('id-ID') },
      { label: 'Terbayar', cls: 'num', render: (i) => 'Rp ' + Number(i.paid).toLocaleString('id-ID') }, { label: 'Status', render: (i) => badge(i.pay_status) },
    ], inv, 'Belum ada tagihan untuk pendaftar ini (dibuat oleh Admin Keuangan).');
  };
  render();
}

function validateDoc(f) {
  if (!f) return 'Pilih file terlebih dahulu.';
  if (f.size > 5 * 1048576) return 'Ukuran file melebihi 5 MB.';
  if (!['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(f.name.split('.').pop().toLowerCase())) return 'Tipe file harus PDF/PNG/JPG/WEBP.';
  return null;
}
const loadApplicantsSoon = () => { if (tab === 'applicants') loadApplicants(); };

async function changeStatus(a, to, text, needNote, done) {
  formModal({
    title: `${text} — ${a.full_name}`, submitLabel: 'Simpan',
    fields: [{ name: 'note', label: needNote ? 'Alasan / catatan (wajib)' : 'Catatan (opsional)', type: 'textarea', full: true, required: !!needNote }],
    onSubmit: async (d) => { await rpc('pmb_set_status', { p_app: a.id, p_to: to, p_note: d.note || null }); ok('Status diperbarui.'); await done(); },
  });
}

async function reregister(a, done) {
  let classes = [];
  try { classes = await q(sb.from('classes').select('id,name').order('name')); } catch { /* kelas opsional */ }
  formModal({
    title: `Registrasi Ulang — ${a.full_name}`, submitLabel: 'Proses Registrasi',
    fields: [
      { name: 'nim', label: 'NIM baru', required: true, pattern: '^[A-Za-z0-9._-]{3,30}$', patternMsg: '3–30 karakter: huruf, angka, titik, strip, garis bawah.', help: 'Akun login: NIM@synora.local' },
      { name: 'class_id', label: 'Kelas (opsional)', type: 'select', options: opts(classes, 'id', 'name', '— tanpa kelas —') },
      { name: 'date', label: 'Tanggal registrasi / masuk', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) },
    ],
    extraHTML: '<p class="small muted mt">Semua tagihan PMB harus lunas. Sistem membuat data mahasiswa (status Mahasiswa Baru), membawa riwayat PMB, lalu membuat akun login dengan password sementara.</p>',
    onSubmit: async (d) => {
      const nim = d.nim.trim();
      await rpc('pmb_reregister', { p_app: a.id, p_nim: nim, p_class: d.class_id || null, p_date: d.date });
      const password = tempPassword();
      const { data, error } = await sb.functions.invoke('admin-users', { body: { action: 'create', nim, full_name: a.full_name, role: 'mahasiswa', password } });
      let accountErr = error ? (error.message || 'gagal') : data?.error || null;
      if (accountErr && /Failed to send|FunctionsFetchError|not found|404/i.test(accountErr)) accountErr = 'Edge Function "admin-users" belum di-deploy. Lihat README.';
      showResult(nim, a.full_name, accountErr ? null : password, accountErr);
      await done();
    },
  });
}

function showResult(nim, name, password, accountErr) {
  const m = openModal({
    title: 'Registrasi Ulang Berhasil', size: 'sm', footer: '<button class="btn btn-primary" data-close>Selesai</button>',
    content: `<p><b>${esc(name)}</b> kini terdaftar sebagai mahasiswa dengan NIM <b>${esc(nim)}</b> (status Mahasiswa Baru).</p>
      ${password ? `<div class="card" style="background:var(--soft-bg)"><div class="small muted">Login: <b>${esc(nim)}</b></div><div class="small muted">Password sementara (hanya ditampilkan sekali):</div>
        <div class="flex-between"><code style="font-size:18px" id="tp">${esc(password)}</code><button class="btn btn-secondary btn-sm" id="cp"><i class="bi bi-clipboard"></i> Salin</button></div></div>
        <p class="small mt"><i class="bi bi-exclamation-triangle"></i> Berikan ke mahasiswa dan minta segera menggantinya di Pengaturan &gt; Keamanan.</p>`
        : `<div class="login-error"><i class="bi bi-exclamation-circle-fill"></i><span>Data mahasiswa sudah dibuat, tetapi akun login belum: ${esc(accountErr || '')}. Buat akun NIM ${esc(nim)} (role Mahasiswa) lewat Pengaturan &gt; Manajemen Pengguna.</span></div>`}`,
  });
  $$('[data-close]', m.root).forEach((b) => b.addEventListener('click', m.close));
  $('#cp', m.root)?.addEventListener('click', async () => { await copyText(password); toast('Password disalin.', 'success'); });
}

/* ===================== RINGKASAN ===================== */
async function loadSummary() {
  const box = $('#tab-body');
  let rows;
  try { rows = await q(sb.from('v_pmb_summary').select('*').order('name')); } catch (e) { box.innerHTML = errorHTML(e); return; }
  const tot = rows.reduce((t, r) => { for (const k of ['pendaftar', 'ikut_seleksi', 'diterima', 'tidak_lolos', 'mengundurkan_diri', 'registrasi_ulang']) t[k] = (t[k] || 0) + r[k]; return t; }, {});
  const items = [['Pendaftar', 'pendaftar'], ['Ikut seleksi', 'ikut_seleksi'], ['Diterima', 'diterima'], ['Tidak lolos', 'tidak_lolos'], ['Mengundurkan diri', 'mengundurkan_diri'], ['Registrasi ulang', 'registrasi_ulang']];
  const max = Math.max(1, tot.pendaftar || 0);
  box.innerHTML = `<div class="stat-row">${items.map(([l, k]) => `<div class="card"><div class="val">${tot[k] || 0}</div><div class="lbl">${l}</div></div>`).join('')}</div>
    <div class="card mt"><h3 class="mb">Corong PMB (semua periode)</h3><div class="bar-list">${items.map(([l, k]) => `<div class="row"><span>${l}</span><div class="track"><div class="fill" style="width:${Math.round(((tot[k] || 0) / max) * 100)}%"></div></div><b>${tot[k] || 0}</b></div>`).join('')}</div></div>
    <div class="flex-between mt mb"><h3>Per periode</h3><button class="btn btn-secondary btn-sm" id="xl"><i class="bi bi-file-earmark-excel"></i> Ekspor Excel</button></div>
    ${table([{ label: 'Periode', render: (r) => `<b>${esc(r.name)}</b>` }, { label: 'Kuota', cls: 'num', render: (r) => r.quota ?? '-' },
      ...items.map(([l, k]) => ({ label: l, cls: 'num', render: (r) => r[k] }))], rows, 'Belum ada periode PMB.')}`;
  $('#xl')?.addEventListener('click', () => exportXlsx({ filename: 'Ringkasan_PMB', sheets: [{ name: 'PMB', columns: ['Periode', 'Kuota', ...items.map((i) => i[0])], rows: rows.map((r) => [r.name, r.quota ?? '', ...items.map(([, k]) => r[k])]) }] }));
}

draw();
