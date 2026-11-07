// background.js — Background global SYNORA.
// Satu konfigurasi di database (app_settings.key = 'background'), gambar di Supabase Storage (bucket 'backgrounds').
// Semua halaman memakai CSS Custom Property --app-bg-image sehingga cukup mengganti SATU gambar.
// localStorage hanya dipakai sebagai CACHE untuk mencegah kedipan; sumber kebenaran tetap database.
import { sb } from './supabase.js';
import { uploadFile, removeFiles, validateFile, publicUrl } from './storage.js';

const CACHE_KEY = 'synora_bg_cache';
const DEFAULT_OVERLAY = 0.8;

export function applyBackground({ url, overlay } = {}) {
  const root = document.documentElement;
  if (url) root.style.setProperty('--app-bg-image', `url("${String(url).replace(/"/g, '%22')}")`);
  else root.style.removeProperty('--app-bg-image');
  const o = Number.isFinite(Number(overlay)) ? Math.min(0.95, Math.max(0.3, Number(overlay))) : DEFAULT_OVERLAY;
  const dark = root.getAttribute('data-theme') === 'dark';
  root.style.setProperty('--app-bg-overlay', dark ? `rgba(34,22,17,${Math.max(o, 0.6)})` : `rgba(255,249,240,${o})`);
}

export function applyCachedBackground() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c) applyBackground(c);
  } catch { /* abaikan */ }
}

function cache(v) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch { /* abaikan */ } }

export async function getBackgroundSetting() {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'background').maybeSingle();
  const v = data?.value || {};
  return { url: v.url || null, path: v.path || null, overlay: v.overlay ?? DEFAULT_OVERLAY };
}

export async function loadBackground() {
  try {
    const v = await getBackgroundSetting();
    applyBackground(v);
    cache({ url: v.url, overlay: v.overlay });
    return v;
  } catch { return null; }
}

async function saveSetting(value, userId) {
  const { error } = await sb.from('app_settings').upsert({ key: 'background', value, updated_by: userId }, { onConflict: 'key' });
  if (error) throw error;
}

/** Unggah gambar baru dan jadikan background global. Hanya berhasil untuk KM (dijaga RLS). */
export async function setBackground(file, userId, overlay = DEFAULT_OVERLAY) {
  const err = validateFile('backgrounds', file);
  if (err) throw new Error(err);
  const old = await getBackgroundSetting();
  const up = await uploadFile('backgrounds', file, 'global');
  try {
    await saveSetting({ url: up.url, path: up.path, overlay }, userId);
  } catch (e) {
    await removeFiles('backgrounds', up.path); // batalkan unggahan bila gagal menyimpan konfigurasi
    throw e;
  }
  if (old.path) await removeFiles('backgrounds', old.path);
  applyBackground({ url: up.url, overlay });
  cache({ url: up.url, overlay });
  return up.url;
}

/** Ubah hanya ketebalan overlay (tanpa mengganti gambar). */
export async function setOverlay(overlay, userId) {
  const cur = await getBackgroundSetting();
  await saveSetting({ url: cur.url, path: cur.path, overlay }, userId);
  applyBackground({ url: cur.url, overlay });
  cache({ url: cur.url, overlay });
}

/** Kembalikan ke background default SYNORA. */
export async function resetBackground(userId) {
  const cur = await getBackgroundSetting();
  await saveSetting({ url: null, path: null, overlay: DEFAULT_OVERLAY }, userId);
  if (cur.path) await removeFiles('backgrounds', cur.path);
  applyBackground({ url: null, overlay: DEFAULT_OVERLAY });
  cache({ url: null, overlay: DEFAULT_OVERLAY });
}

/** Perubahan oleh KM langsung terlihat di semua pengguna yang sedang membuka aplikasi. */
export function subscribeBackground() {
  try {
    return sb.channel('bg-settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter: 'key=eq.background' }, (p) => {
        const v = p.new?.value || {};
        applyBackground({ url: v.url, overlay: v.overlay });
        cache({ url: v.url, overlay: v.overlay });
      })
      .subscribe();
  } catch { return null; }
}

export { publicUrl };
