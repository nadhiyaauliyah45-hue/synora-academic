// dashboard.js — dashboard dinamis menurut role.
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { can, canSeeBalance, ROLES, HOME } from './permissions.js';
import { pageUrl } from './loader.js';
import { APP } from './config.js';
import { $, $$, esc, greeting, fmtDate, fmtRupiah, fmtDateTime, hhmm, emptyHTML, DAYS, parseDate } from './utils.js';
import { openGameMenu, openDrawing, openMusic } from './widgets.js';

const { ctx, content } = await initPage('dashboard');
const { role, profile } = ctx;
if (HOME[role]) { location.replace(pageUrl(HOME[role])); await new Promise(() => {}); }
const first = profile.full_name.split(' ')[0];

content.innerHTML = `
  <section class="welcome">
    <div>
      <h1>${greeting()}, ${esc(first)}! 👋</h1>
      <p>Selamat datang di <b>SYNORA</b> — kelas <b>${APP.className}</b>, ${APP.institution}.</p>
      <p class="quote">“${esc(APP.quote)}”</p>
      <span class="tag">${APP.className} · ${esc(APP.slogan)}</span>
    </div>
    <div class="art"><i class="bi bi-mortarboard-fill"></i></div>
  </section>
  <section class="grid grid-4 stats mt" id="stats"></section>
  <section class="dash-grid" id="dash-grid">
    <div class="card" id="c-schedule"><div class="card-title"><i class="bi bi-clock-history"></i> Jadwal Hari Ini</div><div class="body"></div></div>
    <div class="card" id="c-ann"><div class="card-title"><i class="bi bi-megaphone-fill"></i> Pengumuman Terbaru</div><div class="body"></div></div>
    <div class="card" id="c-events"><div class="card-title"><i class="bi bi-calendar-event-fill"></i> Kalender Terdekat</div><div class="body"></div></div>
  </section>
  <section class="grid grid-2 mt">
    <div class="card" id="c-activity"><div class="card-title"><i class="bi bi-activity"></i> Aktivitas Terbaru</div><div class="body"></div></div>
    <div class="card" id="c-summary"><div class="card-title"><i class="bi bi-info-circle-fill"></i> Ringkasan Informasi Kelas</div><div class="body"></div></div>
  </section>
  <h3 class="mt" style="margin-bottom:12px">Fitur Pendukung</h3>
  <section class="extras">
    <div class="extra-card"><div class="big"><i class="bi bi-controller"></i></div><h4>Mode Game</h4><p>Main game sambil belajar!</p><button class="btn btn-primary btn-sm" id="x-game">Main Sekarang <i class="bi bi-arrow-right"></i></button></div>
    <div class="extra-card"><div class="big"><i class="bi bi-palette-fill"></i></div><h4>Drawing Board</h4><p>Tuangkan ide dan kreativitas!</p><button class="btn btn-primary btn-sm" id="x-draw">Mulai Menggambar <i class="bi bi-arrow-right"></i></button></div>
    <div class="extra-card"><div class="big"><i class="bi bi-music-note-beamed"></i></div><h4>Musik Instrumen</h4><p>Relaksasi dengan musik!</p><button class="btn btn-primary btn-sm" id="x-music">Putar Musik <i class="bi bi-arrow-right"></i></button></div>
  </section>`;

$('#x-game').addEventListener('click', openGameMenu);
$('#x-draw').addEventListener('click', openDrawing);
$('#x-music').addEventListener('click', () => openMusic(ctx));

const body = (id) => $(`#${id} .body`);
const hide = (id) => $('#' + id).classList.add('hidden');
const count = async (table, build = (q) => q) => {
  const { count: c, error } = await build(sb.from(table).select('*', { count: 'exact', head: true }));
  return error ? null : c;
};
const statCard = (icon, val, label, href) => `<a class="card stat-card" ${href ? `href="${href}"` : ''} style="color:inherit;text-decoration:none"><div class="ic"><i class="bi ${icon}"></i></div><div><div class="val">${val}</div><div class="lbl">${esc(label)}</div></div></a>`;

/* ---------- Statistik ---------- */
async function loadStats() {
  const cards = [];
  const nowIso = new Date().toISOString();
  const jobs = {
    students: count('students'),
    courses: can(role, 'courses', 'r') ? count('courses') : null,
    events: can(role, 'calendar', 'r') ? count('academic_events', (q) => q.gte('start_at', nowIso)) : null,
    attTotal: can(role, 'attendance', 'r') ? count('attendance_details') : null,
    attHadir: can(role, 'attendance', 'r') ? count('attendance_details', (q) => q.eq('status', 'hadir')) : null,
    summary: canSeeBalance(role) ? sb.from('v_finance_summary').select('*').maybeSingle() : null,
  };
  const r = {};
  for (const [k, v] of Object.entries(jobs)) r[k] = v ? await v : null;
  cards.push(statCard('bi-people-fill', r.students ?? '–', 'Anggota Kelas', can(role, 'memories', 'r') ? pageUrl('memories') : ''));
  if (r.courses !== null) cards.push(statCard('bi-journal-bookmark-fill', r.courses ?? '–', 'Mata Kuliah', pageUrl('courses')));
  if (r.attTotal !== null) {
    const pct = r.attTotal ? Math.round((r.attHadir / r.attTotal) * 100) : 0;
    cards.push(statCard('bi-person-check-fill', r.attTotal ? pct + '%' : '–', 'Kehadiran', pageUrl('attendance')));
  }
  if (r.events !== null) cards.push(statCard('bi-calendar-check-fill', r.events ?? '–', 'Agenda Mendatang', pageUrl('calendar')));
  if (r.summary) cards.push(statCard('bi-cash-coin', fmtRupiah(r.summary.data?.balance), 'Saldo Kas', pageUrl('finance')));
  $('#stats').innerHTML = cards.join('');
}

/* ---------- Jadwal hari ini ---------- */
async function loadSchedule() {
  if (!can(role, 'courses', 'r')) return hide('c-schedule');
  const js = new Date().getDay(); const dow = js === 0 ? 7 : js;
  const { data, error } = await sb.from('schedules').select('start_time,end_time,room,courses(name,code,room)').eq('day_of_week', dow).order('start_time');
  const head = `<div class="small muted mb">${DAYS[dow]}, ${fmtDate(new Date(), { day: '2-digit', month: 'long', year: 'numeric' })}</div>`;
  body('c-schedule').innerHTML = head + (error || !data?.length ? emptyHTML(error ? 'Tidak dapat memuat jadwal.' : 'Tidak ada perkuliahan hari ini.', 'bi-cup-hot')
    : data.map((s) => `<div class="schedule-item"><div class="time">${hhmm(s.start_time)} – ${hhmm(s.end_time)}</div><div><strong>${esc(s.courses?.name)}</strong><small>${esc(s.room || s.courses?.room || '-')}</small></div></div>`).join(''));
}

/* ---------- Pengumuman ---------- */
async function loadAnnouncements() {
  const { data, error } = await sb.from('announcements').select('id,title,created_at,pinned,profiles:created_by(full_name)').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(4);
  body('c-ann').innerHTML = error || !data?.length ? emptyHTML(error ? 'Tidak dapat memuat pengumuman.' : 'Belum ada pengumuman.', 'bi-megaphone')
    : data.map((a) => `<div class="ann-item"><i class="bi ${a.pinned ? 'bi-pin-angle-fill' : 'bi-megaphone'}" style="color:var(--orange);margin-top:3px"></i><div><strong>${esc(a.title)}</strong><small>Oleh ${esc(a.profiles?.full_name || '-')} · ${fmtDate(a.created_at)}</small></div></div>`).join('') +
      `<div class="mt"><a href="${pageUrl('communication')}" class="small">Lihat semua →</a></div>`;
}

/* ---------- Kalender terdekat ---------- */
async function loadEvents() {
  if (!can(role, 'calendar', 'r')) return hide('c-events');
  const { data, error } = await sb.from('academic_events').select('id,title,category,start_at,location').gte('start_at', new Date().toISOString()).order('start_at').limit(4);
  body('c-events').innerHTML = error || !data?.length ? emptyHTML(error ? 'Tidak dapat memuat agenda.' : 'Belum ada agenda mendatang.', 'bi-calendar-x')
    : data.map((e) => { const d = parseDate(e.start_at); return `<div class="event-item"><div class="event-date"><b>${d.getDate()}</b><span>${d.toLocaleDateString('id-ID', { month: 'short' })}</span></div><div><strong>${esc(e.title)}</strong><small>${fmtDateTime(e.start_at)}${e.location ? ' · ' + esc(e.location) : ''}</small></div></div>`; }).join('') +
      `<div class="mt"><a href="${pageUrl('calendar')}" class="small">Buka kalender →</a></div>`;
}

/* ---------- Aktivitas terbaru ---------- */
async function loadActivity() {
  const items = [];
  const jobs = [
    sb.from('announcements').select('title,created_at,profiles:created_by(full_name)').order('created_at', { ascending: false }).limit(3)
      .then(({ data }) => (data || []).forEach((a) => items.push({ t: a.created_at, icon: 'bi-megaphone', text: `Pengumuman: ${a.title}`, by: a.profiles?.full_name }))),
  ];
  if (can(role, 'library', 'r')) jobs.push(sb.from('documents').select('title,created_at,profiles:uploaded_by(full_name)').order('created_at', { ascending: false }).limit(3)
    .then(({ data }) => (data || []).forEach((d) => items.push({ t: d.created_at, icon: 'bi-file-earmark-arrow-up', text: `Materi baru: ${d.title}`, by: d.profiles?.full_name }))));
  if (can(role, 'attendance', 'r')) jobs.push(sb.from('attendance').select('meeting_date,created_at,courses(name)').order('created_at', { ascending: false }).limit(3)
    .then(({ data }) => (data || []).forEach((a) => items.push({ t: a.created_at, icon: 'bi-person-check', text: `Absensi ${a.courses?.name || ''} (${fmtDate(a.meeting_date)})` }))));
  if (can(role, 'finance', 'r')) jobs.push(sb.from('transactions').select('type,amount,description,created_at').order('created_at', { ascending: false }).limit(3)
    .then(({ data }) => (data || []).forEach((t) => items.push({ t: t.created_at, icon: 'bi-cash-stack', text: `${t.type === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran'} ${fmtRupiah(t.amount)}${t.description ? ' — ' + t.description : ''}` }))));
  await Promise.allSettled(jobs);
  items.sort((a, b) => new Date(b.t) - new Date(a.t));
  body('c-activity').innerHTML = items.length
    ? items.slice(0, 6).map((i) => `<div class="act-item"><i class="bi ${i.icon}" style="color:var(--terracotta);margin-top:3px"></i><div><strong>${esc(i.text)}</strong><small>${i.by ? esc(i.by) + ' · ' : ''}${fmtDateTime(i.t)}</small></div></div>`).join('')
    : emptyHTML('Belum ada aktivitas.', 'bi-activity');
}

/* ---------- Ringkasan ---------- */
function loadSummary() {
  body('c-summary').innerHTML = `<dl class="kv">
    <dt>Kelas</dt><dd>${APP.className}</dd>
    <dt>Institusi</dt><dd>${APP.institution}</dd>
    <dt>Fakultas</dt><dd>Fakultas Teknik</dd>
    <dt>Program Studi</dt><dd>Teknik Informatika</dd>
    <dt>Akun Anda</dt><dd>${esc(profile.full_name)} (${esc(ROLES[role])})</dd></dl>`;
}

['c-schedule', 'c-ann', 'c-events', 'c-activity'].forEach((id) => { const b = body(id); if (b) b.innerHTML = '<div class="loading-box"><span class="spinner"></span></div>'; });
loadSummary();
await Promise.allSettled([loadStats(), loadSchedule(), loadAnnouncements(), loadEvents(), loadActivity()]);
