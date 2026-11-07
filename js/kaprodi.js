// kaprodi.js — Dashboard Kaprodi: semua angka dari view database (tanpa data dummy).
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { q, badge, label, table, num } from './crud.js';
import { exportXlsx } from './export.js';
import { $, $$, esc, fmtDate, loadingHTML, errorHTML, emptyHTML } from './utils.js';

const { ctx, content } = await initPage('kaprodi');
const SCOPE_TITLE = { dekan: 'Dashboard Fakultas', kaprodi: 'Dashboard Program Studi', admin_prodi: 'Dashboard Program Studi', admin_universitas: 'Dashboard Universitas', super_admin: 'Dashboard Universitas' };

const STATUSES = ['calon', 'pendaftar', 'peserta_seleksi', 'diterima', 'registrasi_ulang', 'mahasiswa_baru', 'aktif', 'cuti', 'nonaktif',
  'mengundurkan_diri', 'do', 'proses_penyelesaian', 'mengajukan_kelulusan', 'belum_memenuhi_syarat', 'lulus', 'alumni'];
const BELUM_LULUS = ['mahasiswa_baru', 'aktif', 'cuti', 'nonaktif', 'proses_penyelesaian', 'mengajukan_kelulusan', 'belum_memenuhi_syarat'];
const COLORS = ['#C96645', '#E98532', '#573725', '#81513A', '#2D7547', '#2D6395', '#A8670E', '#A52E22', '#7A6A5E'];

let D = null; // data terakhir
const filter = { angkatan: '', status: '', program: '' };

content.innerHTML = `<div class="page-header"><div><h1>${SCOPE_TITLE[ctx.role] || 'Dashboard Akademik'}</h1><p>Perjalanan mahasiswa dari PMB sampai lulus. Seluruh angka dihitung langsung dari database.</p></div>
  <div class="flex"><button class="btn btn-secondary" id="btn-refresh"><i class="bi bi-arrow-clockwise"></i> Muat ulang</button><button class="btn btn-primary" id="btn-xlsx"><i class="bi bi-file-earmark-excel"></i> Ekspor Excel</button></div></div>
  <div id="kp-body">${loadingHTML()}</div>`;
$('#btn-refresh').addEventListener('click', load);
$('#btn-xlsx').addEventListener('click', exportExcel);

async function load() {
  try {
    const P = filter.program; // filter prodi memakai view varian *_p; tanpa filter = total seluruh cakupan Anda
    const view = (name) => (P ? sb.from(name + '_p').select('*').eq('program_id', P) : sb.from(name).select('*'));
    const [life, cohort, yearly, dist, pmbAll, studs, progs, summary] = await Promise.all([
      q(view('v_lifecycle_summary')),
      q(view('v_cohort_graduation').order('angkatan')),
      q(view('v_graduation_yearly').order('tahun')),
      q(view('v_ipk_distribution')),
      q(sb.from('v_pmb_summary').select('*')),
      q((P ? sb.from('students').select('id,nim,full_name,angkatan,status_akademik').eq('program_id', P) : sb.from('students').select('id,nim,full_name,angkatan,status_akademik'))),
      q(sb.from('v_my_programs').select('*').order('faculty_name', { nullsFirst: false }).order('name')),
      q(sb.from('v_program_summary').select('*')),
    ]);
    const pmb = P ? pmbAll.filter((r) => r.program_id === P) : pmbAll;
    D = { life, cohort, yearly, dist, pmb, studs, progs, summary };
    draw();
  } catch (e) { $('#kp-body').innerHTML = errorHTML(e); }
}

// Ringkasan per fakultas dan program studi; persentase dihitung dari jumlah (bukan rata-rata persen)
function facultyTable(rows) {
  const groups = {};
  rows.forEach((r) => { (groups[r.faculty_name || '— Tanpa fakultas —'] ||= []).push(r); });
  const pc = (l, t) => (t ? num((100 * l) / t, 1) + '%' : '-');
  const body = Object.entries(groups).map(([f, rs]) => {
    const t = sumBy(rs, 'terdaftar'), a = sumBy(rs, 'aktif'), l = sumBy(rs, 'lulus');
    return `<tr class="grp"><td><b>${esc(f)}</b></td><td></td><td class="num"><b>${t}</b></td><td class="num"><b>${a}</b></td><td class="num"><b>${l}</b></td><td class="num"><b>${pc(l, t)}</b></td></tr>`
      + rs.map((r) => `<tr><td></td><td>${esc(r.program_name)} <small>(${esc(r.level)})</small></td><td class="num">${r.terdaftar}</td><td class="num">${r.aktif}</td><td class="num">${r.lulus}</td><td class="num">${pct(r.pct_lulus_dari_terdaftar)}</td></tr>`).join('');
  }).join('');
  return `<div class="card mt"><h3>Per Fakultas dan Program Studi</h3><p class="muted small">% lulus = Lulus ÷ Terdaftar (mahasiswa baru ke atas). Fakultas dijumlahkan dari prodi di bawahnya.</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Fakultas</th><th>Program Studi</th><th class="num">Terdaftar</th><th class="num">Aktif</th><th class="num">Lulus</th><th class="num">% lulus</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}

const sumBy = (rows, k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
const pct = (v) => (v === null || v === undefined ? '-' : num(v, 1) + '%');

function bars(items, fmt = (v) => v) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<div class="bar-list">${items.map((i) => `<div class="row"><span>${esc(i.label)}</span><div class="track"><div class="fill" style="width:${(i.value / max) * 100}%"></div></div><b>${esc(fmt(i.value))}</b></div>`).join('')}</div>`;
}
function pie(items) {
  const total = items.reduce((a, i) => a + i.value, 0);
  if (!total) return emptyHTML('Belum ada data.', 'bi-pie-chart');
  let acc = 0;
  const stops = items.map((i, n) => { const s = acc; acc += (i.value / total) * 100; return `${COLORS[n % COLORS.length]} ${s}% ${acc}%`; }).join(',');
  return `<div class="flex" style="gap:18px;flex-wrap:wrap;align-items:center"><div class="pie" style="background:conic-gradient(${stops})" role="img" aria-label="Diagram pie"></div>
    <div class="legend">${items.map((i, n) => `<div><i style="background:${COLORS[n % COLORS.length]}"></i>${esc(i.label)}: <b>${i.value}</b> (${((i.value / total) * 100).toFixed(1).replace('.', ',')}%)</div>`).join('')}</div></div>`;
}
function line(points) {
  if (!points.length) return emptyHTML('Belum ada lulusan.', 'bi-graph-up');
  const W = 520, H = 180, P = 28;
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i) => (points.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (points.length - 1));
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const pts = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Grafik garis lulusan per tahun">
    <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#d9c7b0"/>
    <polyline fill="none" stroke="#C96645" stroke-width="2.5" points="${pts}"/>
    ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.value)}" r="4" fill="#C96645"/><text x="${x(i)}" y="${y(p.value) - 8}" text-anchor="middle" font-size="11" fill="currentColor">${p.value}</text><text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="currentColor">${esc(p.label)}</text>`).join('')}</svg>`;
}

function draw() {
  const { life, cohort, yearly, dist, pmb, studs, progs, summary } = D;
  const L = Object.fromEntries(life.map((r) => [r.status_akademik, r.total]));
  const cnt = (...s) => s.reduce((a, k) => a + (L[k] || 0), 0);
  const angkatanList = [...new Set(studs.map((s) => s.angkatan).filter(Boolean))].sort();
  const fs = studs.filter((s) => (!filter.angkatan || String(s.angkatan) === String(filter.angkatan)) && (!filter.status || s.status_akademik === filter.status));
  const fCount = {}; fs.forEach((s) => { fCount[s.status_akademik] = (fCount[s.status_akademik] || 0) + 1; });
  const rows = cohort.filter((c) => !filter.angkatan || String(c.angkatan) === String(filter.angkatan));

  const stat = (lbl, val, ic) => `<div class="card"><div class="val">${val}</div><div class="lbl"><i class="bi ${ic}"></i> ${lbl}</div></div>`;
  const tepat = sumBy(rows, 'lulus_tepat_waktu'), telat = sumBy(rows, 'lulus_terlambat');
  const avgMonths = (() => { const w = rows.filter((r) => r.rata_masa_studi_bulan !== null); const n = sumBy(w, 'lulus'); return n ? w.reduce((a, r) => a + r.rata_masa_studi_bulan * r.lulus, 0) / n : null; })();

  $('#kp-body').innerHTML = `
  <div class="stat-row">
    ${stat('Pendaftar PMB', sumBy(pmb, 'pendaftar'), 'bi-person-plus')}
    ${stat('Diterima', sumBy(pmb, 'diterima'), 'bi-check2-circle')}
    ${stat('Registrasi ulang', sumBy(pmb, 'registrasi_ulang'), 'bi-clipboard-check')}
    ${stat('Mahasiswa aktif', cnt('aktif', 'mahasiswa_baru'), 'bi-mortarboard')}
    ${stat('Cuti', cnt('cuti'), 'bi-pause-circle')}
    ${stat('Nonaktif', cnt('nonaktif'), 'bi-dash-circle')}
    ${stat('Mengundurkan diri', cnt('mengundurkan_diri'), 'bi-box-arrow-right')}
    ${stat('DO', cnt('do'), 'bi-x-octagon')}
    ${stat('Lulus (+alumni)', cnt('lulus', 'alumni'), 'bi-award')}
    ${stat('Belum lulus', cnt(...BELUM_LULUS), 'bi-hourglass-split')}
  </div>

  ${summary.length > 1 ? facultyTable(summary) : ''}

  <div class="card mt"><div class="toolbar wrap">
    ${progs.length > 1 ? `<label>Program Studi <select class="select" id="f-prog"><option value="">Semua prodi dalam cakupan</option>${[...new Set(progs.map((p) => p.faculty_name || '—'))].map((fn) => `<optgroup label="${esc(fn)}">${progs.filter((p) => (p.faculty_name || '—') === fn).map((p) => `<option value="${p.id}" ${p.id === filter.program ? 'selected' : ''}>${esc(p.name)} (${esc(p.level)})</option>`).join('')}</optgroup>`).join('')}</select></label>` : ''}
    <label>Angkatan <select class="select" id="f-ang"><option value="">Semua</option>${angkatanList.map((a) => `<option ${String(a) === String(filter.angkatan) ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
    <label>Status <select class="select" id="f-st"><option value="">Semua</option>${STATUSES.map((s) => `<option value="${s}" ${s === filter.status ? 'selected' : ''}>${esc(label(s))}</option>`).join('')}</select></label>
    <span class="badge info">${fs.length} mahasiswa sesuai filter</span></div></div>

  <div class="grid grid-2 mt">
    <div class="card"><h3>Status mahasiswa ${filter.angkatan ? '(angkatan ' + esc(filter.angkatan) + ')' : ''}</h3>${pie(Object.entries(fCount).map(([k, v]) => ({ label: label(k), value: v })))}</div>
    <div class="card"><h3>Distribusi IPK lulusan</h3>${pie(dist.map((d) => ({ label: d.rentang, value: d.jumlah })))}</div>
    <div class="card"><h3>Lulusan per angkatan</h3>${rows.length ? bars(rows.map((r) => ({ label: 'Angkatan ' + r.angkatan, value: r.lulus }))) : emptyHTML('Belum ada data angkatan.')}</div>
    <div class="card"><h3>Tren lulusan per tahun</h3>${line(yearly.map((y) => ({ label: String(y.tahun), value: y.lulusan })))}</div>
  </div>

  <div class="stat-row mt">
    ${stat('Lulus tepat waktu', tepat, 'bi-clock-history')}${stat('Lulus terlambat', telat, 'bi-alarm')}
    ${stat('Rata-rata masa studi', avgMonths === null ? '-' : num(avgMonths, 1) + ' bln', 'bi-calendar-range')}
    ${stat('DO (angkatan terpilih)', sumBy(rows, 'do_count'), 'bi-x-octagon')}${stat('Mengundurkan diri', sumBy(rows, 'resign'), 'bi-box-arrow-right')}
  </div>

  <div class="card mt"><h3>Kelulusan per angkatan</h3>
    <div class="card" style="background:var(--beige);padding:12px 14px;margin:8px 0 12px;font-size:13px"><b><i class="bi bi-info-circle"></i> Definisi</b>
      <ul style="margin:6px 0 0 18px;padding:0">
        <li><b>Terdaftar</b> = mahasiswa angkatan itu yang sudah registrasi ulang (status mahasiswa baru ke atas), termasuk yang cuti, nonaktif, mengundurkan diri, dan DO. Status calon sampai registrasi ulang <b>tidak dihitung</b>.</li>
        <li><b>% dari terdaftar</b> = Lulus ÷ Terdaftar. <b>% dari selesai</b> = Lulus ÷ (Lulus + Mengundurkan diri + DO).</li>
        <li><b>Belum lulus bukan gagal</b>: mencakup aktif, cuti, nonaktif, proses penyelesaian, mengajukan kelulusan, dan belum memenuhi syarat.</li>
        <li>Rata-rata IPK dan masa studi hanya dari lulusan; batas tepat waktu mengikuti pengaturan <code>graduation_rules</code>.</li></ul></div>
    ${table([
      { label: 'Angkatan', render: (r) => `<b>${r.angkatan}</b>` },
      { label: 'Terdaftar', render: (r) => r.terdaftar, cls: 'num' },
      { label: 'Lulus', render: (r) => r.lulus, cls: 'num' },
      { label: 'Belum lulus', render: (r) => r.belum_lulus, cls: 'num' },
      { label: 'Cuti', render: (r) => r.cuti, cls: 'num' },
      { label: 'Mundur', render: (r) => r.resign, cls: 'num' },
      { label: 'DO', render: (r) => r.do_count, cls: 'num' },
      { label: '% dari terdaftar', render: (r) => pct(r.pct_lulus_dari_terdaftar), cls: 'num' },
      { label: '% dari selesai', render: (r) => pct(r.pct_lulus_dari_selesai), cls: 'num' },
      { label: 'Rata-rata IPK', render: (r) => num(r.rata_ipk), cls: 'num' },
      { label: 'Masa studi (bln)', render: (r) => num(r.rata_masa_studi_bulan, 1), cls: 'num' },
      { label: 'Tepat / terlambat', render: (r) => `${r.lulus_tepat_waktu} / ${r.lulus_terlambat}`, cls: 'num' },
    ], rows, 'Belum ada data angkatan. Isi angkatan pada data mahasiswa.')}</div>

  <div class="card mt"><h3>Telusuri mahasiswa per NIM</h3>
    <div class="toolbar"><input class="input grow" id="q-nim" placeholder="Ketik NIM atau nama lalu Enter..."><button class="btn btn-secondary" id="q-go"><i class="bi bi-search"></i> Cari</button></div>
    <div id="trace"></div></div>`;

  $('#f-prog')?.addEventListener('change', (e) => { filter.program = e.target.value; filter.angkatan = ''; load(); });
  $('#f-ang').addEventListener('change', (e) => { filter.angkatan = e.target.value; draw(); });
  $('#f-st').addEventListener('change', (e) => { filter.status = e.target.value; draw(); });
  const go = () => trace($('#q-nim').value.trim());
  $('#q-go').addEventListener('click', go);
  $('#q-nim').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

async function trace(term) {
  const box = $('#trace');
  if (!term) { box.innerHTML = ''; return; }
  box.innerHTML = loadingHTML();
  try {
    const like = `%${term.replace(/[%,()]/g, '')}%`;
    const found = await q(sb.from('students').select('*').or(`nim.ilike.${like},full_name.ilike.${like}`).limit(5));
    if (!found.length) { box.innerHTML = emptyHTML('Mahasiswa tidak ditemukan.', 'bi-search'); return; }
    const s = found[0];
    const [hist, periods, grad, ipk] = await Promise.all([
      q(sb.from('student_status_history').select('*').eq('student_id', s.id).order('effective_date').order('id')),
      q(sb.from('student_study_periods').select('*').eq('student_id', s.id).order('start_date')),
      q(sb.from('student_graduation').select('*').eq('student_id', s.id)),
      q(sb.from('v_ipk').select('*').eq('student_id', s.id)),
    ]);
    box.innerHTML = `<div class="mt"><b>${esc(s.full_name)}</b> · NIM ${esc(s.nim)} · Angkatan ${esc(s.angkatan ?? '-')} ${badge(s.status_akademik)}
      ${found.length > 1 ? `<small class="muted"> (menampilkan 1 dari ${found.length} hasil; persempit dengan NIM lengkap)</small>` : ''}
      <div class="muted" style="font-size:13px">Masuk: ${s.tanggal_masuk ? fmtDate(s.tanggal_masuk) : '-'} · SKS lulus: ${ipk[0]?.total_sks ?? 0} · IPK: ${num(ipk[0]?.ipk)}${grad[0] ? ` · Lulus: ${fmtDate(grad[0].graduation_date)}` : ''}</div></div>
      <div class="grid grid-2 mt"><div><h4>Riwayat status</h4>${hist.length ? `<ul class="timeline">${hist.map((h) => `<li><b>${esc(label(h.from_status || 'awal'))} → ${esc(label(h.to_status))}</b><small>${fmtDate(h.effective_date)}${h.reason ? ' · ' + esc(h.reason) : ''}</small></li>`).join('')}</ul>` : emptyHTML('Belum ada riwayat.')}</div>
      <div><h4>Masa studi</h4>${periods.length ? `<ul class="timeline">${periods.map((p) => `<li><b>${esc(label(p.period_type))}</b><small>${fmtDate(p.start_date)} – ${p.end_date ? fmtDate(p.end_date) : 'sekarang'}${p.reason ? ' · ' + esc(p.reason) : ''}</small></li>`).join('')}</ul>` : emptyHTML('Belum ada data masa studi.')}</div></div>`;
  } catch (e) { box.innerHTML = errorHTML(e); }
}

async function exportExcel() {
  if (!D) return;
  await exportXlsx({
    filename: 'Kaprodi_Kelulusan',
    sheets: [
      { name: 'Per Angkatan', columns: ['Angkatan', 'Terdaftar', 'Lulus', 'Belum lulus', 'Cuti', 'Mundur', 'DO', '% dari terdaftar', '% dari selesai', 'Rata IPK', 'Masa studi (bln)', 'Tepat waktu', 'Terlambat'],
        rows: D.cohort.map((r) => [r.angkatan, r.terdaftar, r.lulus, r.belum_lulus, r.cuti, r.resign, r.do_count, r.pct_lulus_dari_terdaftar, r.pct_lulus_dari_selesai, r.rata_ipk, r.rata_masa_studi_bulan, r.lulus_tepat_waktu, r.lulus_terlambat]) },
      { name: 'Per Prodi', columns: ['Fakultas', 'Program Studi', 'Jenjang', 'Terdaftar', 'Aktif', 'Lulus', '% lulus dari terdaftar'], rows: D.summary.map((r) => [r.faculty_name, r.program_name, r.level, r.terdaftar, r.aktif, r.lulus, r.pct_lulus_dari_terdaftar]) },
      { name: 'Per Status', columns: ['Status', 'Jumlah'], rows: D.life.map((r) => [label(r.status_akademik), r.total]) },
      { name: 'Per Tahun', columns: ['Tahun', 'Lulusan', 'Rata IPK', 'Masa studi (bln)'], rows: D.yearly.map((r) => [r.tahun, r.lulusan, r.rata_ipk, r.rata_masa_studi_bulan]) },
    ],
  });
}

await load();
setInterval(() => { if (!document.hidden && !$('#q-nim')?.value) load(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
