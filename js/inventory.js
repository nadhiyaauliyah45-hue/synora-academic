// inventory.js — Inventaris (bagian dari modul Keuangan). CRUD + riwayat perubahan (diisi trigger database).
// Pembelian dapat sekaligus dicatat sebagai pengeluaran kas sehingga saldo tetap konsisten.
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { can } from './permissions.js';
import { exportPdf, exportXlsx } from './export.js';
import { $, $$, esc, ok, fail, toast, confirmDialog, openModal, formModal, loadingHTML, emptyHTML, errorHTML, tabsHTML, fmtDate, fmtDateTime, fmtRupiah, toISODate, debounce } from './utils.js';
import { pageUrl } from './loader.js';

const { ctx, content } = await initPage('inventory');
const canC = can(ctx.role, 'inventory', 'c'), canU = can(ctx.role, 'inventory', 'u'), canD = can(ctx.role, 'inventory', 'd');
const COND = { baik: ['ok', 'Baik'], cukup: ['warn', 'Cukup'], rusak: ['danger', 'Rusak'] };
let rows = [];
const f = { q: '', cond: '' };

content.innerHTML = `<div class="page-header"><div><h1>Inventaris</h1><p>Barang milik kelas TI24D, terhubung dengan pencatatan kas.</p></div>
  <div class="flex">${canC ? '<button class="btn btn-primary" id="add"><i class="bi bi-plus-lg"></i> Tambah Barang</button>' : ''}</div></div>
  ${tabsHTML([{ id: 'finance', label: 'Transaksi', icon: 'bi-cash-stack', href: pageUrl('finance') }, { id: 'inventory', label: 'Inventaris', icon: 'bi-box-seam', href: pageUrl('inventory') }], 'inventory')}
  <div class="toolbar"><input class="input grow" id="q" placeholder="Cari nama atau kategori barang..."><select class="select" id="cond"><option value="">Semua kondisi</option><option value="baik">Baik</option><option value="cukup">Cukup</option><option value="rusak">Rusak</option></select>
    <button class="btn btn-secondary btn-sm" id="x-pdf"><i class="bi bi-file-earmark-pdf"></i> PDF</button><button class="btn btn-secondary btn-sm" id="x-xls"><i class="bi bi-file-earmark-excel"></i> Excel</button></div>
  <div class="card"><div id="list">${loadingHTML()}</div></div>`;

async function load() {
  const box = $('#list'); box.innerHTML = loadingHTML();
  let q = sb.from('inventory').select('*').order('name');
  if (f.cond) q = q.eq('condition', f.cond);
  if (f.q) { const s = f.q.replace(/[%_,()]/g, ' '); q = q.or(`name.ilike.%${s}%,category.ilike.%${s}%`); }
  const { data, error } = await q;
  if (error) { box.innerHTML = errorHTML(error); return; }
  rows = data;
  if (!rows.length) { box.innerHTML = emptyHTML('Belum ada data inventaris.', 'bi-box-seam'); return; }
  box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Nama Barang</th><th>Kategori</th><th class="num">Jumlah</th><th>Kondisi</th><th>Tgl Pembelian</th><th>Keterangan</th><th></th></tr></thead><tbody>
    ${rows.map((i) => `<tr><td><b>${esc(i.name)}</b></td><td>${esc(i.category || '-')}</td><td class="num">${i.quantity}</td>
      <td><span class="badge ${COND[i.condition][0]}">${COND[i.condition][1]}</span></td><td>${fmtDate(i.purchase_date)}</td><td>${esc(i.notes || '-')}</td>
      <td><div class="actions"><button class="btn btn-secondary btn-sm" data-hist="${i.id}"><i class="bi bi-clock-history"></i> Riwayat</button>
        ${canU ? `<button class="btn btn-ghost btn-icon" data-edit="${i.id}" title="Ubah"><i class="bi bi-pencil"></i></button>` : ''}
        ${canD ? `<button class="btn btn-danger btn-icon" data-del="${i.id}" title="Hapus"><i class="bi bi-trash"></i></button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`;
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => form(byId[b.dataset.edit])));
  $$('[data-hist]', box).forEach((b) => b.addEventListener('click', () => history(byId[b.dataset.hist])));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
    const it = byId[b.dataset.del];
    if (!(await confirmDialog(`Hapus barang "${it.name}"? Riwayat penghapusan tetap tercatat.`))) return;
    const { error: e } = await sb.from('inventory').delete().eq('id', it.id);
    if (e) fail(e); else { ok('Barang dihapus.'); load(); }
  }));
}

function form(existing = null) {
  formModal({
    title: existing ? 'Ubah Barang' : 'Tambah Barang', submitLabel: existing ? 'Simpan Perubahan' : 'Simpan',
    values: existing || { quantity: 1, condition: 'baik', purchase_date: toISODate(new Date()) },
    fields: [
      { name: 'name', label: 'Nama barang', required: true, maxlength: 120, full: true },
      { name: 'category', label: 'Kategori', maxlength: 60, placeholder: 'mis. Elektronik, ATK' },
      { name: 'quantity', label: 'Jumlah', type: 'number', required: true, min: 0, step: 1 },
      { name: 'condition', label: 'Kondisi', type: 'select', options: [{ value: 'baik', label: 'Baik' }, { value: 'cukup', label: 'Cukup' }, { value: 'rusak', label: 'Rusak' }] },
      { name: 'purchase_date', label: 'Tanggal pembelian', type: 'date' },
      { name: 'notes', label: 'Keterangan', type: 'textarea', full: true, maxlength: 300 },
      ...(!existing ? [
        { name: 'price', label: 'Total harga pembelian (Rp, opsional)', type: 'number', min: 0, step: 1, full: true },
        { name: 'record_expense', label: 'Catat sebagai pengeluaran kas (kategori "Pembelian Inventaris")', type: 'checkbox', full: true, help: 'Membuat transaksi pengeluaran yang terhubung dengan barang ini.' },
      ] : []),
    ],
    onSubmit: async (v) => {
      const payload = { name: v.name, category: v.category, quantity: v.quantity, condition: v.condition, purchase_date: v.purchase_date, notes: v.notes };
      if (existing) {
        const { error } = await sb.from('inventory').update(payload).eq('id', existing.id);
        if (error) throw error;
        ok('Barang diperbarui.'); load(); return;
      }
      if (v.record_expense && !(v.price > 0)) throw new Error('Isi total harga pembelian untuk mencatat pengeluaran.');
      const { data: item, error } = await sb.from('inventory').insert({ ...payload, created_by: ctx.user.id }).select('id').single();
      if (error) throw error;
      if (v.record_expense) {
        const { data: cat } = await sb.from('finance_categories').select('id').eq('name', 'Pembelian Inventaris').eq('type', 'pengeluaran').maybeSingle();
        const { error: e2 } = await sb.from('transactions').insert({ type: 'pengeluaran', amount: v.price, trx_date: v.purchase_date || toISODate(new Date()), category_id: cat?.id || null, description: `Pembelian ${v.name} (${v.quantity})`, inventory_id: item.id, created_by: ctx.user.id });
        if (e2) { toast('Barang tersimpan, tetapi pengeluaran gagal dicatat: ' + e2.message, 'warn', 7000); load(); return; }
        ok('Barang ditambahkan dan pengeluaran kas dicatat.');
      } else ok('Barang ditambahkan.');
      load();
    },
  });
}

async function history(item) {
  const m = openModal({ title: `Riwayat — ${item.name}`, size: 'lg', content: loadingHTML(), footer: '<button class="btn btn-secondary" data-close>Tutup</button>' });
  const { data, error } = await sb.from('inventory_history').select('*,profiles:changed_by(full_name)').eq('inventory_id', item.id).order('changed_at', { ascending: false });
  if (error) { m.body.innerHTML = errorHTML(error); return; }
  if (!data.length) { m.body.innerHTML = emptyHTML('Belum ada riwayat.'); return; }
  const label = { name: 'Nama', category: 'Kategori', quantity: 'Jumlah', condition: 'Kondisi', purchase_date: 'Tgl beli', notes: 'Keterangan' };
  m.body.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Waktu</th><th>Aksi</th><th>Perubahan</th><th>Oleh</th></tr></thead><tbody>
    ${data.map((h) => {
      let diff = '';
      if (h.action === 'UPDATE') diff = Object.keys(label).filter((k) => String(h.old_data?.[k] ?? '') !== String(h.new_data?.[k] ?? '')).map((k) => `${label[k]}: <s>${esc(h.old_data?.[k] ?? '-')}</s> → <b>${esc(h.new_data?.[k] ?? '-')}</b>`).join('<br>') || 'Tidak ada perubahan kolom utama';
      else if (h.action === 'INSERT') diff = `Dibuat: ${esc(h.new_data?.name)} (jumlah ${h.new_data?.quantity}, ${h.new_data?.condition})`;
      else diff = 'Barang dihapus';
      return `<tr><td>${fmtDateTime(h.changed_at)}</td><td><span class="badge ${h.action === 'DELETE' ? 'danger' : h.action === 'INSERT' ? 'ok' : 'info'}">${h.action}</span></td><td>${diff}</td><td>${esc(h.profiles?.full_name || '-')}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

const exportData = () => ({ columns: ['Nama', 'Kategori', 'Jumlah', 'Kondisi', 'Tgl Pembelian', 'Keterangan'], data: rows.map((i) => [i.name, i.category || '-', i.quantity, i.condition, fmtDate(i.purchase_date), i.notes || '-']) });
$('#x-pdf').addEventListener('click', () => { if (!rows.length) return toast('Tidak ada data.', 'warn'); const d = exportData(); exportPdf({ title: 'Daftar Inventaris Kelas TI24D', columns: d.columns, rows: d.data, filename: 'inventaris' }); });
$('#x-xls').addEventListener('click', () => { if (!rows.length) return toast('Tidak ada data.', 'warn'); const d = exportData(); exportXlsx({ filename: 'inventaris', sheets: [{ name: 'Inventaris', columns: d.columns, rows: d.data }] }); });
$('#add')?.addEventListener('click', () => form());
$('#q').addEventListener('input', debounce(() => { f.q = $('#q').value.trim(); load(); }, 350));
$('#cond').addEventListener('change', () => { f.cond = $('#cond').value; load(); });
await load();
