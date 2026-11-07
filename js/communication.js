// communication.js — Ruang Komunikasi: ruang diskusi (Realtime), lampiran, pengumuman (CRUD).
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { can } from './permissions.js';
import { uploadFile, removeFiles, signedUrl, BUCKETS } from './storage.js';
import { $, $$, esc, ok, fail, toast, confirmDialog, formModal, openModal, loadingHTML, emptyHTML, errorHTML, tabsHTML, avatarHTML, fmtDateTime, fmtTime, fmtDate } from './utils.js';

const { ctx, content } = await initPage('communication');
const isKM = ctx.role === 'km';
const canAnn = can(ctx.role, 'announcements', 'c');
let tab = 'chat';
let rooms = [], room = null, channel = null, names = {};

function draw() {
  if (channel) { sb.removeChannel(channel); channel = null; }
  content.innerHTML = `<div class="page-header"><div><h1>Ruang Komunikasi</h1><p>Diskusi, berbagi informasi, dan tetap terhubung.</p></div></div>
    ${tabsHTML([{ id: 'chat', label: 'Ruang Diskusi', icon: 'bi-chat-dots' }, { id: 'ann', label: 'Pengumuman', icon: 'bi-megaphone' }], tab)}<div id="tab-body">${loadingHTML()}</div>`;
  $$('[data-tab]', content).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  (tab === 'chat' ? chat : announcements)();
}

/* ===================== CHAT ===================== */
async function chat() {
  const { data, error } = await sb.from('chat_rooms').select('*').order('created_at');
  const box = $('#tab-body');
  if (error) { box.innerHTML = errorHTML(error); return; }
  rooms = data;
  if (!rooms.length) { box.innerHTML = `<div class="card">${emptyHTML('Belum ada ruang diskusi yang dapat Anda akses.', 'bi-chat')}${isKM ? '<div class="center"><button class="btn btn-primary" id="new-room">Buat Ruang</button></div>' : ''}</div>`; $('#new-room')?.addEventListener('click', roomForm); return; }
  room = rooms.find((r) => r.id === room?.id) || rooms[0];
  box.innerHTML = `<div class="chat-layout"><aside class="chat-rooms">${rooms.map((r) => `<button class="room-item ${r.id === room.id ? 'active' : ''}" data-room="${r.id}"><span class="avatar sm"><i class="bi ${r.kind === 'pengurus' ? 'bi-people-fill' : 'bi-mortarboard-fill'}"></i></span><span style="min-width:0"><strong>${esc(r.name)}</strong><small>${r.kind === 'pengurus' ? 'Khusus pengurus' : 'Dosen & pengurus'}</small></span></button>`).join('')}${isKM ? '<button class="btn btn-secondary btn-sm btn-block mt" id="new-room"><i class="bi bi-plus-lg"></i> Ruang Baru</button>' : ''}</aside>
    <section class="chat-main"><div class="chat-head"><div><strong>${esc(room.name)}</strong><br><small class="muted">${esc(room.description || '')}</small></div>${isKM ? '<button class="btn btn-danger btn-sm" id="del-room"><i class="bi bi-trash"></i></button>' : ''}</div>
      <div class="chat-msgs" id="msgs">${loadingHTML()}</div>
      <form class="chat-compose" id="compose"><button type="button" class="btn btn-secondary btn-icon" id="attach" title="Lampirkan dokumen" aria-label="Lampirkan"><i class="bi bi-paperclip"></i></button><input type="file" id="file" class="hidden"><textarea class="textarea" id="text" rows="1" maxlength="4000" placeholder="Ketik pesan..."></textarea><button class="btn btn-primary btn-icon" aria-label="Kirim"><i class="bi bi-send-fill"></i></button></form></section></div>`;
  $$('[data-room]', box).forEach((b) => b.addEventListener('click', () => { room = rooms.find((r) => r.id === b.dataset.room); draw(); }));
  $('#new-room')?.addEventListener('click', roomForm);
  $('#del-room')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Hapus ruang "${room.name}" beserta seluruh pesannya?`))) return;
    const { error: e } = await sb.from('chat_rooms').delete().eq('id', room.id);
    if (e) fail(e); else { ok('Ruang dihapus.'); room = null; draw(); }
  });
  await loadMessages();
  wireCompose();
  channel = sb.channel('room-' + room.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${room.id}` }, () => loadMessages(true))
    .subscribe();
}

function roomForm() {
  formModal({ title: 'Ruang Baru', size: 'sm', fields: [{ name: 'name', label: 'Nama ruang', required: true, maxlength: 80, full: true }, { name: 'description', label: 'Deskripsi', maxlength: 200, full: true },
      { name: 'kind', label: 'Anggota ruang', type: 'select', full: true, options: [{ value: 'pengurus', label: 'Khusus pengurus (KM, Sekretaris, Bendahara)' }, { value: 'dosen_pengurus', label: 'Dosen & pengurus' }] }],
    onSubmit: async (v) => { const { error } = await sb.from('chat_rooms').insert({ name: v.name, description: v.description, kind: v.kind, created_by: ctx.user.id }); if (error) throw error; ok('Ruang dibuat.'); draw(); } });
}

let lastCount = -1;
async function loadMessages(live = false) {
  const { data, error } = await sb.from('chat_messages').select('*,profiles:sender_id(full_name,avatar_url)').eq('room_id', room.id).order('created_at').limit(300);
  const el = $('#msgs');
  if (!el) return;
  if (error) { el.innerHTML = errorHTML(error); return; }
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  el.innerHTML = data.length ? data.map((m) => {
    const me = m.sender_id === ctx.user.id;
    return `<div class="msg ${me ? 'me' : ''}">${avatarHTML(m.profiles?.full_name, m.profiles?.avatar_url, 'sm')}
      <div class="bubble">${me ? '' : `<span class="who">${esc(m.profiles?.full_name || 'Pengguna')}</span>`}${m.body ? esc(m.body) : ''}${m.attachment_path ? `<br><button class="att" data-att="${esc(m.attachment_path)}" data-name="${esc(m.attachment_name || 'lampiran')}"><i class="bi bi-paperclip"></i> ${esc(m.attachment_name || 'lampiran')}</button>` : ''}<span class="time">${fmtTime(m.created_at)} · ${fmtDate(m.created_at)}${m.edited_at ? ' · diubah' : ''}</span></div>
      ${(me || isKM) ? `<div class="msg-actions">${me && m.body ? `<button class="btn btn-ghost btn-icon btn-sm" data-edit="${m.id}" title="Ubah"><i class="bi bi-pencil"></i></button>` : ''}<button class="btn btn-ghost btn-icon btn-sm" data-del="${m.id}" title="Hapus"><i class="bi bi-trash"></i></button></div>` : ''}</div>`;
  }).join('') : emptyHTML('Belum ada pesan. Mulai percakapan!', 'bi-chat');
  if (!live || nearBottom || data.length !== lastCount) el.scrollTop = el.scrollHeight;
  lastCount = data.length;
  const byId = Object.fromEntries(data.map((m) => [m.id, m]));
  $$('[data-att]', el).forEach((b) => b.addEventListener('click', async () => { try { window.open(await signedUrl('chat', b.dataset.att, { download: b.dataset.name }), '_blank', 'noopener'); } catch (e) { fail(e); } }));
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Hapus pesan ini?'))) return;
    const m = byId[b.dataset.del];
    const { error: e } = await sb.from('chat_messages').delete().eq('id', m.id);
    if (e) return fail(e);
    if (m.attachment_path && isKM) await removeFiles('chat', m.attachment_path);
    loadMessages();
  }));
  $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => {
    const m = byId[b.dataset.edit];
    formModal({ title: 'Ubah Pesan', size: 'sm', values: { body: m.body }, fields: [{ name: 'body', label: 'Pesan', type: 'textarea', required: true, full: true, maxlength: 4000 }],
      onSubmit: async (v) => { const { error: e } = await sb.from('chat_messages').update({ body: v.body, edited_at: new Date().toISOString() }).eq('id', m.id); if (e) throw e; loadMessages(); } });
  }));
}

function wireCompose() {
  const text = $('#text'), fileEl = $('#file');
  let pending = null;
  const send = async () => {
    const body = text.value.trim();
    if (!body && !pending) return;
    const btn = $('#compose button:last-child'); btn.disabled = true;
    let up = null;
    try {
      if (pending) up = await uploadFile('chat', pending, room.id);
      const { error } = await sb.from('chat_messages').insert({ room_id: room.id, sender_id: ctx.user.id, body: body || null, attachment_path: up?.path || null, attachment_name: pending?.name || null });
      if (error) { if (up) await removeFiles('chat', up.path); throw error; }
      text.value = ''; pending = null; fileEl.value = ''; $('#attach').classList.remove('btn-primary'); text.placeholder = 'Ketik pesan...';
      loadMessages();
    } catch (e) { fail(e); } finally { btn.disabled = false; text.focus(); }
  };
  $('#compose').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('#attach').addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', () => {
    const f = fileEl.files[0]; if (!f) return;
    const msg = (BUCKETS.chat.exts.includes((f.name.split('.').pop() || '').toLowerCase()) && f.size <= BUCKETS.chat.maxMB * 1048576) ? null : `File tidak diizinkan atau lebih dari ${BUCKETS.chat.maxMB} MB.`;
    if (msg) { toast(msg, 'warn'); fileEl.value = ''; return; }
    pending = f; $('#attach').classList.add('btn-primary'); text.placeholder = `Lampiran: ${f.name} — tambahkan pesan (opsional)`;
  });
}

/* ===================== PENGUMUMAN ===================== */
async function announcements() {
  const box = $('#tab-body');
  const { data, error } = await sb.from('announcements').select('*,courses(name),profiles:created_by(full_name)').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100);
  if (error) { box.innerHTML = errorHTML(error); return; }
  const canU = can(ctx.role, 'announcements', 'u'), canD = can(ctx.role, 'announcements', 'd');
  box.innerHTML = `${canAnn ? '<div class="toolbar"><button class="btn btn-primary" id="new-ann"><i class="bi bi-plus-lg"></i> Buat Pengumuman</button></div>' : ''}
    ${data.length ? data.map((a) => `<div class="card mb"><div class="flex-between"><h3>${a.pinned ? '<i class="bi bi-pin-angle-fill" style="color:var(--orange)"></i> ' : ''}${esc(a.title)}</h3><div class="flex gap-sm">${canU ? `<button class="btn btn-ghost btn-icon" data-edit="${a.id}"><i class="bi bi-pencil"></i></button>` : ''}${canD ? `<button class="btn btn-danger btn-icon" data-del="${a.id}"><i class="bi bi-trash"></i></button>` : ''}</div></div>
      <small class="muted">${esc(a.profiles?.full_name || '-')} · ${fmtDateTime(a.created_at)}${a.courses?.name ? ' · ' + esc(a.courses.name) : ''}</small><p class="mt" style="white-space:pre-wrap">${esc(a.body)}</p></div>`).join('') : `<div class="card">${emptyHTML('Belum ada pengumuman.', 'bi-megaphone')}</div>`}`;
  const byId = Object.fromEntries(data.map((a) => [a.id, a]));
  $('#new-ann')?.addEventListener('click', () => annForm());
  $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => annForm(byId[b.dataset.edit])));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog(`Hapus pengumuman "${byId[b.dataset.del].title}"?`))) return;
    const { error: e } = await sb.from('announcements').delete().eq('id', b.dataset.del);
    if (e) fail(e); else { ok('Pengumuman dihapus.'); announcements(); }
  }));
}
function annForm(existing = null) {
  formModal({ title: existing ? 'Ubah Pengumuman' : 'Buat Pengumuman', size: 'lg', values: existing || {},
    fields: [{ name: 'title', label: 'Judul', required: true, maxlength: 200, full: true }, { name: 'body', label: 'Isi pengumuman', type: 'textarea', required: true, full: true },
      { name: 'pinned', label: 'Sematkan di bagian atas', type: 'checkbox', full: true }],
    onSubmit: async (v) => {
      const payload = { title: v.title, body: v.body, pinned: v.pinned };
      const { error } = existing ? await sb.from('announcements').update(payload).eq('id', existing.id) : await sb.from('announcements').insert({ ...payload, created_by: ctx.user.id });
      if (error) throw error; ok(existing ? 'Pengumuman diperbarui.' : 'Pengumuman dipublikasikan.'); announcements();
    } });
}

draw();
