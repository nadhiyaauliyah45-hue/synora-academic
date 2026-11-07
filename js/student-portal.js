// student-portal.js — Portal Mahasiswa (mobile-first): beranda, KRS, KHS, tagihan, profil & kelulusan.
// Semua data dibatasi RLS ke milik sendiri; UI tidak menjadi penjaga akses.
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { rpc, q, badge, num, label, rupiah, activeSemester } from './crud.js';
import { $, $$, esc, ok, fail, confirmDialog, formModal, loadingHTML, errorHTML, emptyHTML, tabsHTML, fmtDate, fmtDateTime, errMsg } from './utils.js';

const { ctx, content } = await initPage('student-portal');
let tab = 'home';
let me = null;

const TABS = [
  { id: 'home', label: 'Beranda', icon: 'bi-house-heart' },
  { id: 'krs', label: 'KRS', icon: 'bi-journal-check' },
  { id: 'khs', label: 'KHS', icon: 'bi-file-earmark-text' },
  { id: 'bill', label: 'Tagihan', icon: 'bi-receipt' },
  { id: 'grad', label: 'Profil & Kelulusan', icon: 'bi-award' },
];
const LOADERS = { home: loadHome, krs: loadKrs, khs: loadKhs, bill: loadBills, grad: loadGrad };

// Data mahasiswa dicari lewat NIM akun (RLS hanya mengizinkan baris sendiri / kelas yang berhak).
try { const { data } = await sb.from('students').select('*').eq('nim', ctx.profile.nim).maybeSingle(); me = data; } catch { me = null; }

if (!me) {
  content.innerHTML = `<div class="card" style="max-width:520px;margin:24px auto;text-align:center">
    <i class="bi bi-person-exclamation" style="font-size:40px;color:var(--orange,#E98532)"></i>
    <h2>Akun belum terhubung ke data mahasiswa</h2>
    <p>Akun <b>${esc(ctx.profile.nim)}</b> belum memiliki data mahasiswa. Hubungi Admin Prodi agar NIM Anda didaftarkan.</p></div>`;
} else draw();

function draw() {
  content.innerHTML = `<div class="page-header"><div><h1>Halo, ${esc(ctx.profile.full_name.split(' ')[0])}</h1><p>${esc(me.nim)} · ${esc(me.program_studi)} ${me.angkatan ? '· Angkatan ' + me.angkatan : ''}</p></div><div>${badge(me.status_akademik)}</div></div>
    ${tabsHTML(TABS, tab)}<div id="tab-body">${loadingHTML()}</div>`;
  $$('[data-tab]', content).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  LOADERS[tab]().catch((e) => { $('#tab-body').innerHTML = errorHTML(e); });
}
const body = () => $('#tab-body');
const semLabel = (s) => `${s.academic_years?.name || ''} ${label(s.term)}`;
const card = (title, html, extra = '') => `<div class="card mt ${extra}"><h3>${title}</h3>${html}</div>`;

/* ===================== BERANDA ===================== */
async function loadHome() {
  const [hist, ipk, anns] = await Promise.all([
    q(sb.from('student_status_history').select('*').eq('student_id', me.id).order('effective_date').order('id')),
    q(sb.from('v_ipk').select('*').eq('student_id', me.id)),
    sb.from('announcements').select('title,body,created_at').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(5).then((r) => r.data || []).catch(() => []),
  ]);
  const i = ipk[0];
  body().innerHTML = `<div class="stat-row">
      <div class="card"><div class="val">${num(i?.ipk)}</div><div class="lbl">IPK</div></div>
      <div class="card"><div class="val">${i?.total_sks ?? 0}</div><div class="lbl">SKS ditempuh (nilai final)</div></div>
      <div class="card"><div class="val" style="font-size:16px">${badge(me.status_akademik)}</div><div class="lbl">Status${me.status_changed_at ? ' sejak ' + fmtDate(me.status_changed_at) : ''}</div></div></div>
    ${card('Perjalanan Studi', hist.length ? `<ul class="timeline">${hist.map((h) => `<li><b>${esc(label(h.to_status))}</b><small>${fmtDate(h.effective_date)}${h.reason ? ' · ' + esc(h.reason) : ''}</small></li>`).join('')}</ul>` : '<p class="muted">Belum ada riwayat status.</p>')}
    ${card('Pengumuman', anns.length ? anns.map((a) => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><b>${esc(a.title)}</b><br><small class="muted">${fmtDateTime(a.created_at)}</small><div>${esc(a.body)}</div></div>`).join('') : '<p class="muted">Belum ada pengumuman. Notifikasi terbaru ada pada ikon lonceng di atas.</p>')}`;
}

/* ===================== KRS ===================== */
async function loadKrs() {
  const sem = await activeSemester();
  if (!sem) { body().innerHTML = emptyHTML('Belum ada semester aktif. Hubungi Admin Prodi.', 'bi-calendar-x'); return; }
  let { data: krs, error } = await sb.from('krs').select('*').eq('student_id', me.id).eq('semester_id', sem.id).maybeSingle();
  if (error) throw error;
  if (!krs) {
    body().innerHTML = `<div class="card"><h3>KRS ${esc(sem.name)}</h3><p>Anda belum membuat KRS untuk semester ini.</p><button class="btn btn-primary" id="mk"><i class="bi bi-plus-lg"></i> Buat KRS</button></div>`;
    $('#mk').addEventListener('click', async () => {
      const r = await sb.from('krs').insert({ student_id: me.id, semester_id: sem.id });
      if (r.error) fail(r.error); else draw();
    });
    return;
  }
  const [items, courses] = await Promise.all([
    q(sb.from('krs_items').select('id,course_id,courses(code,name,sks)').eq('krs_id', krs.id)),
    q(sb.from('courses').select('id,code,name,sks,semester_no').order('semester_no', { nullsFirst: false }).order('name')),
  ]);
  const editable = ['draft', 'ditolak'].includes(krs.status);
  const total = items.reduce((a, i) => a + (i.courses?.sks || 0), 0);
  const taken = new Set(items.map((i) => i.course_id));
  const avail = courses.filter((c) => !taken.has(c.id));
  body().innerHTML = `<div class="card"><div class="flex-between"><h3>KRS ${esc(sem.name)}</h3>${badge(krs.status)}</div>
      ${krs.note && krs.status === 'ditolak' ? `<p><b>Catatan penolakan:</b> ${esc(krs.note)}</p>` : ''}
      <div class="stat-row mt"><div class="card"><div class="val" style="color:${total > 24 ? '#A52E22' : 'inherit'}">${total} / 24</div><div class="lbl">SKS terpilih (maks 24)</div></div></div>
      <div class="mt">${items.length ? items.map((i) => `<div class="flex-between" style="padding:10px 0;border-bottom:1px solid var(--border)"><div><b>${esc(i.courses?.name)}</b><br><small class="muted">${esc(i.courses?.code)} · ${i.courses?.sks} SKS</small></div>${editable ? `<button class="btn btn-danger btn-icon" data-rm="${i.id}" title="Hapus"><i class="bi bi-x-lg"></i></button>` : ''}</div>`).join('') : '<p class="muted">Belum ada mata kuliah dipilih.</p>'}</div>
      ${editable ? `<div class="toolbar wrap mt"><select class="select grow" id="addc"><option value="">+ Tambah mata kuliah…</option>${avail.map((c) => `<option value="${c.id}">${esc(c.code)} — ${esc(c.name)} (${c.sks} SKS)</option>`).join('')}</select><button class="btn btn-secondary" id="addb">Tambah</button></div>
      <button class="btn btn-primary btn-block mt" id="sub" ${items.length ? '' : 'disabled'}><i class="bi bi-send"></i> Ajukan KRS</button>` : `<p class="muted mt">${krs.status === 'diajukan' ? 'KRS menunggu persetujuan.' : 'KRS sudah disetujui dan tidak dapat diubah.'}</p>`}</div>`;
  $('#addb')?.addEventListener('click', async () => {
    const id = $('#addc').value; if (!id) return;
    const r = await sb.from('krs_items').insert({ krs_id: krs.id, course_id: id });
    if (r.error) fail(r.error); else draw();
  });
  $$('[data-rm]', content).forEach((b) => b.addEventListener('click', async () => {
    const r = await sb.from('krs_items').delete().eq('id', b.dataset.rm);
    if (r.error) fail(r.error); else draw();
  }));
  $('#sub')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Ajukan KRS sekarang? Setelah diajukan KRS tidak dapat diubah sampai diputuskan.', { okText: 'Ajukan', danger: false }))) return;
    try { await rpc('krs_submit', { p_krs: krs.id }); ok('KRS diajukan.'); draw(); } catch (e) { fail(e); }
  });
}

/* ===================== KHS ===================== */
async function loadKhs() {
  const [grades, khs, ipk, sems] = await Promise.all([
    q(sb.from('v_grades').select('*').eq('student_id', me.id)), q(sb.from('v_khs').select('*').eq('student_id', me.id)),
    q(sb.from('v_ipk').select('*').eq('student_id', me.id)),
    q(sb.from('semesters').select('id,term,academic_years(name)').order('start_date', { ascending: false, nullsFirst: false })),
  ]);
  const final = grades.filter((g) => g.is_final);
  const khsBy = Object.fromEntries(khs.map((k) => [k.semester_id, k]));
  const groups = sems.filter((s) => final.some((g) => g.semester_id === s.id));
  body().innerHTML = `<div class="stat-row"><div class="card"><div class="val">${num(ipk[0]?.ipk)}</div><div class="lbl">IPK</div></div><div class="card"><div class="val">${ipk[0]?.total_sks ?? 0}</div><div class="lbl">Total SKS</div></div></div>
    ${groups.length ? groups.map((s) => card(`${esc(semLabel(s))} <span class="badge orange">IPS ${num(khsBy[s.id]?.ips)}</span>`,
      final.filter((g) => g.semester_id === s.id).map((g) => `<div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><div><b>${esc(g.course_name)}</b><br><small class="muted">${esc(g.code)} · ${g.sks} SKS · nilai ${num(g.total)}</small></div><span class="badge ok" style="font-size:15px">${esc(g.letter)}</span></div>`).join(''))).join('') : card('Nilai', '<p class="muted">Belum ada nilai yang difinalisasi dosen.</p>')}`;
}

/* ===================== TAGIHAN ===================== */
const PROOF_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp'];
async function loadBills() {
  const [invs, pays] = await Promise.all([
    q(sb.from('v_invoices').select('*').eq('student_id', me.id).order('created_at', { ascending: false })),
    q(sb.from('payments').select('*').order('created_at', { ascending: false })),
  ]);
  body().innerHTML = invs.length ? invs.map((v) => {
    const mine = pays.filter((p) => p.invoice_id === v.id);
    return `<div class="card mt"><div class="flex-between"><div><b>${esc(v.description)}</b><br><small class="muted">${esc(v.number)}${v.due_date ? ' · jatuh tempo ' + fmtDate(v.due_date) : ''}</small></div>${badge(v.pay_status)}</div>
      <div class="stat-row mt"><div class="card"><div class="val" style="font-size:18px">${rupiah(v.amount)}</div><div class="lbl">Tagihan</div></div><div class="card"><div class="val" style="font-size:18px">${rupiah(v.remaining)}</div><div class="lbl">Sisa</div></div></div>
      ${mine.length ? `<ul class="timeline mt">${mine.map((p) => `<li>${rupiah(p.amount)} ${badge(p.status)}<small>${fmtDate(p.paid_at)}${p.note ? ' · ' + esc(p.note) : ''}</small></li>`).join('')}</ul>` : ''}
      ${v.pay_status !== 'lunas' ? `<button class="btn btn-primary btn-block mt" data-pay="${v.id}"><i class="bi bi-upload"></i> Unggah bukti pembayaran</button>` : ''}</div>`;
  }).join('') : emptyHTML('Belum ada tagihan.', 'bi-receipt');
  const byId = Object.fromEntries(invs.map((v) => [v.id, v]));
  $$('[data-pay]', content).forEach((b) => b.addEventListener('click', () => payForm(byId[b.dataset.pay])));
}
function payForm(v) {
  formModal({
    title: 'Bukti Pembayaran', submitLabel: 'Kirim',
    values: { amount: Number(v.remaining), paid_at: new Date().toISOString().slice(0, 10), method: 'transfer' },
    fields: [
      { name: 'amount', label: 'Jumlah dibayar (Rp)', type: 'number', required: true, min: 1, step: '1' },
      { name: 'paid_at', label: 'Tanggal bayar', type: 'date', required: true },
      { name: 'method', label: 'Metode', required: true },
      { name: 'proof', label: 'Bukti (PDF/PNG/JPG, maks 5 MB)', type: 'file', required: true, accept: '.pdf,.png,.jpg,.jpeg,.webp', full: true },
      { name: 'note', label: 'Catatan', type: 'textarea', full: true },
    ],
    onSubmit: async (d) => {
      const f = d.proof;
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!PROOF_EXT.includes(ext)) throw new Error('Tipe file harus PDF/PNG/JPG/WEBP.');
      if (f.size > 5 * 1048576) throw new Error('Ukuran file maksimal 5 MB.');
      const path = `payments/${v.id}/${crypto.randomUUID()}.${ext}`;
      const up = await sb.storage.from('academic').upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (up.error) throw up.error;
      const r = await sb.from('payments').insert({ invoice_id: v.id, amount: d.amount, paid_at: d.paid_at, method: d.method, proof_path: path, note: d.note, submitted_by: ctx.user.id });
      if (r.error) { await sb.storage.from('academic').remove([path]); throw r.error; }
      ok('Bukti terkirim. Menunggu verifikasi Admin Keuangan.'); draw();
    },
  });
}

/* ===================== PROFIL & KELULUSAN ===================== */
async function loadGrad() {
  let chk = null; let chkErr = null;
  try { chk = await rpc('graduation_check', { p_student: me.id }); } catch (e) { chkErr = e; }
  const [{ data: grad }, { data: thesis }] = await Promise.all([
    sb.from('student_graduation').select('*').eq('student_id', me.id).maybeSingle(),
    sb.from('thesis').select('title,status').eq('student_id', me.id).maybeSingle(),
  ]);
  const tick = (v, t) => `<div style="padding:6px 0"><i class="bi ${v ? 'bi-check-circle-fill' : 'bi-x-circle-fill'}" style="color:${v ? '#2D7547' : '#A52E22'}"></i> ${t}</div>`;
  const canApply = chk && ['aktif', 'proses_penyelesaian', 'belum_memenuhi_syarat'].includes(me.status_akademik) && chk.thesis_ok;
  body().innerHTML = `${card('Data Diri', `<dl class="kv"><dt>Nama</dt><dd>${esc(me.full_name)}</dd><dt>NIM</dt><dd>${esc(me.nim)}</dd><dt>Program Studi</dt><dd>${esc(me.program_studi)}</dd><dt>Angkatan</dt><dd>${me.angkatan ?? '-'}</dd><dt>Tanggal masuk</dt><dd>${me.tanggal_masuk ? fmtDate(me.tanggal_masuk) : '-'}</dd><dt>Status</dt><dd>${badge(me.status_akademik)}</dd></dl>`)}
    ${grad ? card('Kelulusan', `<dl class="kv"><dt>Tanggal lulus</dt><dd>${fmtDate(grad.graduation_date)}</dd><dt>IPK</dt><dd>${num(grad.ipk)}</dd><dt>Total SKS</dt><dd>${grad.total_sks ?? '-'}</dd><dt>Judul skripsi</dt><dd>${esc(grad.thesis_title || '-')}</dd><dt>No. SK</dt><dd>${esc(grad.sk_number || '-')}</dd></dl>`)
      : card('Syarat Kelulusan', chkErr ? `<p class="muted">${esc(errMsg(chkErr))}</p>` : `${tick(chk.sks_ok, `SKS: ${chk.total_sks} dari minimal ${chk.min_sks}`)}${tick(chk.ipk_ok, `IPK: ${num(chk.ipk)} (minimal ${num(chk.min_ipk)})`)}${tick(chk.thesis_ok, `Skripsi: ${thesis ? esc(label(thesis.status)) : 'belum diajukan'}`)}${tick(chk.finance_ok, chk.unpaid_invoices ? `${chk.unpaid_invoices} tagihan belum lunas` : 'Tagihan lunas')}
        ${me.status_akademik === 'mengajukan_kelulusan' ? '<p class="mt"><span class="badge orange">Pengajuan kelulusan sedang diproses Prodi</span></p>' : ''}
        ${me.status_akademik === 'belum_memenuhi_syarat' ? '<p class="mt">Pengajuan sebelumnya belum memenuhi syarat. Lengkapi lalu ajukan kembali. Ini bukan berarti gagal.</p>' : ''}
        ${canApply ? '<button class="btn btn-primary btn-block mt" id="apply"><i class="bi bi-award"></i> Ajukan Kelulusan</button>' : ''}`)}`;
  $('#apply')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Ajukan kelulusan sekarang?', { okText: 'Ajukan', danger: false }))) return;
    try { await rpc('graduation_apply'); ok('Pengajuan kelulusan dikirim.'); const { data } = await sb.from('students').select('*').eq('id', me.id).maybeSingle(); if (data) me = data; draw(); } catch (e) { fail(e); }
  });
}
