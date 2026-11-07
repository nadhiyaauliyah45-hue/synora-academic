// graduation.js — Kelulusan & Alumni: pengajuan, status mahasiswa (riwayat), lulusan, alumni.
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { can } from './permissions.js';
import { rpc, q, badge, label, table, num } from './crud.js';
import { $, $$, esc, ok, fail, openModal, formModal, loadingHTML, emptyHTML, errorHTML, tabsHTML, fmtDate, debounce } from './utils.js';

const { ctx, content } = await initPage('graduation');
const canW = can(ctx.role, 'graduation', 'c');
let tab = 'pengajuan';
const SPECIAL = ['cuti', 'nonaktif', 'mengundurkan_diri', 'do', 'belum_memenuhi_syarat'];
const TARGETS = ['aktif', 'cuti', 'nonaktif', 'mengundurkan_diri', 'do', 'proses_penyelesaian', 'belum_memenuhi_syarat'];

function draw() {
  content.innerHTML = `<div class="page-header"><div><h1>Kelulusan & Alumni</h1><p>Pengajuan kelulusan, perubahan status akademik berikut riwayatnya, lulusan, dan alumni.</p></div></div>
    ${tabsHTML([{ id: 'pengajuan', label: 'Pengajuan', icon: 'bi-hourglass-split' }, { id: 'status', label: 'Status Mahasiswa', icon: 'bi-person-gear' },
      { id: 'lulusan', label: 'Lulusan', icon: 'bi-award' }, { id: 'alumni', label: 'Alumni', icon: 'bi-people' }], tab)}<div id="tb">${loadingHTML()}</div>`;
  $$('[data-tab]', content).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  ({ pengajuan, status: statusTab, lulusan, alumni }[tab])().catch((e) => { $('#tb').innerHTML = errorHTML(e); });
}

const checklist = (c) => {
  const row = (okk, text) => `<li><i class="bi ${okk ? 'bi-check-circle-fill' : 'bi-x-circle-fill'}" style="color:${okk ? '#2D7547' : '#A52E22'}"></i> ${esc(text)}</li>`;
  return `<ul style="list-style:none;padding:0;display:grid;gap:6px">
    ${row(c.sks_ok, `SKS lulus ${c.total_sks} dari minimal ${c.min_sks}`)}${row(c.ipk_ok, `IPK ${num(c.ipk)} (minimal ${num(c.min_ipk)})`)}
    ${row(c.thesis_ok, `Skripsi: ${label(c.thesis_status || 'belum ada')}`)}${row(c.finance_ok, `Tagihan belum lunas: ${c.unpaid_invoices}`)}</ul>`;
};

async function pengajuan() {
  const rows = await q(sb.from('students').select('id,nim,full_name,angkatan').eq('status_akademik', 'mengajukan_kelulusan').order('nim'));
  const box = $('#tb');
  box.innerHTML = table([
    { label: 'NIM', render: (r) => esc(r.nim) }, { label: 'Nama', render: (r) => `<b>${esc(r.full_name)}</b>` }, { label: 'Angkatan', render: (r) => esc(r.angkatan ?? '-') },
    { label: '', cls: 'actions', render: (r) => `<button class="btn btn-secondary btn-sm" data-chk="${r.id}">Periksa & Proses</button>` },
  ], rows, 'Tidak ada mahasiswa yang sedang mengajukan kelulusan.');
  $$('[data-chk]', box).forEach((b) => b.addEventListener('click', async () => {
    const s = rows.find((r) => r.id === b.dataset.chk);
    let c; try { c = await rpc('graduation_check', { p_student: s.id }); } catch (e) { return fail(e); }
    const m = openModal({ title: `Syarat kelulusan — ${s.full_name}`, content: checklist(c) + (c.ok ? '<p class="badge ok">Semua syarat terpenuhi</p>' : '<p class="badge danger">Belum memenuhi semua syarat</p>'),
      footer: canW ? `<button class="btn btn-danger" id="rj">Tolak (belum memenuhi)</button><button class="btn btn-primary" id="fin" ${c.ok ? '' : 'disabled'}>Tetapkan Lulus</button>` : '' });
    $('#rj', m.root)?.addEventListener('click', () => { m.close(); formModal({ title: 'Tolak pengajuan', submitLabel: 'Tolak', fields: [{ name: 'reason', label: 'Alasan', type: 'textarea', required: true, full: true }],
      onSubmit: async (d) => { await rpc('graduation_reject', { p_student: s.id, p_reason: d.reason }); ok('Pengajuan ditolak; status: belum memenuhi syarat.'); draw(); } }); });
    $('#fin', m.root)?.addEventListener('click', () => { m.close(); formModal({ title: 'Penetapan kelulusan', submitLabel: 'Tetapkan Lulus', fields: [
      { name: 'date', label: 'Tanggal lulus', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) },
      { name: 'yud', label: 'Tanggal yudisium', type: 'date' }, { name: 'sk', label: 'Nomor SK', required: true, full: true }],
      onSubmit: async (d) => { await rpc('graduation_finalize', { p_student: s.id, p_date: d.date, p_yudisium: d.yud || null, p_sk: d.sk }); ok('Mahasiswa dinyatakan lulus.'); draw(); } }); });
  }));
}

async function statusTab() {
  const box = $('#tb');
  box.innerHTML = `<div class="toolbar"><input class="input grow" id="sq" placeholder="Cari NIM atau nama (min. 2 huruf)..."></div><div id="sl"></div>`;
  const run = async () => {
    const t = $('#sq').value.trim();
    if (t.length < 2) { $('#sl').innerHTML = emptyHTML('Ketik NIM atau nama mahasiswa.', 'bi-search'); return; }
    const rows = await q(sb.from('students').select('id,nim,full_name,angkatan,status_akademik').or(`nim.ilike.%${t}%,full_name.ilike.%${t}%`).order('nim').limit(30));
    $('#sl').innerHTML = table([
      { label: 'NIM', render: (r) => esc(r.nim) }, { label: 'Nama', render: (r) => `<b>${esc(r.full_name)}</b>` }, { label: 'Angkatan', render: (r) => esc(r.angkatan ?? '-') },
      { label: 'Status', render: (r) => badge(r.status_akademik) },
      { label: '', cls: 'actions', render: (r) => `<button class="btn btn-ghost btn-sm" data-h="${r.id}">Riwayat</button>${canW ? `<button class="btn btn-secondary btn-sm" data-s="${r.id}">Ubah Status</button>` : ''}` },
    ], rows, 'Tidak ditemukan.');
    $$('[data-h]', $('#sl')).forEach((b) => b.addEventListener('click', () => history(rows.find((r) => r.id === b.dataset.h))));
    $$('[data-s]', $('#sl')).forEach((b) => b.addEventListener('click', () => changeStatus(rows.find((r) => r.id === b.dataset.s), run)));
  };
  $('#sq').addEventListener('input', debounce(() => run().catch(fail), 300));
  run();
}

async function history(s) {
  const [h, p] = await Promise.all([
    q(sb.from('student_status_history').select('*').eq('student_id', s.id).order('effective_date').order('id')),
    q(sb.from('student_study_periods').select('*').eq('student_id', s.id).order('start_date')),
  ]);
  openModal({ title: `Riwayat — ${s.full_name} (${s.nim})`, size: 'lg', content: `
    <h4>Riwayat status</h4>${h.length ? `<ul class="timeline">${h.map((x) => `<li><b>${esc(label(x.from_status || 'awal'))} → ${esc(label(x.to_status))}</b><small>${fmtDate(x.effective_date)}${x.reason ? ' · ' + esc(x.reason) : ''}</small></li>`).join('')}</ul>` : emptyHTML('Belum ada riwayat.')}
    <h4 class="mt">Masa studi</h4>${table([{ label: 'Jenis', render: (r) => badge(r.period_type) }, { label: 'Mulai', render: (r) => fmtDate(r.start_date) }, { label: 'Selesai', render: (r) => (r.end_date ? fmtDate(r.end_date) : 'berjalan') }], p, 'Belum ada.')}` });
}

function changeStatus(s, done) {
  formModal({ title: `Ubah status — ${s.full_name}`, fields: [
    { name: 'to', label: 'Status baru', type: 'select', required: true, options: TARGETS.filter((t) => t !== s.status_akademik).map((t) => ({ value: t, label: label(t) })) },
    { name: 'date', label: 'Tanggal berlaku', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) },
    { name: 'reason', label: 'Alasan', type: 'textarea', full: true, help: `Wajib untuk: ${SPECIAL.map(label).join(', ')}.`,
      validate: (v, form) => (SPECIAL.includes(form.elements.to.value) && !v ? 'Alasan wajib untuk status ini.' : '') }],
    onSubmit: async (d) => { await rpc('change_student_status', { p_student: s.id, p_to: d.to, p_date: d.date, p_reason: d.reason || '' }); ok('Status diperbarui dan tercatat di riwayat.'); done(); } });
}

async function lulusan() {
  const rows = await q(sb.from('student_graduation').select('*,students(id,nim,full_name,angkatan,status_akademik)').order('graduation_date', { ascending: false }));
  const box = $('#tb');
  box.innerHTML = table([
    { label: 'NIM', render: (r) => esc(r.students?.nim) }, { label: 'Nama', render: (r) => `<b>${esc(r.students?.full_name)}</b>` },
    { label: 'Tgl lulus', render: (r) => fmtDate(r.graduation_date) }, { label: 'IPK', cls: 'num', render: (r) => num(r.ipk) }, { label: 'SKS', cls: 'num', render: (r) => r.total_sks ?? '-' },
    { label: 'No. SK', render: (r) => esc(r.sk_number || '-') }, { label: 'Status', render: (r) => badge(r.students?.status_akademik) },
    { label: '', cls: 'actions', render: (r) => (canW && r.students?.status_akademik === 'lulus' ? `<button class="btn btn-secondary btn-sm" data-al="${r.student_id}">Jadikan Alumni</button>` : '') },
  ], rows, 'Belum ada lulusan.');
  $$('[data-al]', box).forEach((b) => b.addEventListener('click', async () => { try { await rpc('make_alumni', { p_student: b.dataset.al }); ok('Menjadi alumni.'); draw(); } catch (e) { fail(e); } }));
}

async function alumni() {
  const rows = await q(sb.from('alumni').select('*,students(nim,full_name,angkatan)').order('updated_at', { ascending: false }));
  const box = $('#tb');
  box.innerHTML = table([
    { label: 'NIM', render: (r) => esc(r.students?.nim) }, { label: 'Nama', render: (r) => `<b>${esc(r.students?.full_name)}</b>` }, { label: 'Angkatan', render: (r) => esc(r.students?.angkatan ?? '-') },
    { label: 'Tempat kerja', render: (r) => esc(r.workplace || '-') }, { label: 'Jabatan', render: (r) => esc(r.job_title || '-') }, { label: 'Kontak', render: (r) => esc(r.contact || '-') },
    { label: '', cls: 'actions', render: (r) => (canW ? `<button class="btn btn-ghost btn-sm" data-ed="${r.student_id}">Ubah</button>` : '') },
  ], rows, 'Belum ada alumni.');
  $$('[data-ed]', box).forEach((b) => b.addEventListener('click', () => {
    const r = rows.find((x) => x.student_id === b.dataset.ed);
    formModal({ title: `Data alumni — ${r.students?.full_name}`, values: r, fields: [
      { name: 'workplace', label: 'Tempat kerja' }, { name: 'job_title', label: 'Jabatan' }, { name: 'contact', label: 'Kontak', full: true }, { name: 'tracer_note', label: 'Catatan tracer', type: 'textarea', full: true }],
      onSubmit: async (d) => { const { error } = await sb.from('alumni').update({ ...d, updated_at: new Date().toISOString() }).eq('student_id', r.student_id); if (error) throw error; ok('Tersimpan.'); draw(); } });
  }));
}
draw();
