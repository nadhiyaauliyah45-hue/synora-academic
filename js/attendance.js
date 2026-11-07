// attendance.js — Absensi: input kehadiran, riwayat, rekap per mahasiswa, laporan mingguan/bulanan, ekspor PDF/Excel.
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { can } from './permissions.js';
import { exportPdf, exportXlsx } from './export.js';
import { $, $$, esc, ok, fail, toast, confirmDialog, openModal, loadingHTML, emptyHTML, errorHTML, tabsHTML, fmtDate, toISODate, parseDate } from './utils.js';

const { ctx, content } = await initPage('attendance');
const canC = can(ctx.role, 'attendance', 'c');
const canU = can(ctx.role, 'attendance', 'u');
const canD = can(ctx.role, 'attendance', 'd');
const STATUS = [['hadir', 'H', 'Hadir'], ['izin', 'I', 'Izin'], ['sakit', 'S', 'Sakit'], ['alfa', 'A', 'Alfa']];

let courses = [], students = [];
let tab = canC ? 'input' : 'history';
let editTarget = null;

async function boot() {
  content.innerHTML = loadingHTML();
  const [c, s] = await Promise.all([
    sb.from('courses').select('id,code,name,lecturer_id,lecturers(full_name)').order('name'),
    sb.from('students').select('id,nim,full_name').eq('is_active', true).order('full_name'),
  ]);
  if (c.error || s.error) { content.innerHTML = errorHTML(c.error || s.error); return; }
  courses = c.data; students = s.data;
  render();
}

function render() {
  const tabs = [...(canC ? [{ id: 'input', label: 'Input Absensi', icon: 'bi-pencil-square' }] : []),
    { id: 'history', label: 'Riwayat', icon: 'bi-clock-history' }, { id: 'recap', label: 'Rekap & Laporan', icon: 'bi-bar-chart-fill' }];
  content.innerHTML = `<div class="page-header"><div><h1>Absensi</h1><p>Kelola kehadiran kelas TI24D: hadir, izin, sakit, dan alfa.</p></div></div>
    ${tabsHTML(tabs, tab)}<div id="tab-body"></div>`;
  $$('[data-tab]', content).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
  ({ input: renderInput, history: renderHistory, recap: renderRecap })[tab]();
}

const courseOptions = (all = false) => (all ? '<option value="">Semua mata kuliah</option>' : '') + courses.map((c) => `<option value="${c.id}">${esc(c.name)} (${esc(c.code)})</option>`).join('');

/* ===================== INPUT ===================== */
async function renderInput() {
  const el = $('#tab-body');
  if (!courses.length) { el.innerHTML = emptyHTML('Belum ada mata kuliah. Tambahkan terlebih dahulu di Informasi Mata Kuliah.', 'bi-journal-x'); return; }
  if (!students.length) { el.innerHTML = emptyHTML('Belum ada anggota kelas. Tambahkan terlebih dahulu lewat Memories.', 'bi-people'); return; }
  const t = editTarget || { course_id: courses[0].id, date: toISODate(new Date()) };
  editTarget = null;
  el.innerHTML = `<div class="card">
    <div class="form-grid">
      <div class="form-group"><label for="a-course">Mata kuliah <span class="req">*</span></label><select class="select" id="a-course">${courseOptions()}</select></div>
      <div class="form-group"><label for="a-date">Tanggal <span class="req">*</span></label><input class="input" type="date" id="a-date" value="${t.date}" max="${toISODate(new Date(Date.now() + 86400000 * 30))}"></div>
      <div class="form-group"><label for="a-topic">Topik / pertemuan</label><input class="input" id="a-topic" maxlength="200" placeholder="mis. Pertemuan 5 — Normalisasi"></div>
      <div class="form-group"><label>Dosen pengampu</label><input class="input" id="a-lect" readonly></div>
    </div>
    <div class="toolbar mt"><button class="btn btn-secondary btn-sm" id="all-hadir"><i class="bi bi-check2-all"></i> Semua Hadir</button><span id="att-sum" class="grow right small muted"></span></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>No</th><th>NIM</th><th>Nama</th>${STATUS.map((s) => `<th class="center" title="${s[2]}">${s[1]}</th>`).join('')}<th>Catatan</th></tr></thead><tbody id="att-rows"></tbody></table></div>
    <div class="flex-between mt"><span id="att-mode" class="muted small"></span><button class="btn btn-primary" id="att-save"><i class="bi bi-save"></i> Simpan Absensi</button></div></div>`;
  $('#a-course').value = t.course_id;

  let attId = null;
  const rows = $('#att-rows');
  const updateSum = () => {
    const c = { hadir: 0, izin: 0, sakit: 0, alfa: 0 };
    students.forEach((s) => { const v = $(`input[name="st_${s.id}"]:checked`)?.value; if (v) c[v]++; });
    $('#att-sum').textContent = `Hadir ${c.hadir} · Izin ${c.izin} · Sakit ${c.sakit} · Alfa ${c.alfa}`;
  };
  const drawRows = (map = {}) => {
    rows.innerHTML = students.map((s, i) => {
      const cur = map[s.id]?.status || 'hadir';
      return `<tr><td>${i + 1}</td><td>${esc(s.nim)}</td><td>${esc(s.full_name)}</td>
        ${STATUS.map((st) => `<td class="center"><input type="radio" name="st_${s.id}" value="${st[0]}" ${cur === st[0] ? 'checked' : ''} aria-label="${st[2]} ${esc(s.full_name)}" style="accent-color:var(--orange);width:17px;height:17px"></td>`).join('')}
        <td><input class="input" style="min-height:34px;padding:5px 9px" data-note="${s.id}" maxlength="200" value="${esc(map[s.id]?.note || '')}"></td></tr>`;
    }).join('');
    $$('input[type=radio]', rows).forEach((r) => r.addEventListener('change', updateSum));
    updateSum();
  };
  const sync = async () => {
    const cid = $('#a-course').value, d = $('#a-date').value;
    $('#a-lect').value = courses.find((c) => c.id === cid)?.lecturers?.full_name || '-';
    if (!cid || !d) return;
    rows.innerHTML = `<tr><td colspan="8">${loadingHTML()}</td></tr>`;
    const { data, error } = await sb.from('attendance').select('id,topic,attendance_details(student_id,status,note)').eq('course_id', cid).eq('meeting_date', d).maybeSingle();
    if (error) { rows.innerHTML = `<tr><td colspan="8">${errorHTML(error)}</td></tr>`; return; }
    attId = data?.id || null;
    $('#a-topic').value = data?.topic || '';
    const map = {};
    (data?.attendance_details || []).forEach((x) => { map[x.student_id] = x; });
    $('#att-mode').innerHTML = attId ? '<i class="bi bi-pencil"></i> Mengubah absensi yang sudah tersimpan untuk tanggal ini.' : '<i class="bi bi-plus-circle"></i> Absensi baru.';
    drawRows(map);
  };
  $('#a-course').addEventListener('change', sync);
  $('#a-date').addEventListener('change', sync);
  $('#all-hadir').addEventListener('click', () => { $$('input[type=radio][value=hadir]', rows).forEach((r) => { r.checked = true; }); updateSum(); });
  $('#att-save').addEventListener('click', async () => {
    const cid = $('#a-course').value, d = $('#a-date').value;
    if (!cid) return toast('Pilih mata kuliah.', 'warn');
    if (!d) return toast('Tanggal wajib diisi.', 'warn');
    const btn = $('#att-save'); btn.disabled = true;
    try {
      const course = courses.find((c) => c.id === cid);
      const { data: att, error } = await sb.from('attendance').upsert(
        { course_id: cid, lecturer_id: course?.lecturer_id || null, meeting_date: d, topic: $('#a-topic').value.trim() || null, created_by: ctx.user.id },
        { onConflict: 'course_id,meeting_date' }).select('id').single();
      if (error) throw error;
      const details = students.map((s) => ({
        attendance_id: att.id, student_id: s.id,
        status: $(`input[name="st_${s.id}"]:checked`)?.value || 'hadir',
        note: $(`[data-note="${s.id}"]`).value.trim() || null,
      }));
      const { error: e2 } = await sb.from('attendance_details').upsert(details, { onConflict: 'attendance_id,student_id' });
      if (e2) throw e2;
      ok('Absensi berhasil disimpan.');
      attId = att.id; $('#att-mode').innerHTML = '<i class="bi bi-pencil"></i> Tersimpan. Anda dapat mengubahnya lagi di sini.';
    } catch (e) { fail(e); } finally { btn.disabled = false; }
  });
  await sync();
}

/* ===================== RIWAYAT ===================== */
async function renderHistory() {
  const el = $('#tab-body');
  el.innerHTML = `<div class="toolbar">
      <select class="select" id="h-course">${courseOptions(true)}</select>
      <label class="small muted">Dari <input class="input" type="date" id="h-from"></label>
      <label class="small muted">Sampai <input class="input" type="date" id="h-to"></label>
      <button class="btn btn-secondary btn-sm" id="h-reset">Reset</button></div><div id="h-list">${loadingHTML()}</div>`;
  const load = async () => {
    let q = sb.from('attendance').select('id,meeting_date,topic,course_id,courses(code,name),lecturers(full_name),attendance_details(status)').order('meeting_date', { ascending: false }).limit(300);
    if ($('#h-course').value) q = q.eq('course_id', $('#h-course').value);
    if ($('#h-from').value) q = q.gte('meeting_date', $('#h-from').value);
    if ($('#h-to').value) q = q.lte('meeting_date', $('#h-to').value);
    const { data, error } = await q;
    const box = $('#h-list');
    if (error) { box.innerHTML = errorHTML(error); return; }
    if (!data.length) { box.innerHTML = emptyHTML('Belum ada riwayat absensi untuk filter ini.', 'bi-clipboard-x'); return; }
    box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Tanggal</th><th>Mata Kuliah</th><th>Topik</th><th>Dosen</th><th class="center">H</th><th class="center">I</th><th class="center">S</th><th class="center">A</th><th class="center">% Hadir</th><th></th></tr></thead><tbody>
      ${data.map((r) => {
        const c = { hadir: 0, izin: 0, sakit: 0, alfa: 0 };
        r.attendance_details.forEach((d) => c[d.status]++);
        const tot = r.attendance_details.length; const pct = tot ? Math.round((c.hadir / tot) * 100) : 0;
        return `<tr><td>${fmtDate(r.meeting_date)}</td><td>${esc(r.courses?.name)}<br><small class="muted">${esc(r.courses?.code)}</small></td><td>${esc(r.topic || '-')}</td><td>${esc(r.lecturers?.full_name || '-')}</td>
          <td class="center">${c.hadir}</td><td class="center">${c.izin}</td><td class="center">${c.sakit}</td><td class="center">${c.alfa}</td>
          <td class="center"><span class="badge ${pct >= 75 ? 'ok' : pct >= 50 ? 'warn' : 'danger'}">${pct}%</span></td>
          <td><div class="actions"><button class="btn btn-secondary btn-sm" data-view="${r.id}">Detail</button>
            ${canU ? `<button class="btn btn-ghost btn-icon" data-edit="${r.id}" title="Ubah"><i class="bi bi-pencil"></i></button>` : ''}
            ${canD ? `<button class="btn btn-danger btn-icon" data-del="${r.id}" title="Hapus"><i class="bi bi-trash"></i></button>` : ''}</div></td></tr>`;
      }).join('')}</tbody></table></div>`;
    const byId = Object.fromEntries(data.map((r) => [r.id, r]));
    $$('[data-view]', box).forEach((b) => b.addEventListener('click', () => showDetail(byId[b.dataset.view])));
    $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => { const r = byId[b.dataset.edit]; editTarget = { course_id: r.course_id, date: r.meeting_date }; tab = 'input'; render(); }));
    $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
      const r = byId[b.dataset.del];
      if (!(await confirmDialog(`Hapus absensi ${r.courses?.name} tanggal ${fmtDate(r.meeting_date)}? Seluruh status kehadiran pada pertemuan ini ikut terhapus.`))) return;
      const { error: e } = await sb.from('attendance').delete().eq('id', r.id);
      if (e) fail(e); else { ok('Absensi dihapus.'); load(); }
    }));
  };
  ['h-course', 'h-from', 'h-to'].forEach((id) => $('#' + id).addEventListener('change', load));
  $('#h-reset').addEventListener('click', () => { $('#h-course').value = ''; $('#h-from').value = ''; $('#h-to').value = ''; load(); });
  load();
}

async function showDetail(r) {
  const m = openModal({ title: `${r.courses?.name} — ${fmtDate(r.meeting_date)}`, size: 'lg', content: loadingHTML(), footer: '<button class="btn btn-secondary" data-close>Tutup</button>' });
  const { data, error } = await sb.from('attendance_details').select('status,note,students(nim,full_name)').eq('attendance_id', r.id);
  if (error) { m.body.innerHTML = errorHTML(error); return; }
  data.sort((a, b) => (a.students?.full_name || '').localeCompare(b.students?.full_name || ''));
  const cls = { hadir: 'ok', izin: 'info', sakit: 'warn', alfa: 'danger' };
  m.body.innerHTML = `<p class="muted mb">${esc(r.topic || 'Tanpa topik')} · Dosen: ${esc(r.lecturers?.full_name || '-')}</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>NIM</th><th>Nama</th><th>Status</th><th>Catatan</th></tr></thead><tbody>
    ${data.map((d) => `<tr><td>${esc(d.students?.nim)}</td><td>${esc(d.students?.full_name)}</td><td><span class="badge ${cls[d.status]}">${d.status}</span></td><td>${esc(d.note || '')}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ===================== REKAP & LAPORAN ===================== */
const weekStart = (d) => { const x = parseDate(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return toISODate(x); };

async function fetchAllDetails({ course, from, to }) {
  const out = []; const size = 1000;
  for (let off = 0; ; off += size) {
    let q = sb.from('attendance_details').select('status,student_id,attendance_id,attendance!inner(meeting_date,course_id)').range(off, off + size - 1);
    if (course) q = q.eq('attendance.course_id', course);
    if (from) q = q.gte('attendance.meeting_date', from);
    if (to) q = q.lte('attendance.meeting_date', to);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

function renderRecap() {
  const el = $('#tab-body');
  const today = new Date();
  const monday = weekStart(today);
  const firstOfMonth = toISODate(new Date(today.getFullYear(), today.getMonth(), 1));
  el.innerHTML = `<div class="toolbar">
      <select class="select" id="r-mode"><option value="student">Rekap per mahasiswa</option><option value="week">Laporan mingguan</option><option value="month">Laporan bulanan</option></select>
      <select class="select" id="r-course">${courseOptions(true)}</select>
      <select class="select" id="r-preset"><option value="all">Semua waktu</option><option value="week">Minggu ini</option><option value="month">Bulan ini</option><option value="custom">Kustom</option></select>
      <input class="input" type="date" id="r-from" disabled><input class="input" type="date" id="r-to" disabled>
      <span class="grow"></span>
      <button class="btn btn-secondary btn-sm" id="x-pdf"><i class="bi bi-file-earmark-pdf"></i> PDF</button>
      <button class="btn btn-secondary btn-sm" id="x-xls"><i class="bi bi-file-earmark-excel"></i> Excel</button></div>
    <div id="r-body">${loadingHTML()}</div>`;
  let current = { columns: [], rows: [], title: 'Rekap Absensi' };

  const range = () => {
    const p = $('#r-preset').value;
    if (p === 'week') return { from: monday, to: toISODate(new Date(parseDate(monday).getTime() + 6 * 86400000)) };
    if (p === 'month') return { from: firstOfMonth, to: toISODate(new Date(today.getFullYear(), today.getMonth() + 1, 0)) };
    if (p === 'custom') return { from: $('#r-from').value || null, to: $('#r-to').value || null };
    return { from: null, to: null };
  };
  const load = async () => {
    const box = $('#r-body'); box.innerHTML = loadingHTML();
    const { from, to } = range(); const mode = $('#r-mode').value; const course = $('#r-course').value;
    try {
      const details = await fetchAllDetails({ course, from, to });
      if (!details.length) { box.innerHTML = emptyHTML('Belum ada data kehadiran untuk filter ini.', 'bi-bar-chart'); current.rows = []; return; }
      const blank = () => ({ hadir: 0, izin: 0, sakit: 0, alfa: 0, sessions: new Set() });
      const pct = (c) => { const t = c.hadir + c.izin + c.sakit + c.alfa; return t ? Math.round((c.hadir / t) * 100) : 0; };
      let columns, rows;
      if (mode === 'student') {
        const map = new Map(students.map((s) => [s.id, blank()]));
        details.forEach((d) => { const c = map.get(d.student_id); if (c) { c[d.status]++; c.sessions.add(d.attendance_id); } });
        columns = ['No', 'NIM', 'Nama', 'Pertemuan', 'Hadir', 'Izin', 'Sakit', 'Alfa', '% Hadir'];
        rows = students.map((s, i) => { const c = map.get(s.id); return [i + 1, s.nim, s.full_name, c.sessions.size, c.hadir, c.izin, c.sakit, c.alfa, pct(c) + '%']; });
      } else {
        const groups = new Map();
        details.forEach((d) => {
          const date = d.attendance.meeting_date;
          const key = mode === 'week' ? weekStart(date) : date.slice(0, 7);
          if (!groups.has(key)) groups.set(key, blank());
          const c = groups.get(key); c[d.status]++; c.sessions.add(d.attendance_id);
        });
        columns = [mode === 'week' ? 'Minggu (mulai Senin)' : 'Bulan', 'Pertemuan', 'Hadir', 'Izin', 'Sakit', 'Alfa', '% Hadir'];
        rows = [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, c]) => [
          mode === 'week' ? fmtDate(k) : parseDate(k + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }), c.sessions.size, c.hadir, c.izin, c.sakit, c.alfa, pct(c) + '%']);
      }
      const label = { student: 'Rekap Kehadiran per Mahasiswa', week: 'Laporan Kehadiran Mingguan', month: 'Laporan Kehadiran Bulanan' }[mode];
      const cName = course ? courses.find((c) => c.id === course)?.name : 'Semua mata kuliah';
      current = { columns, rows, title: label, subtitle: `${cName} · ${from ? fmtDate(from) : 'awal'} s.d. ${to ? fmtDate(to) : 'sekarang'}` };
      const pctIdx = columns.length - 1;
      box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
        ${rows.map((r) => `<tr>${r.map((v, i) => { if (i === pctIdx) { const n = parseInt(v, 10); return `<td><span class="badge ${n >= 75 ? 'ok' : n >= 50 ? 'warn' : 'danger'}">${v}</span></td>`; } return `<td>${esc(v)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="small muted mt">% Hadir = jumlah hadir ÷ (hadir + izin + sakit + alfa) × 100.</p>`;
    } catch (e) { box.innerHTML = errorHTML(e); current.rows = []; }
  };
  ['r-mode', 'r-course', 'r-from', 'r-to'].forEach((id) => $('#' + id).addEventListener('change', load));
  $('#r-preset').addEventListener('change', () => { const c = $('#r-preset').value === 'custom'; $('#r-from').disabled = !c; $('#r-to').disabled = !c; load(); });
  $('#x-pdf').addEventListener('click', () => current.rows.length ? exportPdf({ ...current, filename: 'rekap-absensi', landscape: current.columns.length > 7 }) : toast('Tidak ada data untuk diekspor.', 'warn'));
  $('#x-xls').addEventListener('click', () => current.rows.length ? exportXlsx({ filename: 'rekap-absensi', sheets: [{ name: 'Rekap', columns: current.columns, rows: current.rows }] }) : toast('Tidak ada data untuk diekspor.', 'warn'));
  load();
}

boot();
