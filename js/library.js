// library.js — Perpustakaan & arsip materi: upload file (Storage privat) dan link referensi, pencarian, filter, preview, unduh.
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { can } from './permissions.js';
import { uploadFile, removeFiles, signedUrl, BUCKETS, extOf } from './storage.js';
import { $, $$, esc, ok, fail, toast, confirmDialog, openModal, formModal, loadingHTML, emptyHTML, errorHTML, fmtDate, fmtBytes, debounce } from './utils.js';

const { ctx, content } = await initPage('library');
const canC = can(ctx.role, 'library', 'c'), canU = can(ctx.role, 'library', 'u'), canD = can(ctx.role, 'library', 'd');
const isDosen = ctx.role === 'dosen';
let courses = [];
const f = { q: '', course: '', kind: '' };
const ICON = { pdf: 'bi-file-earmark-pdf-fill', ppt: 'bi-file-earmark-slides-fill', pptx: 'bi-file-earmark-slides-fill', doc: 'bi-file-earmark-word-fill', docx: 'bi-file-earmark-word-fill', png: 'bi-file-earmark-image-fill', jpg: 'bi-file-earmark-image-fill', jpeg: 'bi-file-earmark-image-fill', webp: 'bi-file-earmark-image-fill' };

content.innerHTML = `<div class="page-header"><div><h1>Perpustakaan</h1><p>Arsip materi perkuliahan: PDF, PPT, DOC, gambar, dan tautan referensi.</p></div>
  <div class="flex">${canC ? '<button class="btn btn-primary" id="add-file"><i class="bi bi-cloud-arrow-up-fill"></i> Unggah Materi</button><button class="btn btn-secondary" id="add-link"><i class="bi bi-link-45deg"></i> Tambah Link</button>' : ''}</div></div>
  <div class="toolbar"><div class="input-icon grow"><i class="bi bi-search"></i><input class="input" id="q" placeholder="Cari judul materi..."></div>
    <select class="select" id="fc"></select><select class="select" id="fk"><option value="">Semua jenis</option><option value="file">File</option><option value="link">Link</option></select></div>
  <div id="list">${loadingHTML()}</div>`;

async function loadCourses() {
  const { data } = await sb.from('courses').select('id,name,code').order('name');
  courses = data || [];
  $('#fc').innerHTML = '<option value="">Semua mata kuliah</option>' + courses.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function load() {
  const box = $('#list'); box.innerHTML = loadingHTML();
  let q = sb.from('documents').select('*,courses(name,code),profiles:uploaded_by(full_name)').order('created_at', { ascending: false }).limit(500);
  if (f.course) q = q.eq('course_id', f.course);
  if (f.kind) q = q.eq('kind', f.kind);
  if (f.q) q = q.ilike('title', `%${f.q.replace(/[%_]/g, ' ')}%`);
  const { data, error } = await q;
  if (error) { box.innerHTML = errorHTML(error); return; }
  if (!data.length) { box.innerHTML = `<div class="card">${emptyHTML(isDosen ? 'Belum ada materi yang dibagikan untuk dosen.' : 'Belum ada materi. Unggah materi pertama Anda.', 'bi-collection')}</div>`; return; }
  box.innerHTML = `<div class="grid grid-3">${data.map((d) => {
    const ext = d.kind === 'file' ? extOf(d.file_name || d.file_path) : 'link';
    return `<div class="card"><div class="flex"><div class="stat-card" style="padding:0"><div class="ic"><i class="bi ${d.kind === 'link' ? 'bi-link-45deg' : ICON[ext] || 'bi-file-earmark-fill'}"></i></div></div>
      <div style="min-width:0;flex:1"><h4 style="overflow-wrap:anywhere">${esc(d.title)}</h4><small class="muted">${esc(d.courses?.name || 'Tanpa mata kuliah')}</small></div></div>
      ${d.description ? `<p class="small mt" style="color:var(--muted)">${esc(d.description)}</p>` : ''}
      <div class="small muted mt">Diunggah ${esc(d.profiles?.full_name || '-')} · ${fmtDate(d.created_at)}${d.file_size ? ' · ' + fmtBytes(d.file_size) : ''}</div>
      ${canU && d.kind === 'file' ? `<div class="mt"><span class="badge ${d.visible_to_lecturers ? 'ok' : 'warn'}">${d.visible_to_lecturers ? 'Terlihat dosen' : 'Disembunyikan dari dosen'}</span></div>` : ''}
      <div class="flex mt" style="flex-wrap:wrap">
        ${d.kind === 'link' ? `<a class="btn btn-primary btn-sm" href="${esc(d.link_url)}" target="_blank" rel="noopener noreferrer"><i class="bi bi-box-arrow-up-right"></i> Buka</a>`
          : `<button class="btn btn-primary btn-sm" data-prev="${d.id}"><i class="bi bi-eye"></i> Preview</button><button class="btn btn-secondary btn-sm" data-dl="${d.id}"><i class="bi bi-download"></i> Unduh</button>`}
        ${canU ? `<button class="btn btn-ghost btn-icon" data-edit="${d.id}" title="Ubah"><i class="bi bi-pencil"></i></button>` : ''}${canD ? `<button class="btn btn-danger btn-icon" data-del="${d.id}" title="Hapus"><i class="bi bi-trash"></i></button>` : ''}</div></div>`;
  }).join('')}</div>`;
  const byId = Object.fromEntries(data.map((d) => [d.id, d]));
  $$('[data-prev]', box).forEach((b) => b.addEventListener('click', () => preview(byId[b.dataset.prev])));
  $$('[data-dl]', box).forEach((b) => b.addEventListener('click', async () => {
    const d = byId[b.dataset.dl];
    try { const url = await signedUrl('documents', d.file_path, { download: d.file_name || true }); const a = document.createElement('a'); a.href = url; a.download = d.file_name || ''; document.body.appendChild(a); a.click(); a.remove(); }
    catch (e) { fail(e); }
  }));
  $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => (byId[b.dataset.edit].kind === 'link' ? linkForm(byId[b.dataset.edit]) : metaForm(byId[b.dataset.edit]))));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
    const d = byId[b.dataset.del];
    if (!(await confirmDialog(`Hapus "${d.title}"?${d.kind === 'file' ? ' File di penyimpanan juga akan dihapus.' : ''}`))) return;
    const { error: e } = await sb.from('documents').delete().eq('id', d.id);
    if (e) return fail(e);
    if (d.file_path) await removeFiles('documents', d.file_path);
    ok('Materi dihapus.'); load();
  }));
}

async function preview(d) {
  const ext = extOf(d.file_name || d.file_path);
  let url;
  try { url = await signedUrl('documents', d.file_path); } catch (e) { return fail(e); }
  let inner;
  if (ext === 'pdf') inner = `<iframe src="${url}" style="width:100%;height:72vh;border:0;border-radius:12px" title="Preview PDF"></iframe>`;
  else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) inner = `<img src="${url}" alt="${esc(d.title)}" style="max-height:72vh;margin:auto;border-radius:12px">`;
  else inner = `<div class="empty"><i class="bi ${ICON[ext] || 'bi-file-earmark'}"></i><p>Preview untuk file ${ext.toUpperCase()} tidak tersedia di browser.<br>Silakan unduh file untuk membukanya.</p></div>`;
  openModal({ title: d.title, size: 'lg', content: inner, footer: '<button class="btn btn-secondary" data-close>Tutup</button>' });
}

function courseSelect() { return { name: 'course_id', label: 'Mata kuliah', type: 'select', options: [{ value: '', label: '— Umum / tanpa mata kuliah —' }, ...courses.map((c) => ({ value: c.id, label: c.name }))] }; }

function uploadForm() {
  formModal({
    title: 'Unggah Materi', size: 'lg', values: { visible_to_lecturers: true },
    fields: [
      { name: 'title', label: 'Judul materi', required: true, maxlength: 200, full: true },
      courseSelect(),
      { name: 'file', label: 'File', type: 'file', required: true, accept: '.pdf,.ppt,.pptx,.doc,.docx,.png,.jpg,.jpeg,.webp', help: BUCKETS.documents.label },
      { name: 'description', label: 'Deskripsi', type: 'textarea', full: true, maxlength: 500 },
      { name: 'visible_to_lecturers', label: 'Izinkan dosen melihat materi ini', type: 'checkbox', full: true },
    ],
    onSubmit: async (v) => {
      const up = await uploadFile('documents', v.file, v.course_id || 'umum');
      const { error } = await sb.from('documents').insert({ title: v.title, kind: 'file', course_id: v.course_id || null, description: v.description, file_path: up.path, file_name: v.file.name, mime_type: v.file.type, file_size: v.file.size, visible_to_lecturers: v.visible_to_lecturers, uploaded_by: ctx.user.id });
      if (error) { await removeFiles('documents', up.path); throw error; }
      ok('Materi berhasil diunggah.'); load();
    },
  });
}
function metaForm(d) {
  formModal({
    title: 'Ubah Informasi Materi', values: d,
    fields: [{ name: 'title', label: 'Judul materi', required: true, maxlength: 200, full: true }, courseSelect(), { name: 'description', label: 'Deskripsi', type: 'textarea', full: true, maxlength: 500 },
      { name: 'visible_to_lecturers', label: 'Izinkan dosen melihat materi ini', type: 'checkbox', full: true }],
    onSubmit: async (v) => { const { error } = await sb.from('documents').update({ title: v.title, course_id: v.course_id || null, description: v.description, visible_to_lecturers: v.visible_to_lecturers }).eq('id', d.id); if (error) throw error; ok('Materi diperbarui.'); load(); },
  });
}
function linkForm(d = null) {
  formModal({
    title: d ? 'Ubah Link Referensi' : 'Tambah Link Referensi', values: d || { visible_to_lecturers: true },
    fields: [{ name: 'title', label: 'Judul', required: true, maxlength: 200, full: true },
      { name: 'link_url', label: 'URL (https://...)', type: 'url', required: true, full: true, pattern: '^https?://\\S+$', patternMsg: 'URL harus diawali http:// atau https://' }, courseSelect(),
      { name: 'description', label: 'Deskripsi', type: 'textarea', full: true, maxlength: 500 },
      { name: 'visible_to_lecturers', label: 'Izinkan dosen melihat link ini', type: 'checkbox', full: true }],
    onSubmit: async (v) => {
      const payload = { title: v.title, kind: 'link', link_url: v.link_url, course_id: v.course_id || null, description: v.description, visible_to_lecturers: v.visible_to_lecturers };
      const { error } = d ? await sb.from('documents').update(payload).eq('id', d.id) : await sb.from('documents').insert({ ...payload, uploaded_by: ctx.user.id });
      if (error) throw error; ok(d ? 'Link diperbarui.' : 'Link ditambahkan.'); load();
    },
  });
}

$('#add-file')?.addEventListener('click', uploadForm);
$('#add-link')?.addEventListener('click', () => linkForm());
$('#q').addEventListener('input', debounce(() => { f.q = $('#q').value.trim(); load(); }, 350));
$('#fc').addEventListener('change', () => { f.course = $('#fc').value; load(); });
$('#fk').addEventListener('change', () => { f.kind = $('#fk').value; load(); });
await loadCourses();
await load();
