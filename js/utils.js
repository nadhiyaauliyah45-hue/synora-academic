// utils.js — helper UI & format yang dipakai semua modul.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const debounce = (fn, ms = 300) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/* ---------- Tanggal & angka ---------- */
export function parseDate(d) {
  if (d instanceof Date) return d;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) { const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day); }
  return new Date(d);
}
export const toISODate = (d) => {
  const x = parseDate(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const toLocalInput = (d) => {
  const x = parseDate(d);
  return `${toISODate(x)}T${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
};
export const fmtDate = (d, opts = { day: '2-digit', month: 'short', year: 'numeric' }) =>
  d ? parseDate(d).toLocaleDateString('id-ID', opts) : '-';
export const fmtDateTime = (d) =>
  d ? parseDate(d).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
export const fmtTime = (d) => parseDate(d).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
export const fmtRupiah = (n) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(n) || 0);
export const fmtBytes = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
export const DAYS = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
export const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
export const initials = (name) =>
  String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');

export function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
}

export function avatarHTML(name, url, cls = '') {
  return `<span class="avatar ${cls}">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : esc(initials(name))}</span>`;
}

/* ---------- Pesan error ramah ---------- */
export function errMsg(error) {
  if (!error) return 'Terjadi kesalahan.';
  const code = error.code || '';
  const msg = error.message || String(error);
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'Anda tidak memiliki izin untuk operasi ini.';
  if (code === '23505') return 'Data sudah ada (duplikat). Periksa nilai yang harus unik.';
  if (code === '23503') return 'Data masih terhubung dengan data lain, atau referensi tidak ditemukan.';
  if (code === '23514') return 'Nilai tidak memenuhi aturan validasi database.';
  if (code === '23502') return 'Ada kolom wajib yang belum diisi.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Tidak dapat terhubung ke server. Periksa koneksi internet.';
  return msg;
}

/* ---------- Toast ---------- */
export function toast(message, type = 'info', ms = 3800) {
  let box = $('.toast-container');
  if (!box) { box = document.createElement('div'); box.className = 'toast-container'; document.body.appendChild(box); }
  const icon = { success: 'bi-check-circle-fill', error: 'bi-x-circle-fill', warn: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' }[type] || 'bi-info-circle-fill';
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="bi ${icon}"></i><div>${esc(message)}</div>`;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 260); }, ms);
}
export const ok = (m) => toast(m, 'success');
export const fail = (e) => toast(typeof e === 'string' ? e : errMsg(e), 'error', 5500);

/* ---------- Modal ---------- */
export function openModal({ title, content = '', footer = '', size = '', onClose } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="btn btn-ghost btn-icon" data-close aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div>
      <div class="modal-body"></div>
      ${footer === null ? '' : '<div class="modal-foot"></div>'}
    </div>`;
  const body = $('.modal-body', backdrop);
  if (typeof content === 'string') body.innerHTML = content; else body.appendChild(content);
  const foot = $('.modal-foot', backdrop);
  if (foot) { if (typeof footer === 'string') foot.innerHTML = footer; else if (footer) foot.appendChild(footer); }
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  $$('[data-close]', backdrop).forEach((b) => b.addEventListener('click', close));
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  return { root: backdrop, body, foot, close };
}

export function confirmDialog(message, { title = 'Konfirmasi', okText = 'Ya, lanjutkan', danger = true } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      title, size: 'sm',
      content: `<p>${esc(message)}</p>`,
      footer: `<button class="btn btn-secondary" data-no>Batal</button><button class="btn ${danger ? 'btn-danger solid' : 'btn-primary'}" data-yes>${esc(okText)}</button>`,
      onClose: () => resolve(false),
    });
    $('[data-no]', m.root).addEventListener('click', () => { resolve(false); m.close(); });
    $('[data-yes]', m.root).addEventListener('click', () => { resolve(true); m.close(); });
  });
}

/* ---------- Form builder dengan validasi ----------
   fields: [{name,label,type,required,options,placeholder,help,full,min,max,step,accept,maxlength,value,hidden,pattern,validate}] */
export function formModal({ title, fields, values = {}, submitLabel = 'Simpan', size = '', onSubmit, extraHTML = '', afterRender }) {
  const form = document.createElement('form');
  form.noValidate = true;
  form.innerHTML = `<div class="form-grid">${fields.filter((f) => !f.hidden).map((f) => fieldHTML(f, values[f.name])).join('')}</div>${extraHTML}`;
  const m = openModal({
    title, size, content: form,
    footer: `<button type="button" class="btn btn-secondary" data-close>Batal</button><button type="submit" class="btn btn-primary" data-submit>${esc(submitLabel)}</button>`,
  });
  $$('[data-close]', m.root).forEach((b) => b.addEventListener('click', m.close));
  const submitBtn = $('[data-submit]', m.root);
  submitBtn.addEventListener('click', () => form.requestSubmit());
  afterRender?.(form, m);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { valid, data } = collect(form, fields);
    if (!valid) { toast('Periksa kembali isian yang ditandai.', 'warn'); return; }
    submitBtn.disabled = true;
    const old = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span> Menyimpan...';
    try {
      await onSubmit(data, m);
      m.close();
    } catch (err) {
      fail(err);
      submitBtn.disabled = false; submitBtn.innerHTML = old;
    }
  });
  const first = $('input:not([type=hidden]),select,textarea', form);
  first?.focus();
  return m;
}

function fieldHTML(f, val) {
  const id = 'f_' + f.name;
  const v = val ?? f.value ?? '';
  const req = f.required ? '<span class="req">*</span>' : '';
  let ctl;
  if (f.type === 'textarea') ctl = `<textarea class="textarea" id="${id}" name="${f.name}" maxlength="${f.maxlength || 4000}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
  else if (f.type === 'select')
    ctl = `<select class="select" id="${id}" name="${f.name}">${(f.options || []).map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  else if (f.type === 'checkbox')
    return `<div class="form-group ${f.full ? 'full' : ''}"><label class="check"><input type="checkbox" id="${id}" name="${f.name}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>${f.help ? `<span class="help">${esc(f.help)}</span>` : ''}</div>`;
  else if (f.type === 'file')
    ctl = `<input class="input" type="file" id="${id}" name="${f.name}" accept="${esc(f.accept || '')}">`;
  else
    ctl = `<input class="input" type="${f.type || 'text'}" id="${id}" name="${f.name}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''}>`;
  return `<div class="form-group ${f.full ? 'full' : ''}"><label for="${id}">${esc(f.label)} ${req}</label>${ctl}${f.help ? `<span class="help">${esc(f.help)}</span>` : ''}<span class="err" data-err="${f.name}"></span></div>`;
}

function collect(form, fields) {
  const data = {};
  let valid = true;
  for (const f of fields) {
    if (f.hidden) { data[f.name] = f.value; continue; }
    const el = form.elements[f.name];
    if (!el) continue;
    const errEl = $(`[data-err="${f.name}"]`, form);
    let value;
    if (f.type === 'checkbox') value = el.checked;
    else if (f.type === 'file') value = el.files[0] || null;
    else if (f.type === 'number') value = el.value === '' ? null : Number(el.value);
    else value = typeof el.value === 'string' ? el.value.trim() : el.value;
    let msg = '';
    if (f.required && (value === '' || value === null || value === undefined)) msg = `${f.label} wajib diisi.`;
    else if (value !== '' && value !== null && f.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) msg = 'Format email tidak valid.';
    else if (value !== null && f.type === 'number' && ((f.min !== undefined && value < f.min) || (f.max !== undefined && value > f.max))) msg = `Nilai harus ${f.min !== undefined ? '≥ ' + f.min : ''} ${f.max !== undefined ? '≤ ' + f.max : ''}.`;
    else if (f.pattern && value && !new RegExp(f.pattern).test(value)) msg = f.patternMsg || 'Format tidak valid.';
    else if (f.validate) msg = f.validate(value, form) || '';
    if (errEl) errEl.textContent = msg;
    el.classList?.toggle('invalid', !!msg);
    if (msg) valid = false;
    data[f.name] = value === '' ? (f.type === 'select' ? '' : null) : value;
  }
  return { valid, data };
}

/* ---------- State tampilan ---------- */
export const loadingHTML = (msg = 'Memuat data...') => `<div class="loading-box"><div class="boot-loading"><span class="spinner"></span><span>${esc(msg)}</span></div></div>`;
export const emptyHTML = (msg = 'Belum ada data.', icon = 'bi-inbox') => `<div class="empty"><i class="bi ${icon}"></i><div>${esc(msg)}</div></div>`;
export const errorHTML = (e) => `<div class="empty"><i class="bi bi-exclamation-triangle"></i><div>${esc(errMsg(e))}</div></div>`;

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const okc = document.execCommand('copy'); ta.remove(); return okc;
  }
}

export function tabsHTML(tabs, active) {
  return `<div class="tabs">${tabs.map((t) => (t.href
    ? `<a class="tab ${t.id === active ? 'active' : ''}" href="${t.href}">${t.icon ? `<i class="bi ${t.icon}"></i> ` : ''}${esc(t.label)}</a>`
    : `<button class="tab ${t.id === active ? 'active' : ''}" data-tab="${t.id}">${t.icon ? `<i class="bi ${t.icon}"></i> ` : ''}${esc(t.label)}</button>`)).join('')}</div>`;
}
