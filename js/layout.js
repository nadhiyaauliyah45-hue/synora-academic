// layout.js — kerangka aplikasi yang SAMA di semua halaman: sidebar, header, notifikasi, pencarian,
// proteksi halaman, background global, tema, dan pengingat agenda.
import { sb, isConfigured } from './supabase.js';
import { requireAuth, logout } from './auth.js';
import { menuFor, can, ROLES, moduleOfPage, isStudentRole } from './permissions.js';
import { applyCachedBackground, loadBackground, subscribeBackground } from './background.js';
import { pageUrl, ROOT } from './loader.js';
import { $, $$, esc, avatarHTML, debounce, toast, fmtDateTime, fmtDate } from './utils.js';

export function applyTheme() {
  let t = 'light';
  try { t = localStorage.getItem('synora_theme') || 'light'; } catch { /* abaikan */ }
  document.documentElement.setAttribute('data-theme', t);
}
export function setTheme(t) {
  try { localStorage.setItem('synora_theme', t); } catch { /* abaikan */ }
  applyTheme();
  loadBackground();
}

function configMissing() {
  document.body.innerHTML = `<div style="max-width:560px;margin:12vh auto;padding:0 20px">
    <div class="setup-banner"><b>Supabase belum dikonfigurasi.</b><br>
    Isi <code>SUPABASE_URL</code> dan <code>SUPABASE_ANON_KEY</code> di <code>js/config.js</code>, lalu muat ulang halaman.
    Lihat README.md untuk langkah lengkap.</div></div>`;
}

/**
 * Inisialisasi halaman terproteksi.
 * @param {string} page id halaman (mis. 'attendance'); menentukan menu aktif dan izin akses.
 * @returns {{ctx, content: HTMLElement}} ctx = {user, profile, role}
 */
export async function initPage(page) {
  applyTheme();
  applyCachedBackground();
  if (!isConfigured) { configMissing(); return new Promise(() => {}); }

  const ctx = await requireAuth();
  const module = moduleOfPage(page);
  if (!can(ctx.role, module, 'r')) {
    sessionStorage.setItem('synora_flash', 'Anda tidak memiliki akses ke halaman tersebut.');
    location.replace(pageUrl('dashboard'));
    return new Promise(() => {});
  }

  renderShell(ctx, page);
  loadBackground();
  subscribeBackground();
  setupNotifications(ctx);
  setupSearch(ctx);
  checkReminders(ctx);

  const flash = sessionStorage.getItem('synora_flash');
  if (flash) { sessionStorage.removeItem('synora_flash'); toast(flash, 'warn'); }
  return { ctx, content: $('#content') };
}

function renderShell(ctx, page) {
  const { profile, role } = ctx;
  const items = menuFor(role);
  const activeId = page === 'inventory' ? 'finance' : page;
  const nav = items.map((m) => `<a class="nav-item ${m.id === activeId ? 'active' : ''}" href="${pageUrl(m.id)}"><i class="bi ${m.icon}"></i><span>${esc(m.label)}</span></a>`).join('');

  $('#app').innerHTML = `
    <div class="sidebar-backdrop" id="sb-backdrop"></div>
    <aside class="sidebar" id="sidebar">
      <div class="sb-brand">
        <img src="${ROOT}assets/logo/synora-logo.svg" alt="SYNORA">
        <div><strong>SYNORA</strong><small>One Class, One Connected Space</small></div>
      </div>
      <nav class="sb-nav" aria-label="Navigasi utama">${nav}</nav>
      <div class="sb-user">
        ${avatarHTML(profile.full_name, profile.avatar_url, 'sm')}
        <div class="who"><strong>${esc(profile.full_name)}</strong><small>${esc(ROLES[role])}</small></div>
        <button id="btn-logout" title="Keluar" aria-label="Keluar"><i class="bi bi-box-arrow-right"></i></button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn only-mobile" id="btn-menu" aria-label="Menu"><i class="bi bi-list"></i></button>
        <div class="search">
          <i class="bi bi-search"></i>
          <input id="global-search" type="search" placeholder="Cari fitur, materi, atau informasi..." autocomplete="off">
          <div id="search-results" class="search-results hidden"></div>
        </div>
        <div class="topbar-right">
          <div class="dropdown">
            <button class="icon-btn" id="btn-notif" aria-label="Notifikasi"><i class="bi bi-bell-fill"></i><span class="dot hidden" id="notif-count">0</span></button>
            <div class="dropdown-menu hidden" id="notif-menu">
              <header><span>Notifikasi</span><button class="btn btn-ghost btn-sm" id="notif-readall">Tandai semua dibaca</button></header>
              <div class="list" id="notif-list"></div>
            </div>
          </div>
          <a class="profile-chip" href="${pageUrl('settings')}" style="color:inherit;text-decoration:none">
            ${avatarHTML(profile.full_name, profile.avatar_url)}
            <div class="who"><strong>${esc(profile.full_name)}</strong><small>${esc(ROLES[role])}</small></div>
          </a>
        </div>
      </header>
      <main id="content" class="content"></main>
    </div>`;

  // Portal mahasiswa: navigasi bawah (mobile-first)
  if (isStudentRole(role)) {
    const bn = items.slice(0, 5);
    const el = document.createElement('nav');
    el.className = 'bottom-nav'; el.setAttribute('aria-label', 'Navigasi bawah');
    el.innerHTML = bn.map((m) => `<a href="${pageUrl(m.id)}" class="${m.id === activeId ? 'active' : ''}"><i class="bi ${m.icon}"></i><span>${esc(m.label.replace('Portal Saya', 'Beranda').replace('Praktikum & Lab', 'Praktikum'))}</span></a>`).join('');
    $('#app').appendChild(el);
    document.body.classList.add('has-bottom-nav');
  }

  const sidebar = $('#sidebar'), backdrop = $('#sb-backdrop');
  const toggle = (open) => { sidebar.classList.toggle('open', open); backdrop.classList.toggle('show', open); };
  $('#btn-menu').addEventListener('click', () => toggle(!sidebar.classList.contains('open')));
  backdrop.addEventListener('click', () => toggle(false));
  $$('.nav-item', sidebar).forEach((a) => a.addEventListener('click', () => toggle(false)));
  $('#btn-logout').addEventListener('click', logout);
}

/* ---------- Notifikasi ---------- */
async function setupNotifications(ctx) {
  const menu = $('#notif-menu'), list = $('#notif-list'), badge = $('#notif-count');
  $('#btn-notif').addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.classList.add('hidden'); });

  async function refresh() {
    const { data, error } = await sb.from('notifications').select('*').eq('user_id', ctx.user.id).order('created_at', { ascending: false }).limit(20);
    if (error) { list.innerHTML = '<div class="empty small">Tidak dapat memuat notifikasi.</div>'; return; }
    const unread = data.filter((n) => !n.is_read).length;
    badge.textContent = unread > 9 ? '9+' : unread;
    badge.classList.toggle('hidden', unread === 0);
    list.innerHTML = data.length
      ? data.map((n) => `<button class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-link="${esc(n.link || '')}"><strong>${esc(n.title)}</strong><span>${esc(n.body || '')}</span><small>${fmtDateTime(n.created_at)}</small></button>`).join('')
      : '<div class="empty small" style="padding:24px"><i class="bi bi-bell-slash"></i>Belum ada notifikasi.</div>';
    $$('.notif-item', list).forEach((b) => b.addEventListener('click', async () => {
      await sb.from('notifications').update({ is_read: true }).eq('id', b.dataset.id);
      if (b.dataset.link) location.href = pageUrl(b.dataset.link); else refresh();
    }));
  }
  $('#notif-readall').addEventListener('click', async () => {
    await sb.from('notifications').update({ is_read: true }).eq('user_id', ctx.user.id).eq('is_read', false);
    refresh();
  });
  await refresh();
  try {
    sb.channel('notif-' + ctx.user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${ctx.user.id}` }, (p) => {
        toast(`${p.new.title}: ${p.new.body || ''}`, 'info', 5000);
        refresh();
      }).subscribe();
  } catch { /* realtime opsional */ }
}

/* ---------- Pencarian global ---------- */
function setupSearch(ctx) {
  const input = $('#global-search'), box = $('#search-results');
  const menu = menuFor(ctx.role);
  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { box.classList.add('hidden'); return; }
    const like = `%${q.replace(/[%_,()]/g, ' ')}%`;
    const groups = [];
    const fit = menu.filter((m) => m.label.toLowerCase().includes(q.toLowerCase()));
    if (fit.length) groups.push(['Fitur', fit.map((m) => ({ href: pageUrl(m.id), icon: m.icon, text: m.label }))]);
    const jobs = [];
    if (can(ctx.role, 'courses', 'r')) jobs.push(sb.from('courses').select('name,code').or(`name.ilike.${like},code.ilike.${like}`).limit(5).then(({ data }) => data?.length && groups.push(['Mata Kuliah', data.map((c) => ({ href: pageUrl('courses'), icon: 'bi-journal-bookmark', text: `${c.name} (${c.code})` }))])));
    if (can(ctx.role, 'library', 'r')) jobs.push(sb.from('documents').select('title').ilike('title', like).limit(5).then(({ data }) => data?.length && groups.push(['Materi', data.map((d) => ({ href: pageUrl('library'), icon: 'bi-file-earmark-text', text: d.title }))])));
    if (can(ctx.role, 'memories', 'r')) jobs.push(sb.from('students').select('full_name,nim').or(`full_name.ilike.${like},nim.ilike.${like}`).limit(5).then(({ data }) => data?.length && groups.push(['Anggota', data.map((s) => ({ href: pageUrl('memories') + '?q=' + encodeURIComponent(s.nim), icon: 'bi-person', text: `${s.full_name} · ${s.nim}` }))])));
    await Promise.allSettled(jobs);
    box.innerHTML = groups.length
      ? groups.map(([g, rows]) => `<div class="sr-group">${g}</div>${rows.map((r) => `<a href="${r.href}"><i class="bi ${r.icon}"></i><span>${esc(r.text)}</span></a>`).join('')}`).join('')
      : '<div class="empty small" style="padding:18px">Tidak ada hasil.</div>';
    box.classList.remove('hidden');
  }, 280);
  input.addEventListener('input', run);
  document.addEventListener('click', (e) => { if (!box.contains(e.target) && e.target !== input) box.classList.add('hidden'); });
}

/* ---------- Pengingat agenda (sekali per sesi per agenda) ---------- */
async function checkReminders(ctx) {
  if (!can(ctx.role, 'calendar', 'r')) return;
  const now = new Date();
  const until = new Date(now.getTime() + 48 * 3600 * 1000);
  const { data } = await sb.from('academic_events').select('id,title,start_at,remind_minutes')
    .not('remind_minutes', 'is', null).gte('start_at', now.toISOString()).lte('start_at', until.toISOString());
  let seen = [];
  try { seen = JSON.parse(sessionStorage.getItem('synora_reminded') || '[]'); } catch { /* abaikan */ }
  for (const ev of data || []) {
    const remindAt = new Date(new Date(ev.start_at).getTime() - ev.remind_minutes * 60000);
    if (remindAt <= now && !seen.includes(ev.id)) {
      toast(`Pengingat: ${ev.title} — ${fmtDateTime(ev.start_at)}`, 'warn', 8000);
      seen.push(ev.id);
    }
  }
  sessionStorage.setItem('synora_reminded', JSON.stringify(seen));
}

export { fmtDate };
