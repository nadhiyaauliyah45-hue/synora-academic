// billing.js — Tagihan & Pembayaran mahasiswa/pendaftar: jenis biaya, tagihan, verifikasi pembayaran, ringkasan.
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { can } from './permissions.js';
import { rpc, q, badge, table, opts, label, rupiah, openPrivate, activeSemester } from './crud.js';
import { exportXlsx } from './export.js';
import { $, $$, esc, ok, fail, toast, confirmDialog, formModal, loadingHTML, emptyHTML, errorHTML, tabsHTML, fmtDate, debounce } from './utils.js';

const { ctx, content } = await initPage('billing');
const canC = can(ctx.role, 'billing', 'c'), canU = can(ctx.role, 'billing', 'u'), canD = can(ctx.role, 'billing', 'd');
let tab = 'invoices';
const filt = { status: '', text: '' };
const KINDS = ['pendaftaran', 'registrasi_ulang', 'ukt', 'praktikum', 'skripsi', 'lainnya'];
const today = () => new Date().toISOString().slice(0, 10);
const clean = (s) => String(s || '').replace(/[%,()]/g, '');

function draw() {
  content.innerHTML = `<div class="page-header"><div><h1>Tagihan & Pembayaran</h1><p>Jenis biaya, tagihan mahasiswa/pendaftar, dan verifikasi bukti transfer.</p></div>
    <div class="flex">${canC && tab === 'fees' ? '<button class="btn btn-primary" id="add"><i class="bi bi-plus-lg"></i> Tambah Jenis Biaya</button>' : ''}${canC && tab === 'invoices' ? '<button class="btn btn-secondary" id="bulk"><i class="bi bi-people"></i> Buat UKT Massal</button><button class="btn btn-primary" id="add"><i class="bi bi-plus-lg"></i> Buat Tagihan</button>' : ''}</div></div>
    ${tabsHTML([{ id: 'invoices', label: 'Tagihan', icon: 'bi-receipt' }, { id: 'pay', label: 'Verifikasi Pembayaran', icon: 'bi-patch-check' }, { id: 'fees', label: 'Jenis Biaya', icon: 'bi-tags' }, { id: 'summary', label: 'Ringkasan', icon: 'bi-bar-chart' }], tab)}<div id="tab-body">${loadingHTML()}</div>`;
  $$('[data-tab]', content).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  $('#add')?.addEventListener('click', () => (tab === 'fees' ? feeForm() : invoiceForm()));
  $('#bulk')?.addEventListener('click', bulkUkt);
  ({ invoices: loadInvoices, pay: loadPayments, fees: loadFees, summary: loadSummary })[tab]();
}

/* ===================== JENIS BIAYA ===================== */
async function loadFees() {
  const box = $('#tab-body');
  let rows; try { rows = await q(sb.from('fee_types').select('*').order('name')); } catch (e) { box.innerHTML = errorHTML(e); return; }
  box.innerHTML = table([
    { label: 'Nama', render: (f) => `<b>${esc(f.name)}</b>` }, { label: 'Jenis', render: (f) => esc(label(f.kind)) },
    { label: 'Nominal', cls: 'num', render: (f) => rupiah(f.amount) }, { label: 'Status', render: (f) => (f.is_active ? '<span class="badge ok">Aktif</span>' : '<span class="badge">Nonaktif</span>') },
    { label: '', cls: 'actions', render: (f) => `${canU ? `<button class="btn btn-ghost btn-icon" data-edit="${f.id}"><i class="bi bi-pencil"></i></button>` : ''}${canD ? `<button class="btn btn-danger btn-icon" data-del="${f.id}"><i class="bi bi-trash"></i></button>` : ''}` },
  ], rows, 'Belum ada jenis biaya.');
  const by = Object.fromEntries(rows.map((f) => [f.id, f]));
  $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => feeForm(by[b.dataset.edit])));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog(`Hapus jenis biaya "${by[b.dataset.del].name}"?`))) return;
    const { error } = await sb.from('fee_types').delete().eq('id', b.dataset.del);
    if (error) fail(error); else { ok('Dihapus.'); draw(); }
  }));
}
function feeForm(f = null) {
  formModal({
    title: f ? 'Ubah Jenis Biaya' : 'Tambah Jenis Biaya', values: f || { is_active: true, kind: 'ukt' },
    fields: [
      { name: 'name', label: 'Nama biaya', required: true, full: true, placeholder: 'UKT Semester Ganjil' },
      { name: 'kind', label: 'Jenis', type: 'select', required: true, options: KINDS.map((k) => ({ value: k, label: label(k) })) },
      { name: 'amount', label: 'Nominal (Rp)', type: 'number', required: true, min: 0, step: '1' },
      { name: 'is_active', label: 'Aktif', type: 'checkbox' },
    ],
    onSubmit: async (d) => { const { error } = f ? await sb.from('fee_types').update(d).eq('id', f.id) : await sb.from('fee_types').insert(d); if (error) throw error; ok('Tersimpan.'); draw(); },
  });
}

/* ===================== TAGIHAN ===================== */
async function loadInvoices() {
  const box = $('#tab-body');
  box.innerHTML = `<div class="toolbar wrap"><select class="select" id="fs"><option value="">Semua status</option>${['belum_bayar', 'sebagian', 'lunas'].map((s) => `<option value="${s}" ${filt.status === s ? 'selected' : ''}>${label(s)}</option>`).join('')}</select>
    <input class="input grow" id="ft" placeholder="Cari no. tagihan atau keterangan..." value="${esc(filt.text)}"></div><div id="ilist">${loadingHTML()}</div>`;
  const run = async () => {
    let qb = sb.from('v_invoices').select('*,students(nim,full_name),pmb_applicants(reg_number,full_name)').order('created_at', { ascending: false }).limit(300);
    if (filt.status) qb = qb.eq('pay_status', filt.status);
    if (filt.text) qb = qb.or(`number.ilike.%${clean(filt.text)}%,description.ilike.%${clean(filt.text)}%`);
    let rows; try { rows = await q(qb); } catch (e) { $('#ilist').innerHTML = errorHTML(e); return; }
    $('#ilist').innerHTML = table([
      { label: 'No.', render: (i) => `<code>${esc(i.number)}</code>` },
      { label: 'Atas nama', render: (i) => (i.students ? `<b>${esc(i.students.full_name)}</b><div class="small muted">${esc(i.students.nim)}</div>` : i.pmb_applicants ? `<b>${esc(i.pmb_applicants.full_name)}</b><div class="small muted">${esc(i.pmb_applicants.reg_number)} (PMB)</div>` : '-') },
      { label: 'Keterangan', render: (i) => esc(i.description) },
      { label: 'Jumlah', cls: 'num', render: (i) => rupiah(i.amount) }, { label: 'Terbayar', cls: 'num', render: (i) => rupiah(i.paid) },
      { label: 'Jatuh tempo', render: (i) => (i.due_date ? fmtDate(i.due_date) : '-') },
      { label: 'Status', render: (i) => badge(i.pay_status) + (i.pending_count ? ` <span class="badge orange">${i.pending_count} menunggu</span>` : '') },
      { label: '', cls: 'actions', render: (i) => `${canC && i.remaining > 0 ? `<button class="btn btn-secondary btn-sm" data-pay="${i.id}">Catat Bayar</button>` : ''}${canD ? `<button class="btn btn-danger btn-icon" data-del="${i.id}"><i class="bi bi-trash"></i></button>` : ''}` },
    ], rows, 'Belum ada tagihan sesuai filter.');
    const by = Object.fromEntries(rows.map((i) => [i.id, i]));
    $$('[data-pay]', $('#ilist')).forEach((b) => b.addEventListener('click', () => payOnBehalf(by[b.dataset.pay])));
    $$('[data-del]', $('#ilist')).forEach((b) => b.addEventListener('click', async () => {
      const i = by[b.dataset.del];
      const { count } = await sb.from('payments').select('id', { count: 'exact', head: true }).eq('invoice_id', i.id);
      if (count) { toast('Tagihan sudah memiliki pembayaran dan tidak dapat dihapus.', 'warn'); return; }
      if (!(await confirmDialog(`Hapus tagihan ${i.number}?`))) return;
      const { error } = await sb.from('invoices').delete().eq('id', i.id);
      if (error) fail(error); else { ok('Tagihan dihapus.'); run(); }
    }));
  };
  $('#fs').addEventListener('change', (e) => { filt.status = e.target.value; run(); });
  $('#ft').addEventListener('input', debounce((e) => { filt.text = e.target.value.trim(); run(); }, 300));
  run();
}

async function invoiceForm() {
  let fees = [], sems = [];
  try { [fees, sems] = await Promise.all([q(sb.from('fee_types').select('*').eq('is_active', true).order('name')), q(sb.from('semesters').select('id,term,academic_years(name)').order('start_date', { ascending: false }))]); } catch (e) { fail(e); return; }
  if (!fees.length) { toast('Buat jenis biaya terlebih dahulu.', 'warn'); return; }
  let target = null; // {kind:'student'|'applicant', id, text}
  const m = formModal({
    title: 'Buat Tagihan', size: 'lg', submitLabel: 'Buat Tagihan',
    fields: [
      { name: 'who', label: 'Ditagihkan kepada', type: 'select', options: [{ value: 'student', label: 'Mahasiswa' }, { value: 'applicant', label: 'Pendaftar PMB' }] },
      { name: 'fee_type_id', label: 'Jenis biaya', type: 'select', required: true, options: opts(fees, 'id', 'name') },
      { name: 'description', label: 'Keterangan', required: true, full: true },
      { name: 'amount', label: 'Jumlah (Rp)', type: 'number', required: true, min: 1, step: '1' },
      { name: 'due_date', label: 'Jatuh tempo', type: 'date' },
      { name: 'semester_id', label: 'Semester (opsional)', type: 'select', options: opts(sems, 'id', (s) => `${s.academic_years?.name || ''} ${label(s.term)}`, '—') },
    ],
    extraHTML: `<div class="form-group full mt"><label>Cari penerima tagihan <span class="req">*</span></label><input class="input" id="who-q" placeholder="NIM / nama (mahasiswa) atau no. pendaftaran / nama (pendaftar)"><div id="who-res" class="mt small"></div><div id="who-pick" class="badge ok hidden mt"></div></div>`,
    afterRender: (form) => {
      const fee = () => fees.find((f) => f.id === form.elements.fee_type_id.value);
      const prefill = () => { const f = fee(); if (f) { form.elements.description.value = f.name; form.elements.amount.value = f.amount > 0 ? f.amount : ''; } };
      prefill();
      form.elements.fee_type_id.addEventListener('change', prefill);
      form.elements.who.addEventListener('change', () => { target = null; $('#who-pick', form).classList.add('hidden'); $('#who-res', form).innerHTML = ''; });
      const search = debounce(async () => {
        const t = clean($('#who-q', form).value.trim()); const res = $('#who-res', form);
        if (t.length < 2) { res.innerHTML = ''; return; }
        const isS = form.elements.who.value === 'student';
        const { data, error } = isS
          ? await sb.from('students').select('id,nim,full_name').or(`nim.ilike.%${t}%,full_name.ilike.%${t}%`).limit(8)
          : await sb.from('pmb_applicants').select('id,reg_number,full_name').or(`reg_number.ilike.%${t}%,full_name.ilike.%${t}%`).limit(8);
        if (error) { res.textContent = error.message; return; }
        res.innerHTML = data.length ? data.map((r) => `<button type="button" class="btn btn-ghost btn-sm" data-id="${r.id}" data-t="${esc(r.full_name)} · ${esc(r.nim || r.reg_number)}">${esc(r.full_name)} · ${esc(r.nim || r.reg_number)}</button>`).join(' ') : 'Tidak ditemukan.';
        $$('[data-id]', res).forEach((b) => b.addEventListener('click', () => { target = { kind: form.elements.who.value, id: b.dataset.id }; const p = $('#who-pick', form); p.textContent = b.dataset.t; p.classList.remove('hidden'); res.innerHTML = ''; }));
      }, 300);
      $('#who-q', form).addEventListener('input', search);
    },
    onSubmit: async (d) => {
      if (!target) throw new Error('Pilih penerima tagihan dari hasil pencarian.');
      const row = { fee_type_id: d.fee_type_id, description: d.description, amount: d.amount, due_date: d.due_date || null, semester_id: d.semester_id || null, created_by: ctx.user.id };
      if (target.kind === 'student') row.student_id = target.id; else row.applicant_id = target.id;
      const { error } = await sb.from('invoices').insert(row); if (error) throw error;
      ok('Tagihan dibuat.'); draw();
    },
  });
  return m;
}

async function bulkUkt() {
  let fees = [], sem = null;
  try { [fees, sem] = await Promise.all([q(sb.from('fee_types').select('*').eq('is_active', true).eq('kind', 'ukt')), activeSemester()]); } catch (e) { fail(e); return; }
  if (!sem) { toast('Belum ada semester aktif. Atur di menu Prodi & Kelas.', 'warn'); return; }
  if (!fees.length) { toast('Belum ada jenis biaya berjenis UKT yang aktif.', 'warn'); return; }
  formModal({
    title: 'Buat UKT Massal', submitLabel: 'Buat Tagihan',
    fields: [{ name: 'fee_type_id', label: 'Jenis biaya UKT', type: 'select', required: true, options: opts(fees, 'id', (f) => `${f.name} — ${rupiah(f.amount)}`) },
      { name: 'due_date', label: 'Jatuh tempo', type: 'date' }],
    extraHTML: `<p class="small muted mt">Untuk semua mahasiswa berstatus Aktif / Mahasiswa Baru, semester <b>${esc(sem.name)}</b>. Mahasiswa yang sudah memiliki tagihan jenis biaya + semester yang sama dilewati.</p>`,
    onSubmit: async (d) => {
      const fee = fees.find((f) => f.id === d.fee_type_id);
      if (!(fee.amount > 0)) throw new Error('Nominal jenis biaya harus lebih dari 0.');
      const [studs, have] = await Promise.all([
        q(sb.from('students').select('id').in('status_akademik', ['aktif', 'mahasiswa_baru'])),
        q(sb.from('invoices').select('student_id').eq('fee_type_id', fee.id).eq('semester_id', sem.id).not('student_id', 'is', null)),
      ]);
      const skip = new Set(have.map((x) => x.student_id));
      const rows = studs.filter((s) => !skip.has(s.id)).map((s) => ({ fee_type_id: fee.id, description: `${fee.name} ${sem.name}`, student_id: s.id, semester_id: sem.id, amount: fee.amount, due_date: d.due_date || null, created_by: ctx.user.id }));
      if (!rows.length) { toast('Semua mahasiswa aktif sudah memiliki tagihan ini.', 'info'); return; }
      for (let i = 0; i < rows.length; i += 200) { const { error } = await sb.from('invoices').insert(rows.slice(i, i + 200)); if (error) throw error; }
      ok(`${rows.length} tagihan dibuat (${studs.length - rows.length} dilewati).`); draw();
    },
  });
}

/* ===================== PEMBAYARAN ===================== */
async function loadPayments() {
  const box = $('#tab-body');
  let rows; try { rows = await q(sb.from('payments').select('*,invoices(number,description,student_id,applicant_id,students(nim,full_name),pmb_applicants(reg_number,full_name))').eq('status', 'menunggu').order('created_at')); } catch (e) { box.innerHTML = errorHTML(e); return; }
  box.innerHTML = `<p class="muted small mb">Pembayaran yang menunggu verifikasi. Hanya pembayaran terverifikasi yang mengurangi tagihan.</p>${table([
    { label: 'Tagihan', render: (p) => `<code>${esc(p.invoices?.number)}</code><div class="small muted">${esc(p.invoices?.description || '')}</div>` },
    { label: 'Pembayar', render: (p) => { const s = p.invoices?.students, a = p.invoices?.pmb_applicants; return s ? `${esc(s.full_name)}<div class="small muted">${esc(s.nim)}</div>` : a ? `${esc(a.full_name)}<div class="small muted">${esc(a.reg_number)}</div>` : '-'; } },
    { label: 'Jumlah', cls: 'num', render: (p) => rupiah(p.amount) }, { label: 'Tanggal bayar', render: (p) => fmtDate(p.paid_at) }, { label: 'Metode', render: (p) => esc(p.method || '-') },
    { label: 'Bukti', render: (p) => (p.proof_path ? `<button class="btn btn-ghost btn-sm" data-proof="${p.id}"><i class="bi bi-eye"></i> Lihat</button>` : '<span class="muted">—</span>') },
    { label: '', cls: 'actions', render: (p) => (canU ? `<button class="btn btn-primary btn-sm" data-ok="${p.id}">Setujui</button><button class="btn btn-danger btn-sm" data-no="${p.id}">Tolak</button>` : '') },
  ], rows, 'Tidak ada pembayaran yang menunggu verifikasi.')}`;
  const by = Object.fromEntries(rows.map((p) => [p.id, p]));
  $$('[data-proof]', box).forEach((b) => b.addEventListener('click', () => openPrivate(by[b.dataset.proof].proof_path)));
  $$('[data-ok]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog(`Setujui pembayaran ${rupiah(by[b.dataset.ok].amount)}?`, { danger: false, okText: 'Setujui' }))) return;
    try { await rpc('verify_payment', { p_payment: b.dataset.ok, p_ok: true, p_note: null }); ok('Pembayaran diverifikasi.'); draw(); } catch (e) { fail(e); }
  }));
  $$('[data-no]', box).forEach((b) => b.addEventListener('click', () => formModal({
    title: 'Tolak Pembayaran', submitLabel: 'Tolak',
    fields: [{ name: 'note', label: 'Alasan penolakan', type: 'textarea', required: true, full: true }],
    onSubmit: async (d) => { await rpc('verify_payment', { p_payment: b.dataset.no, p_ok: false, p_note: d.note }); ok('Pembayaran ditolak.'); draw(); },
  })));
}

function payOnBehalf(inv) {
  formModal({
    title: `Catat Pembayaran — ${inv.number}`, submitLabel: 'Simpan & Verifikasi',
    values: { amount: inv.remaining, paid_at: today(), method: 'transfer' },
    fields: [
      { name: 'amount', label: `Jumlah (Rp) — sisa ${rupiah(inv.remaining)}`, type: 'number', required: true, min: 1, step: '1' },
      { name: 'paid_at', label: 'Tanggal bayar', type: 'date', required: true },
      { name: 'method', label: 'Metode', type: 'select', options: ['transfer', 'tunai', 'lainnya'].map((v) => ({ value: v, label: label(v) })) },
      { name: 'file', label: 'Bukti pembayaran (opsional)', type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.webp', help: 'PDF/PNG/JPG/WEBP, maks 5 MB' },
      { name: 'note', label: 'Catatan', type: 'textarea', full: true },
    ],
    onSubmit: async (d) => {
      let path = null;
      if (d.file) {
        if (d.file.size > 5 * 1048576) throw new Error('Ukuran file melebihi 5 MB.');
        const ext = d.file.name.split('.').pop().toLowerCase();
        if (!['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) throw new Error('Tipe file harus PDF/PNG/JPG/WEBP.');
        path = `payments/${inv.id}/${crypto.randomUUID()}.${ext}`;
        const { error: e1 } = await sb.storage.from('academic').upload(path, d.file, { contentType: d.file.type || undefined, upsert: false });
        if (e1) throw e1;
      }
      const { data, error } = await sb.from('payments').insert({ invoice_id: inv.id, amount: d.amount, paid_at: d.paid_at, method: d.method, proof_path: path, note: d.note || null, submitted_by: ctx.user.id }).select('id').single();
      if (error) { if (path) await sb.storage.from('academic').remove([path]); throw error; }
      await rpc('verify_payment', { p_payment: data.id, p_ok: true, p_note: d.note || null });
      ok('Pembayaran dicatat dan diverifikasi.'); draw();
    },
  });
}

/* ===================== RINGKASAN ===================== */
async function loadSummary() {
  const box = $('#tab-body');
  let inv, months;
  try { [inv, months] = await Promise.all([q(sb.from('v_invoices').select('amount,paid,remaining,pay_status')), q(sb.from('v_finance_student_summary').select('*').order('bulan', { ascending: false }))]); } catch (e) { box.innerHTML = errorHTML(e); return; }
  const tagihan = inv.reduce((t, i) => t + Number(i.amount), 0), terbayar = inv.reduce((t, i) => t + Number(i.paid), 0);
  const tunggakan = inv.reduce((t, i) => t + Math.max(0, Number(i.remaining)), 0);
  const cnt = (s) => inv.filter((i) => i.pay_status === s).length;
  box.innerHTML = `<div class="stat-row"><div class="card"><div class="val">${rupiah(tagihan)}</div><div class="lbl">Total tagihan</div></div>
    <div class="card"><div class="val">${rupiah(terbayar)}</div><div class="lbl">Terbayar (terverifikasi)</div></div>
    <div class="card"><div class="val">${rupiah(tunggakan)}</div><div class="lbl">Tunggakan</div></div>
    <div class="card"><div class="val">${cnt('lunas')} / ${inv.length}</div><div class="lbl">Tagihan lunas</div></div></div>
    <div class="flex-between mt mb"><h3>Penerimaan per bulan</h3><button class="btn btn-secondary btn-sm" id="xl"><i class="bi bi-file-earmark-excel"></i> Ekspor Excel</button></div>
    ${table([{ label: 'Bulan', render: (m) => esc(m.bulan) }, { label: 'Diterima', cls: 'num', render: (m) => rupiah(m.diterima) }, { label: 'Menunggu verifikasi', cls: 'num', render: (m) => m.menunggu }], months, 'Belum ada pembayaran.')}`;
  $('#xl')?.addEventListener('click', () => exportXlsx({ filename: 'Ringkasan_Keuangan_Mahasiswa', sheets: [
    { name: 'Ringkasan', columns: ['Ukuran', 'Nilai'], rows: [['Total tagihan', tagihan], ['Terbayar', terbayar], ['Tunggakan', tunggakan], ['Tagihan lunas', cnt('lunas')], ['Sebagian', cnt('sebagian')], ['Belum bayar', cnt('belum_bayar')]] },
    { name: 'Per bulan', columns: ['Bulan', 'Diterima', 'Menunggu'], rows: months.map((m) => [m.bulan, Number(m.diterima || 0), m.menunggu]) }] }));
}

draw();
