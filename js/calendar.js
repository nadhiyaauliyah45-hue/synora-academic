// calendar.js — Kalender akademik: tampilan bulanan & mingguan, kategori berwarna, CRUD agenda, pengingat.
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { can, isUniWide } from './permissions.js';
import { $, $$, esc, ok, fail, toast, confirmDialog, openModal, formModal, loadingHTML, emptyHTML, errorHTML, fmtDateTime, fmtTime, toISODate, toLocalInput, parseDate, DAYS } from './utils.js';

const { ctx, content } = await initPage('calendar');
// Kalender berjenjang: kelas < prodi < fakultas < universitas. Agenda tingkat atas tampil ke bawah; tingkat bawah tidak bisa mengubahnya.
// Penegakan sebenarnya di database (RLS event_visible/event_writable); kode ini hanya menyesuaikan tampilan.
const LEVELS = { kelas: 'Kelas', prodi: 'Prodi', fakultas: 'Fakultas', universitas: 'Universitas' };
const LEVEL_ICON = { kelas: 'bi-people-fill', prodi: 'bi-diagram-3-fill', fakultas: 'bi-bank2', universitas: 'bi-building-fill' };
const unwrap = (r) => { if (r.error) throw r.error; return r.data || []; };
const [{ data: scope }, myClasses, myProgs, faculties, allClasses, allProgs] = await Promise.all([
  sb.rpc('my_scope'),
  sb.from('v_my_classes').select('*').then(unwrap),
  sb.from('v_my_programs').select('*').then(unwrap),
  sb.from('faculties').select('id,code,name').order('name').then(unwrap),
  sb.from('classes').select('id,name,program_id').order('name').then(unwrap),
  sb.from('study_programs').select('id,code,name,level,faculty_id').order('name').then(unwrap),
]);
const uni = isUniWide(ctx.role);
const myClassIds = new Set(myClasses.map((c) => c.id)), myProgIds = new Set(myProgs.map((p) => p.id));
const nameOf = (list, id) => list.find((x) => x.id === id)?.name || '';
const ofClass = (id) => nameOf(allClasses, id), ofProg = (id) => nameOf(allProgs, id), ofFac = (id) => nameOf(faculties, id);
const targetLabel = (ev) => ({ kelas: ofClass(ev.class_id), prodi: ofProg(ev.program_id), fakultas: ofFac(ev.faculty_id), universitas: 'Seluruh UMC' }[ev.level] || '');
// tingkat yang boleh ditulis oleh peran ini
const writableLevels = () => {
  if (uni) return ['kelas', 'prodi', 'fakultas', 'universitas'];
  if (['km', 'sekretaris'].includes(ctx.role)) return myClasses.length ? ['kelas'] : [];
  if (['kaprodi', 'admin_prodi'].includes(ctx.role)) return myProgs.length ? ['prodi'] : [];
  if (ctx.role === 'dekan') return scope?.faculty_id ? ['fakultas'] : [];
  return [];
};
const targetOptions = (level) => {
  if (level === 'kelas') return (uni ? allClasses : myClasses).map((c) => ({ value: c.id, label: c.name }));
  if (level === 'prodi') return (uni ? allProgs : myProgs).map((p) => ({ value: p.id, label: `${p.name} (${p.level})` }));
  if (level === 'fakultas') return (uni ? faculties : faculties.filter((f) => f.id === scope?.faculty_id)).map((f) => ({ value: f.id, label: f.name }));
  return [{ value: '-', label: 'Seluruh Universitas Muhammadiyah Cirebon' }];
};
const WL = writableLevels();
const canC = can(ctx.role, 'calendar', 'c') && WL.length > 0;
const canWriteEv = (ev) => uni || (ev.level === 'kelas' && ['km', 'sekretaris'].includes(ctx.role) && myClassIds.has(ev.class_id))
  || (ev.level === 'prodi' && ['kaprodi', 'admin_prodi'].includes(ctx.role) && myProgIds.has(ev.program_id))
  || (ev.level === 'fakultas' && ctx.role === 'dekan' && ev.faculty_id === scope?.faculty_id);
let levelFilter = '';
const CATS = { kuliah: 'Jadwal Kuliah', uts: 'UTS', uas: 'UAS', tugas: 'Deadline Tugas', presentasi: 'Presentasi', kelas: 'Kegiatan Kelas', kampus: 'Kegiatan Kampus', penting: 'Agenda Penting' };
const COLOR = { kuliah: '#5B8DEF', uts: '#C96645', uas: '#9A3B2A', tugas: '#E98532', presentasi: '#8B5FBF', kelas: '#3E8E5A', kampus: '#2A9CA8', penting: '#D6475F' };
let view = 'month';
let cursor = new Date(); cursor.setDate(1);
let weekAnchor = new Date();
let events = [], courses = [];
let selected = null;

content.innerHTML = `<div class="page-header"><div><h1>Kalender Akademik</h1><p>Jadwal kuliah, ujian, deadline, dan kegiatan.</p></div>${canC ? '<button class="btn btn-primary" id="add"><i class="bi bi-plus-lg"></i> Tambah Agenda</button>' : ''}</div>
  <div class="cal-layout"><div class="card"><div class="cal-head"><div class="flex"><button class="btn btn-secondary btn-icon" id="prev" aria-label="Sebelumnya"><i class="bi bi-chevron-left"></i></button><h3 id="title"></h3><button class="btn btn-secondary btn-icon" id="next" aria-label="Berikutnya"><i class="bi bi-chevron-right"></i></button><button class="btn btn-ghost btn-sm" id="today">Hari ini</button></div>
    <div class="tabs" style="margin:0"><button class="tab active" data-v="month">Bulanan</button><button class="tab" data-v="week">Mingguan</button></div></div>
    <div class="toolbar wrap" style="margin:.5rem 0"><span class="muted small">Tingkat agenda:</span><select class="select" id="lvl" style="max-width:220px"><option value="">Semua tingkat</option>${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <span class="muted small">Agenda tingkat atas tampil ke bawah.</span></div>
    <div id="cal">${loadingHTML()}</div><div class="legend">${Object.entries(CATS).map(([k, v]) => `<span><i style="background:${COLOR[k]}"></i>${v}</span>`).join('')}</div></div>
    <div class="card"><div class="card-title"><i class="bi bi-list-check"></i> <span id="agenda-title">Agenda Terdekat</span></div><div id="agenda"></div></div></div>`;

const rangeOf = () => {
  if (view === 'month') { const s = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - ((new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay() + 6) % 7)); const e = new Date(s); e.setDate(e.getDate() + 42); return [s, e]; }
  const s = new Date(weekAnchor); s.setHours(0, 0, 0, 0); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); const e = new Date(s); e.setDate(e.getDate() + 7); return [s, e];
};

async function load() {
  const [s, e] = rangeOf();
  const { data, error } = await sb.from('academic_events').select('*').lt('start_at', e.toISOString()).or(`end_at.gte.${s.toISOString()},end_at.is.null`).gte('start_at', new Date(s.getTime() - 86400000 * 31).toISOString()).order('start_at');
  if (error) { $('#cal').innerHTML = errorHTML(error); return; }
  events = (data || []).filter((ev) => { const st = new Date(ev.start_at), en = ev.end_at ? new Date(ev.end_at) : st; return en >= s && st < e && (!levelFilter || ev.level === levelFilter); });
  draw(); drawAgenda();
}

const onDay = (d) => events.filter((ev) => { const k = toISODate(d); const st = toISODate(ev.start_at); const en = toISODate(ev.end_at || ev.start_at); return k >= st && k <= en; });

function draw() {
  const today = toISODate(new Date());
  if (view === 'month') {
    $('#title').textContent = cursor.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    const [s] = rangeOf();
    const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return d; });
    $('#cal').innerHTML = `<div class="cal-grid">${['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((d) => `<div class="cal-dow">${d}</div>`).join('')}
      ${cells.map((d) => { const evs = onDay(d); return `<div class="cal-cell ${d.getMonth() !== cursor.getMonth() ? 'other' : ''} ${toISODate(d) === today ? 'today' : ''}" data-day="${toISODate(d)}"><span class="d">${d.getDate()}</span>
        ${evs.slice(0, 2).map((ev) => `<span class="ev-chip" style="background:${COLOR[ev.category]}" title="${esc(ev.title)}">${esc(ev.title)}</span>`).join('')}${evs.length > 2 ? `<div class="cal-more">+${evs.length - 2} lagi</div>` : ''}</div>`; }).join('')}</div>`;
    $$('.cal-cell', $('#cal')).forEach((c) => c.addEventListener('click', () => { selected = c.dataset.day; drawAgenda(); }));
  } else {
    const [s] = rangeOf(); const e = new Date(s); e.setDate(e.getDate() + 6);
    $('#title').textContent = `${s.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    $('#cal').innerHTML = `<div class="week-grid">${Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); const evs = onDay(d);
      return `<div class="week-col ${toISODate(d) === today ? 'today' : ''}"><h5>${DAYS[i + 1]}<br>${d.getDate()}</h5>${evs.map((ev) => `<div class="week-ev" style="background:${COLOR[ev.category]}" data-ev="${ev.id}"><b>${ev.all_day ? 'Seharian' : fmtTime(ev.start_at)}</b>${esc(ev.title)}</div>`).join('') || '<span class="muted small">–</span>'}</div>`; }).join('')}</div>`;
    $$('[data-ev]', $('#cal')).forEach((el) => el.addEventListener('click', () => showEvent(events.find((x) => x.id === el.dataset.ev))));
  }
}

async function drawAgenda() {
  const box = $('#agenda');
  let list, title;
  if (selected) { list = onDay(parseDate(selected)); title = parseDate(selected).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' }); }
  else {
    let aq = sb.from('academic_events').select('*').gte('start_at', new Date().toISOString()).order('start_at').limit(8);
    if (levelFilter) aq = aq.eq('level', levelFilter);
    const { data } = await aq;
    list = data || []; title = 'Agenda Terdekat';
  }
  $('#agenda-title').textContent = title;
  box.innerHTML = (selected ? `<button class="btn btn-ghost btn-sm mb" id="clear-sel"><i class="bi bi-x"></i> Tampilkan agenda terdekat</button>` : '') +
    (list.length ? list.map((ev) => `<div class="event-item" style="cursor:pointer" data-open="${ev.id}"><div class="event-date" style="background:${COLOR[ev.category]}22"><b>${parseDate(ev.start_at).getDate()}</b><span>${parseDate(ev.start_at).toLocaleDateString('id-ID', { month: 'short' })}</span></div><div><strong>${esc(ev.title)}</strong><small><span class="badge" style="background:${COLOR[ev.category]}22;color:${COLOR[ev.category]}">${CATS[ev.category]}</span> <span class="badge"><i class="bi ${LEVEL_ICON[ev.level]}"></i> ${LEVELS[ev.level]}</span> ${ev.all_day ? 'Seharian' : fmtTime(ev.start_at)}</small></div></div>`).join('')
      : emptyHTML('Tidak ada agenda.', 'bi-calendar-x')) + (canC && selected ? `<button class="btn btn-secondary btn-sm mt" id="add-day"><i class="bi bi-plus-lg"></i> Tambah di tanggal ini</button>` : '');
  const map = Object.fromEntries(list.map((x) => [x.id, x]));
  $$('[data-open]', box).forEach((el) => el.addEventListener('click', () => showEvent(map[el.dataset.open])));
  $('#clear-sel', box)?.addEventListener('click', () => { selected = null; drawAgenda(); });
  $('#add-day', box)?.addEventListener('click', () => form(null, selected));
}

function showEvent(ev) {
  if (!ev) return;
  const m = openModal({ title: ev.title, size: 'sm',
    content: `<span class="badge" style="background:${COLOR[ev.category]}22;color:${COLOR[ev.category]}">${CATS[ev.category]}</span><dl class="kv mt"><dt>Tingkat</dt><dd><i class="bi ${LEVEL_ICON[ev.level]}"></i> ${LEVELS[ev.level]} — ${esc(targetLabel(ev))}</dd><dt>Mulai</dt><dd>${ev.all_day ? new Date(ev.start_at).toLocaleDateString('id-ID', { dateStyle: 'long' }) : fmtDateTime(ev.start_at)}</dd>${ev.end_at ? `<dt>Selesai</dt><dd>${ev.all_day ? new Date(ev.end_at).toLocaleDateString('id-ID', { dateStyle: 'long' }) : fmtDateTime(ev.end_at)}</dd>` : ''}<dt>Lokasi</dt><dd>${esc(ev.location || '-')}</dd><dt>Pengingat</dt><dd>${ev.remind_minutes != null ? ev.remind_minutes + ' menit sebelumnya' : 'Tidak ada'}</dd></dl><p class="mt" style="white-space:pre-wrap">${esc(ev.description || '')}</p>`,
    footer: `${canWriteEv(ev) ? '<button class="btn btn-danger" id="e-del"><i class="bi bi-trash"></i> Hapus</button>' : ''}${canWriteEv(ev) ? '<button class="btn btn-primary" id="e-edit"><i class="bi bi-pencil"></i> Ubah</button>' : ''}<button class="btn btn-secondary" data-close>Tutup</button>` });
  $('#e-edit', m.root)?.addEventListener('click', () => { m.close(); form(ev); });
  $('#e-del', m.root)?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Hapus agenda "${ev.title}"?`))) return;
    const { error } = await sb.from('academic_events').delete().eq('id', ev.id);
    if (error) fail(error); else { ok('Agenda dihapus.'); m.close(); load(); }
  });
}

function form(existing = null, day = null) {
  const base = existing ? { ...existing, start_at: toLocalInput(existing.start_at), end_at: existing.end_at ? toLocalInput(existing.end_at) : '' } : { category: 'kelas', start_at: `${day || toISODate(new Date())}T08:00`, remind_minutes: 60 };
  const lvl0 = WL[0];
  const levelFields = existing ? [] : [
    { name: 'level', label: 'Tingkat agenda', type: 'select', required: true, options: WL.map((k) => ({ value: k, label: LEVELS[k] })),
      help: uni ? 'Kelas: satu kelas · Prodi · Fakultas · Universitas: seluruh UMC.' : 'Tingkat ditentukan oleh peran Anda.' },
    { name: 'target', label: 'Ditujukan ke', type: 'select', required: true, options: targetOptions(lvl0) },
  ];
  formModal({
    title: existing ? 'Ubah Agenda' : 'Tambah Agenda', size: 'lg', values: base,
    afterRender: (form) => {
      const lv = form.elements.level, tg = form.elements.target; if (!lv || !tg) return;
      lv.addEventListener('change', () => { tg.innerHTML = targetOptions(lv.value).map((o) => `<option value="${o.value}">${o.label}</option>`).join(''); });
    },
    fields: [
      ...levelFields,
      { name: 'title', label: 'Judul agenda', required: true, maxlength: 200, full: true },
      { name: 'category', label: 'Kategori', type: 'select', options: Object.entries(CATS).map(([v, l]) => ({ value: v, label: l })) },
      { name: 'course_id', label: 'Mata kuliah (opsional)', type: 'select', options: [{ value: '', label: '—' }, ...courses.map((c) => ({ value: c.id, label: c.name }))] },
      { name: 'start_at', label: 'Mulai', type: 'datetime-local', required: true },
      { name: 'end_at', label: 'Selesai (opsional)', type: 'datetime-local', validate: (v, f) => (v && f.elements.start_at.value && v < f.elements.start_at.value ? 'Waktu selesai harus setelah waktu mulai.' : '') },
      { name: 'location', label: 'Lokasi', maxlength: 120 },
      { name: 'remind_minutes', label: 'Pengingat (menit sebelum)', type: 'number', min: 0, step: 5, help: 'Kosongkan bila tidak perlu pengingat.' },
      { name: 'all_day', label: 'Agenda seharian', type: 'checkbox', full: true },
      { name: 'description', label: 'Deskripsi', type: 'textarea', full: true },
    ],
    onSubmit: async (v) => {
      const payload = { title: v.title, category: v.category, course_id: v.course_id || null, start_at: new Date(v.start_at).toISOString(), end_at: v.end_at ? new Date(v.end_at).toISOString() : null, location: v.location, remind_minutes: v.remind_minutes, all_day: v.all_day, description: v.description };
      let ins = null;
      if (!existing) {
        const level = v.level, t = v.target;
        ins = { level, class_id: level === 'kelas' ? t : null, program_id: level === 'prodi' ? t : null, faculty_id: level === 'fakultas' ? t : null, created_by: ctx.user.id };
      }
      const { error } = existing ? await sb.from('academic_events').update(payload).eq('id', existing.id) : await sb.from('academic_events').insert({ ...payload, ...ins });
      if (error) throw error;
      ok(existing ? 'Agenda diperbarui.' : 'Agenda ditambahkan.'); load();
    },
  });
}

$('#prev').addEventListener('click', () => { if (view === 'month') cursor.setMonth(cursor.getMonth() - 1); else weekAnchor.setDate(weekAnchor.getDate() - 7); load(); });
$('#next').addEventListener('click', () => { if (view === 'month') cursor.setMonth(cursor.getMonth() + 1); else weekAnchor.setDate(weekAnchor.getDate() + 7); load(); });
$('#today').addEventListener('click', () => { cursor = new Date(); cursor.setDate(1); weekAnchor = new Date(); selected = null; load(); });
$$('[data-v]', content).forEach((b) => b.addEventListener('click', () => { view = b.dataset.v; $$('[data-v]', content).forEach((x) => x.classList.toggle('active', x === b)); load(); }));
$('#add')?.addEventListener('click', () => form());
$('#lvl').addEventListener('change', (e) => { levelFilter = e.target.value; load(); });

const { data: cs } = await sb.from('courses').select('id,name').order('name');
courses = cs || [];
await load();
