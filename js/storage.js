// storage.js — upload/unduh file ke Supabase Storage dengan validasi tipe & ukuran.
import { sb } from './supabase.js';

const IMG = ['image/png', 'image/jpeg', 'image/webp'];
export const BUCKETS = {
  avatars:     { public: true,  maxMB: 2,  mimes: IMG, exts: ['png', 'jpg', 'jpeg', 'webp'], label: 'PNG/JPG/WEBP, maks 2 MB' },
  memories:    { public: true,  maxMB: 3,  mimes: IMG, exts: ['png', 'jpg', 'jpeg', 'webp'], label: 'PNG/JPG/WEBP, maks 3 MB' },
  backgrounds: { public: true,  maxMB: 5,  mimes: IMG, exts: ['png', 'jpg', 'jpeg', 'webp'], label: 'PNG/JPG/WEBP, maks 5 MB' },
  music:       { public: true,  maxMB: 15, mimes: ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav'], exts: ['mp3', 'ogg', 'wav'], label: 'MP3/OGG/WAV, maks 15 MB' },
  documents:   { public: false, maxMB: 20, mimes: ['application/pdf', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ...IMG], exts: ['pdf', 'ppt', 'pptx', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'webp'], label: 'PDF, PPT/PPTX, DOC/DOCX, gambar; maks 20 MB' },
  proofs:      { public: false, maxMB: 5,  mimes: ['application/pdf', ...IMG], exts: ['pdf', 'png', 'jpg', 'jpeg', 'webp'], label: 'PDF/PNG/JPG, maks 5 MB' },
  chat:        { public: false, maxMB: 10, mimes: null, exts: ['pdf', 'ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'zip'], label: 'Dokumen/gambar, maks 10 MB' },
};

export const extOf = (name) => (String(name).split('.').pop() || '').toLowerCase();

/** Mengembalikan pesan error bila tidak valid, atau null bila valid. */
export function validateFile(bucket, file) {
  const cfg = BUCKETS[bucket];
  if (!file) return 'Pilih file terlebih dahulu.';
  if (file.size > cfg.maxMB * 1048576) return `Ukuran file melebihi ${cfg.maxMB} MB.`;
  if (!cfg.exts.includes(extOf(file.name))) return `Tipe file tidak diizinkan. Diizinkan: ${cfg.exts.join(', ').toUpperCase()}.`;
  if (cfg.mimes && file.type && !cfg.mimes.includes(file.type)) return 'Tipe konten file tidak sesuai dengan yang diizinkan.';
  return null;
}

export async function uploadFile(bucket, file, folder = '') {
  const err = validateFile(bucket, file);
  if (err) throw new Error(err);
  const path = `${folder ? folder.replace(/\/+$/, '') + '/' : ''}${crypto.randomUUID()}.${extOf(file.name)}`;
  const { error } = await sb.storage.from(bucket).upload(path, file, { contentType: file.type || undefined, upsert: false, cacheControl: '3600' });
  if (error) throw error;
  return { path, url: BUCKETS[bucket].public ? publicUrl(bucket, path) : null };
}

export const publicUrl = (bucket, path) => (path ? sb.storage.from(bucket).getPublicUrl(path).data.publicUrl : null);

/** URL sementara (1 jam) untuk bucket privat. Opsi download: nama file. */
export async function signedUrl(bucket, path, { download, seconds = 3600 } = {}) {
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, seconds, download ? { download } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeFiles(bucket, paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (!list.length) return;
  const { error } = await sb.storage.from(bucket).remove(list);
  if (error) console.warn('Gagal menghapus file lama:', error.message);
}
