// finance.js — Keuangan: ringkasan saldo, grafik, transaksi (CRUD + bukti), kategori, laporan.
// Saldo TIDAK disimpan: selalu dihitung database dari tabel transactions (view v_finance_summary).
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { can } from './permissions.js';
import { exportPdf, exportXlsx } from './export.js';
import { uploadFile, removeFiles, signedUrl, BUCKETS } from './storage.js';
import { $, $$, esc, ok, fail, toast, confirmDialog, openModal, formModal, loadingHTML, emptyHTML, errorHTML, tabsHTML, fmtDate, fmtRupiah, toISODate, debounce } from './utils.js';
import { pageUrl } from './loader.js';

const { ctx, content } = await initPage('finance');
const canC = can(ctx.role, 'finance', 'c'), canU = can(ctx.role, 'finance', 'u'), canD = can(ctx.role, 'finance', 'd');
let categories = [];
let summary = { total_income: 0, total_expense: 0, balance: 0 };
const f = { type: '', category: '', from: '', to: '', q: '' };

content.innerHTML = `<div class="page-header"><div><h1>Keuangan</h1><p>Kas kelas TI24D: pemasukan, pengeluaran, dan laporan.</p></div>
  <div class="flex">${canC ? '<button class="btn btn-primary" id="add-in"><i class="bi bi-plus-lg"></i> Pemasukan</button><button class="btn btn-secondary" id="add-out"><i class="bi bi-dash-lg"></i> Pengeluaran</button>' : ''}</div></div>
  ${tabsHTML([{ id: 'finance', label: 'Transaksi', icon: 'bi-cash-stack', href: pageUrl('finance') }, { id: 'inventory', label: 'Inventaris', icon: 'bi-box-seam', href: pageUrl('inventory') }], 'finance')}
  <section class="grid grid-3 stats" id="fin-stats">${loadingHTML()}</section>
  <section class="grid grid-2 mt">
    <div class="card"><div class="card-title"><i class="bi bi-bar-chart-fill"></i> Pemasukan & Pengeluaran (6 bulan terakhir)</div><div id="chart">${loadingHTML()}</div></div>
    <div class="card"><div class="card-title"><i class="bi bi-funnel-fill"></i> Filter & Laporan</div>
      <div class="form-grid">
        <div class="form-group"><label>Jenis</label><select class="select" id="f-type"><option value="">Semua</option><option value="pemasukan">Pemasukan</option><option value="pengeluaran">Pengeluaran</option></select></div>
        <div class="form-group"><label>Kategori</label><select class="select" id="f-cat"></select></div>
        <div class="form-group"><label>Dari tanggal</label><input class="input" type="date" id="f-from"></div>
        <div class="form-group"><label>Sampai tanggal</label><input class="input" type="date" id="f-to"></div>
        <div class="form-group full"><label>Cari keterangan</label><input class="input" id="f-q" placeholder="Cari keterangan..."></div>
      </div>
      <div class="flex mt" style="flex-wrap:wrap"><button class="btn btn-secondary btn-sm" id="f-reset">Reset</button><span style="flex:1"></span>
        <button class="btn btn-secondary btn-sm" id="x-pdf"><i class="bi bi-file-earmark-pdf"></i> Laporan PDF</button>
        <button class="btn btn-secondary btn-sm" id="x-xls"><i class="bi bi-file-earmark-excel"></i> Excel</button>
        ${canC ? '<button class="btn btn-ghost btn-sm" id="cats"><i class="bi bi-tags"></i> Kategori</button>' : ''}</div></div>
  </section>
  <div class="card mt"><div class="card-title"><i class="bi bi-receipt"></i> Riwayat Transaksi</div><div id="tx-list">${loadingHTML()}</div></div>`;

let rows = [];

async function loadCategories() {
  const { data, error } = await sb.from('finance_categories').select('*').order('type').order('name');
  if (error) { fail(error); return; }
  categories = data;
  $('#f-cat').innerHTML = '<option value="">Semua</option>' + categories.map((c) => `<option value="${c.id}">${esc(c.name)} (${c.type})</option>`).join('');
  $('#f-cat').value = f.category;
}

async function loadSummary() {
  const { data, error } = await sb.from('v_finance_summary').select('*').maybeSingle();
  if (error) { $('#fin-stats').innerHTML = errorHTML(error); return; }
  summary = data || summary;
  $('#fin-stats').innerHTML = `
    <div class="card stat-card"><div class="ic" style="background:#E3F3E8;color:#2D7547"><i class="bi bi-wallet2"></i></div><div><div class="val">${fmtRupiah(summary.balance)}</div><div class="lbl">Total Saldo Kas</div></div></div>
    <div class="card stat-card"><div class="ic" style="background:#E3F3E8;color:#2D7547"><i class="bi bi-arrow-down-circle-fill"></i></div><div><div class="val">${fmtRupiah(summary.total_income)}</div><div class="lbl">Total Pemasukan</div></div></div>
    <div class="card stat-card"><div class="ic" style="background:#FBE4E0;color:#A52E22"><i class="bi bi-arrow-up-circle-fill"></i></div><div><div class="val">${fmtRupiah(summary.total_expense)}</div><div class="lbl">Total Pengeluaran</div></div></div>`;
}

async function loadChart() {
  const { data, error } = await sb.from('v_finance_monthly').select('*').order('month', { ascending: false }).limit(6);
  const box = $('#chart');
  if (error) { box.innerHTML = errorHTML(error); return; }
  if (!data.length) { box.innerHTML = emptyHTML('Belum ada transaksi untuk ditampilkan.', 'bi-bar-chart'); return; }
  const pts = data.reverse().map((m) => ({ label: new Date(m.month).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }), inc: Number(m.income), exp: Number(m.expense) }));
  const max = Math.max(1, ...pts.flatMap((p) => [p.inc, p.exp]));
  const W = 520, H = 220, pad = 34, bw = 18, step = (W - pad * 2) / pts.length;
  const y = (v) => H - 28 - (v / max) * (H - 56);
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Grafik pemasukan dan pengeluaran">
    <line x1="${pad}" y1="${H - 28}" x2="${W - pad}" y2="${H - 28}" stroke="#E9D9C2"/>
    ${pts.map((p, i) => { const cx = pad + step * i + step / 2; return `
      <rect x="${cx - bw - 2}" y="${y(p.inc)}" width="${bw}" height="${H - 28 - y(p.inc)}" rx="4" fill="#3E9B5A"><title>Pemasukan ${p.label}: ${fmtRupiah(p.inc)}</title></rect>
      <rect x="${cx + 2}" y="${y(p.exp)}" width="${bw}" height="${H - 28 - y(p.exp)}" rx="4" fill="#C96645"><title>Pengeluaran ${p.label}: ${fmtRupiah(p.exp)}</title></rect>
      <text x="${cx}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#8A7466">${p.label}</text>`; }).join('')}
    <text x="${pad}" y="14" font-size="11" fill="#8A7466">Maks ${fmtRupiah(max)}</text></svg>
    <div class="legend"><span><i style="background:#3E9B5A"></i> Pemasukan</span><span><i style="background:#C96645"></i> Pengeluaran</span></div>`;
}

async function loadTx() {
  const box = $('#tx-list'); box.innerHTML = loadingHTML();
  let q = sb.from('transactions').select('*,finance_categories(name),profiles:created_by(full_name)').order('trx_date', { ascending: false }).order('created_at', { ascending: false }).limit(500);
  if (f.type) q = q.eq('type', f.type);
  if (f.category) q = q.eq('category_id', f.category);
  if (f.from) q = q.gte('trx_date', f.from);
  if (f.to) q = q.lte('trx_date', f.to);
  if (f.q) q = q.ilike('description', `%${f.q.replace(/[%_]/g, ' ')}%`);
  const { data, error } = await q;
  if (error) { box.innerHTML = errorHTML(error); return; }
  rows = data;
  if (!rows.length) { box.innerHTML = emptyHTML('Belum ada transaksi.', 'bi-receipt'); return; }
  box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Keterangan</th><th class="num">Jumlah</th><th>Bukti</th><th></th></tr></thead><tbody>
    ${rows.map((t) => `<tr><td>${fmtDate(t.trx_date)}</td>
      <td><span class="badge ${t.type === 'pemasukan' ? 'ok' : 'danger'}">${t.type}</span></td>
      <td>${esc(t.finance_categories?.name || '-')}</td><td>${esc(t.description || '-')}</td>
      <td class="num" style="color:${t.type === 'pemasukan' ? '#2D7547' : '#A52E22'};font-weight:600">${t.type === 'pemasukan' ? '+' : '−'}${fmtRupiah(t.amount)}</td>
      <td>${t.proof_path ? `<button class="btn btn-ghost btn-sm" data-proof="${t.id}"><i class="bi bi-paperclip"></i> Lihat</button>` : '<span class="muted">–</span>'}</td>
      <td><div class="actions">${canU ? `<button class="btn btn-ghost btn-icon" data-edit="${t.id}" title="Ubah"><i class="bi bi-pencil"></i></button>` : ''}${canD ? `<button class="btn btn-danger btn-icon" data-del="${t.id}" title="Hapus"><i class="bi bi-trash"></i></button>` : ''}</div></td></tr>`).join('')}
    </tbody></table></div><p class="small muted mt">Menampilkan ${rows.length} transaksi (maks. 500 terbaru sesuai filter).</p>`;
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => txForm(byId[b.dataset.edit].type, byId[b.dataset.edit])));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', () => delTx(byId[b.dataset.del])));
  $$('[data-proof]', box).forEach((b) => b.addEventListener('click', () => showProof(byId[b.dataset.proof])));
}

async function showProof(t) {
  try {
    const url = await signedUrl('proofs', t.proof_path);
    const isPdf = t.proof_path.toLowerCase().endsWith('.pdf');
    const m = openModal({ title: 'Bukti Transaksi', size: 'lg', content: isPdf ? `<iframe src="${url}" style="width:100%;height:70vh;border:0"></iframe>` : `<img src="${url}" alt="Bukti" style="max-height:70vh;margin:auto;border-radius:12px">`,
      footer: `<a class="btn btn-secondary" href="${url}" target="_blank" rel="noopener">Buka di tab baru</a><button class="btn btn-primary" data-close>Tutup</button>` });
    return m;
  } catch (e) { fail(e); }
}

async function delTx(t) {
  if (!(await confirmDialog(`Hapus transaksi ${t.type} ${fmtRupiah(t.amount)} (${fmtDate(t.trx_date)})? Saldo akan dihitung ulang otomatis.`))) return;
  const { error } = await sb.from('transactions').delete().eq('id', t.id);
  if (error) return fail(error);
  if (t.proof_path) await removeFiles('proofs', t.proof_path);
  ok('Transaksi dihapus.'); refreshAll();
}

function txForm(type, existing = null) {
  const cats = categories.filter((c) => c.type === type);
  if (!cats.length) return toast('Belum ada kategori untuk jenis ini. Tambahkan lewat tombol Kategori.', 'warn');
  formModal({
    title: `${existing ? 'Ubah' : 'Tambah'} ${type === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran'}`,
    submitLabel: existing ? 'Simpan Perubahan' : 'Simpan',
    values: existing ? { ...existing } : { trx_date: toISODate(new Date()) },
    fields: [
      { name: 'amount', label: 'Jumlah (Rp)', type: 'number', required: true, min: 1, step: 1 },
      { name: 'trx_date', label: 'Tanggal', type: 'date', required: true },
      { name: 'category_id', label: 'Kategori', type: 'select', required: true, options: cats.map((c) => ({ value: c.id, label: c.name })) },
      { name: 'description', label: 'Keterangan', type: 'textarea', full: true, maxlength: 300 },
      { name: 'proof', label: 'Bukti (opsional)', type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.webp', full: true, help: `${BUCKETS.proofs.label}${existing?.proof_path ? ' — mengunggah file baru akan menggantikan bukti lama' : ''}` },
    ],
    onSubmit: async (v) => {
      // Peringatan bila pengeluaran melebihi saldo (hanya menambah pengeluaran baru / menaikkan nominal)
      if (type === 'pengeluaran') {
        const delta = v.amount - (existing ? Number(existing.amount) : 0);
        if (delta > Number(summary.balance) && !(await confirmDialog(`Pengeluaran ini melebihi saldo kas saat ini (${fmtRupiah(summary.balance)}). Tetap simpan?`, { okText: 'Tetap simpan', danger: false }))) throw new Error('Dibatalkan.');
      }
      let proof_path = existing?.proof_path || null;
      let uploaded = null;
      if (v.proof) { uploaded = await uploadFile('proofs', v.proof, 'bukti'); proof_path = uploaded.path; }
      const payload = { type, amount: v.amount, trx_date: v.trx_date, category_id: v.category_id, description: v.description, proof_path };
      let error;
      if (existing) ({ error } = await sb.from('transactions').update(payload).eq('id', existing.id));
      else ({ error } = await sb.from('transactions').insert({ ...payload, created_by: ctx.user.id }));
      if (error) { if (uploaded) await removeFiles('proofs', uploaded.path); throw error; }
      if (uploaded && existing?.proof_path) await removeFiles('proofs', existing.proof_path);
      ok(existing ? 'Transaksi diperbarui.' : 'Transaksi ditambahkan.'); refreshAll();
    },
  });
}

function manageCategories() {
  const m = openModal({ title: 'Kategori Transaksi', content: '<div id="cat-box"></div>', footer: '<button class="btn btn-primary" data-close>Selesai</button>' });
  const draw = () => {
    $('#cat-box', m.root).innerHTML = `<form id="cat-form" class="flex mb" style="flex-wrap:wrap"><input class="input" id="cn" placeholder="Nama kategori" maxlength="60" style="flex:1;min-width:160px"><select class="select" id="ct" style="width:auto"><option value="pemasukan">Pemasukan</option><option value="pengeluaran">Pengeluaran</option></select><button class="btn btn-primary">Tambah</button></form>
      <div class="table-wrap"><table class="table"><tbody>${categories.map((c) => `<tr><td>${esc(c.name)}</td><td><span class="badge ${c.type === 'pemasukan' ? 'ok' : 'danger'}">${c.type}</span></td><td class="right"><button class="btn btn-danger btn-icon" data-dc="${c.id}"><i class="bi bi-trash"></i></button></td></tr>`).join('') || '<tr><td>Belum ada kategori.</td></tr>'}</tbody></table></div>`;
    $('#cat-form', m.root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#cn', m.root).value.trim();
      if (name.length < 2) return toast('Nama kategori minimal 2 karakter.', 'warn');
      const { error } = await sb.from('finance_categories').insert({ name, type: $('#ct', m.root).value });
      if (error) return fail(error);
      ok('Kategori ditambahkan.'); await loadCategories(); draw();
    });
    $$('[data-dc]', m.root).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Hapus kategori ini? Transaksi lama akan menjadi "tanpa kategori".'))) return;
      const { error } = await sb.from('finance_categories').delete().eq('id', b.dataset.dc);
      if (error) return fail(error);
      ok('Kategori dihapus.'); await loadCategories(); draw();
    }));
  };
  draw();
}

function exportRows() {
  const columns = ['Tanggal', 'Jenis', 'Kategori', 'Keterangan', 'Jumlah (Rp)'];
  const data = rows.map((t) => [fmtDate(t.trx_date), t.type, t.finance_categories?.name || '-', t.description || '-', (t.type === 'pemasukan' ? 1 : -1) * Number(t.amount)]);
  return { columns, data };
}
function periodLabel() { return `${f.from ? fmtDate(f.from) : 'awal'} s.d. ${f.to ? fmtDate(f.to) : 'sekarang'}`; }
$('#x-pdf').addEventListener('click', () => {
  if (!rows.length) return toast('Tidak ada transaksi untuk dilaporkan.', 'warn');
  const { columns, data } = exportRows();
  const inc = rows.filter((t) => t.type === 'pemasukan').reduce((s, t) => s + Number(t.amount), 0);
  const out = rows.filter((t) => t.type === 'pengeluaran').reduce((s, t) => s + Number(t.amount), 0);
  exportPdf({ title: 'Laporan Keuangan Kelas TI24D', subtitle: `Periode: ${periodLabel()} · Pemasukan ${fmtRupiah(inc)} · Pengeluaran ${fmtRupiah(out)} · Selisih ${fmtRupiah(inc - out)}`,
    columns, rows: data.map((r) => [...r.slice(0, 4), fmtRupiah(r[4])]), filename: 'laporan-keuangan', foot: ['', '', '', 'Selisih periode', fmtRupiah(inc - out)] });
});
$('#x-xls').addEventListener('click', () => {
  if (!rows.length) return toast('Tidak ada transaksi untuk diekspor.', 'warn');
  const { columns, data } = exportRows();
  exportXlsx({ filename: 'laporan-keuangan', sheets: [{ name: 'Transaksi', columns, rows: data }] });
});

async function refreshAll() { await Promise.all([loadSummary(), loadChart(), loadTx()]); }

$('#add-in')?.addEventListener('click', () => txForm('pemasukan'));
$('#add-out')?.addEventListener('click', () => txForm('pengeluaran'));
$('#cats')?.addEventListener('click', manageCategories);
const applyFilters = () => { f.type = $('#f-type').value; f.category = $('#f-cat').value; f.from = $('#f-from').value; f.to = $('#f-to').value; f.q = $('#f-q').value.trim(); loadTx(); };
['f-type', 'f-cat', 'f-from', 'f-to'].forEach((id) => $('#' + id).addEventListener('change', applyFilters));
$('#f-q').addEventListener('input', debounce(applyFilters, 350));
$('#f-reset').addEventListener('click', () => { ['f-type', 'f-cat', 'f-from', 'f-to', 'f-q'].forEach((id) => { $('#' + id).value = ''; }); applyFilters(); });

await loadCategories();
await refreshAll();
