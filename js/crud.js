// crud.js — helper kecil bersama untuk modul SYNORA Academic (tabel, badge, RPC, berkas privat).
import { sb } from './supabase.js';
import { esc, errMsg, fmtDate, emptyHTML, toast } from './utils.js';
import { signedUrl } from './storage.js';

/** Panggil fungsi database (RPC); lempar Error berpesan jelas bila gagal. */
export async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(errMsg(error));
  return data;
}

/** Ambil semua baris; lempar bila error. */
export async function q(builder) {
  const { data, error } = await builder;
  if (error) throw error;
  return data || [];
}

export const BADGE = {
  // lifecycle
  calon: '', pendaftar: '', peserta_seleksi: 'orange', diterima: 'ok', registrasi_ulang: 'ok', mahasiswa_baru: 'ok', aktif: 'ok',
  cuti: 'orange', nonaktif: '', mengundurkan_diri: 'danger', do: 'danger', proses_penyelesaian: 'orange', mengajukan_kelulusan: 'orange',
  belum_memenuhi_syarat: 'danger', lulus: 'ok', alumni: 'ok',
  // PMB
  berkas_lengkap: 'orange', tidak_lolos: 'danger',
  // umum
  draft: '', diajukan: 'orange', disetujui: 'ok', ditolak: 'danger', revisi: 'orange', revisi_judul: 'orange', menunggu: 'orange', terverifikasi: 'ok',
  lunas: 'ok', sebagian: 'orange', belum_bayar: 'danger',
  bimbingan: 'orange', layak_sidang: 'orange', dijadwalkan: 'orange', revisi_pasca_sidang: 'orange', selesai: 'ok',
};
export const label = (s) => String(s ?? '-').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const badge = (s) => `<span class="badge ${BADGE[s] || ''}">${esc(label(s))}</span>`;

/** Tabel sederhana. columns: [{label, render:(row)=>html, cls}] */
export function table(columns, rows, emptyMsg = 'Belum ada data.') {
  if (!rows.length) return emptyHTML(emptyMsg);
  return `<div class="table-wrap"><table class="table"><thead><tr>${columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.cls || ''}">${c.render(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export const opts = (rows, value, text, blank) => [...(blank ? [{ value: '', label: blank }] : []), ...rows.map((r) => ({ value: r[value], label: typeof text === 'function' ? text(r) : r[text] }))];
export const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
export const num = (n, d = 2) => (n === null || n === undefined ? '-' : Number(n).toFixed(d).replace('.', ','));

/** Buka berkas di bucket privat 'academic' pada tab baru. */
export async function openPrivate(path, bucket = 'academic') {
  try { window.open(await signedUrl(bucket, path), '_blank', 'noopener'); } catch (e) { toast(errMsg(e), 'error'); }
}

/** Ambil kolom tahun ajaran/semester aktif. */
export async function activeSemester() {
  const { data } = await sb.from('semesters').select('id,term,academic_years(name)').eq('is_active', true).maybeSingle();
  return data ? { ...data, name: `${data.academic_years?.name || ''} ${label(data.term)}` } : null;
}

/** Ambil data mahasiswa milik akun yang login (bukan untuk staf). */
export async function myStudent() {
  const { data } = await sb.from('students').select('*').order('created_at').limit(1).maybeSingle();
  return data;
}
export { fmtDate };
