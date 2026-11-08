// permissions.js — satu sumber kebenaran hak akses di FRONTEND (untuk menampilkan/menyembunyikan UI).
// Penegakan sebenarnya ada di database lewat RLS (database/rls-policies.sql). Jaga keduanya tetap selaras.
export const ROLES = {
  km: 'Ketua Kelas (KM)',
  sekretaris: 'Sekretaris',
  bendahara: 'Bendahara',
  dosen: 'Dosen',
  super_admin: 'Super Admin',
  admin_prodi: 'Admin Prodi',
  admin_pmb: 'Admin PMB',
  admin_keuangan: 'Admin Keuangan',
  mahasiswa: 'Mahasiswa',
  asisten_lab: 'Asisten Laboratorium',
  kaprodi: 'Ketua Program Studi (Kaprodi)',
  dekan: 'Dekan',
  admin_universitas: 'Admin Universitas',
};
export const ROLE_SHORT = ROLES;
export const ACADEMIC_ROLES = ['super_admin', 'admin_universitas', 'dekan', 'kaprodi', 'admin_prodi', 'admin_pmb', 'admin_keuangan', 'mahasiswa', 'asisten_lab'];
// Jenjang pengelola: universitas > fakultas > prodi > kelas. Peran bercakupan butuh baris user_scopes (diatur Super Admin).
export const SCOPE_OF = { admin_universitas: 'universitas', super_admin: 'universitas', dekan: 'fakultas', kaprodi: 'prodi', admin_prodi: 'prodi', admin_pmb: 'prodi_atau_fakultas', admin_keuangan: 'prodi_atau_fakultas' };
export const isUniWide = (r) => r === 'super_admin' || r === 'admin_universitas';
// Pengelola akademik yang boleh menulis (dibatasi cakupan prodi oleh RLS)
export const isAcademicStaff = (r) => ['super_admin', 'admin_universitas', 'kaprodi', 'admin_prodi'].includes(r);
export const isStudentRole = (r) => r === 'mahasiswa' || r === 'asisten_lab';

// c = create, r = read, u = update, d = delete
const MATRIX = {
  dashboard:     { km: 'r', sekretaris: 'r', bendahara: 'r', dosen: 'r' },
  attendance:    { km: 'crud', sekretaris: 'crud', dosen: 'r' },
  finance:       { km: 'crud', bendahara: 'crud' },
  inventory:     { km: 'crud', bendahara: 'crud' },
  courses:       { km: 'crud', sekretaris: 'crud', dosen: 'r' },
  lecturers:     { km: 'crud', sekretaris: 'crud', dosen: 'r' },
  library:       { km: 'crud', sekretaris: 'crud', dosen: 'r' },
  memories:      { km: 'crud', sekretaris: 'crud', bendahara: 'r', dosen: 'r' },
  settings:      { km: 'r', sekretaris: 'r', bendahara: 'r', dosen: 'r' },
  users:         {},
  background:    { km: 'ru' },
  calendar:      { km: 'crud', sekretaris: 'crud', dosen: 'r' },
  communication: { km: 'crud', sekretaris: 'crud', bendahara: 'crud', dosen: 'crud' },
  announcements: { km: 'crud', sekretaris: 'crud', bendahara: 'r', dosen: 'r' },
  classspin:     { km: 'crud' },
  students:      { km: 'crud', sekretaris: 'crud', bendahara: 'r', dosen: 'r' },
  music:         { km: 'crud', sekretaris: 'crud', bendahara: 'r', dosen: 'r' },
  // ---- SYNORA Academic (penegakan sebenarnya di database/migrations/090_rls.sql) ----
  kaprodi:    { super_admin: 'r', admin_universitas: 'r', dekan: 'r', kaprodi: 'r', admin_prodi: 'r' },
  prodi:      { super_admin: 'crud', admin_universitas: 'crud', kaprodi: 'crud', admin_prodi: 'crud', dekan: 'r', dosen: 'r' },
  pmb:        { super_admin: 'crud', admin_universitas: 'crud', admin_pmb: 'crud', kaprodi: 'crud', admin_prodi: 'crud', admin_keuangan: 'r', dekan: 'r' },
  academic:   { super_admin: 'crud', admin_universitas: 'crud', kaprodi: 'crud', admin_prodi: 'crud', dekan: 'r', dosen: 'cru' },
  portal:     { mahasiswa: 'crud', asisten_lab: 'crud', km: 'crud', sekretaris: 'crud', bendahara: 'crud' }, // pengurus kelas juga mahasiswa: KRS, KHS, SKS, tagihan
  practicum:  { super_admin: 'crud', admin_universitas: 'crud', kaprodi: 'crud', admin_prodi: 'crud', dekan: 'r', dosen: 'crud', asisten_lab: 'cru', mahasiswa: 'r' },
  billing:    { super_admin: 'crud', admin_universitas: 'crud', admin_keuangan: 'crud', kaprodi: 'r', admin_prodi: 'r', dekan: 'r' },
  thesis:     { super_admin: 'crud', admin_universitas: 'crud', kaprodi: 'crud', admin_prodi: 'crud', dekan: 'r', dosen: 'ru', mahasiswa: 'cru', asisten_lab: 'cru' },
  graduation: { super_admin: 'crud', admin_universitas: 'crud', kaprodi: 'crud', admin_prodi: 'crud', dekan: 'r', dosen: 'r' },
};
// Semua role boleh membuka dashboard.html; halaman itu mengarahkan ke beranda sesuai role.
for (const r of Object.keys(ROLES)) MATRIX.dashboard[r] = 'r';
MATRIX.users.super_admin = 'crud';
for (const r of ['admin_universitas', 'dekan', 'kaprodi']) MATRIX.settings[r] = 'r';
MATRIX.settings.super_admin = 'r'; MATRIX.settings.admin_prodi = 'r'; MATRIX.settings.admin_pmb = 'r';
MATRIX.settings.admin_keuangan = 'r'; MATRIX.settings.mahasiswa = 'r'; MATRIX.settings.asisten_lab = 'r';
// Kalender berjenjang: KM/Sekretaris = agenda kelas; Kaprodi/Admin Prodi = agenda prodi; Dekan = agenda fakultas; Universitas = semua tingkat.
// Tingkat yang boleh ditulis dibatasi lagi oleh RLS (event_writable) dan antarmuka (calendar.js).
for (const r of ['super_admin', 'admin_universitas', 'dekan', 'kaprodi', 'admin_prodi']) MATRIX.calendar[r] = 'crud';
for (const r of ['mahasiswa', 'asisten_lab', 'admin_pmb', 'admin_keuangan', 'bendahara']) MATRIX.calendar[r] = 'r';
MATRIX.announcements.super_admin = 'r'; MATRIX.announcements.admin_prodi = 'crud';

/** Beranda tiap role setelah login. */
export const HOME = {
  mahasiswa: 'student-portal', asisten_lab: 'student-portal', super_admin: 'kaprodi', admin_prodi: 'kaprodi',
  kaprodi: 'kaprodi', dekan: 'kaprodi', admin_universitas: 'kaprodi',
  admin_pmb: 'pmb', admin_keuangan: 'billing',
};

export function can(role, module, action = 'r') {
  const letter = { read: 'r', view: 'r', create: 'c', update: 'u', delete: 'd' }[action] || action;
  return (MATRIX[module]?.[role] || '').includes(letter);
}

// Urutan menu sesuai master prompt.
export const MENU = [
  { id: 'dashboard',     label: 'Dashboard',              icon: 'bi-grid-1x2-fill',       module: 'dashboard' },
  { id: 'attendance',    label: 'Absensi',                icon: 'bi-person-check-fill',   module: 'attendance' },
  { id: 'finance',       label: 'Keuangan',               icon: 'bi-wallet2',             module: 'finance' },
  { id: 'courses',       label: 'Informasi Mata Kuliah',  icon: 'bi-journal-bookmark-fill', module: 'courses' },
  { id: 'library',       label: 'Perpustakaan',           icon: 'bi-collection-fill',     module: 'library' },
  { id: 'memories',      label: 'Memories',               icon: 'bi-camera-fill',         module: 'memories' },
  { id: 'settings',      label: 'Pengaturan',             icon: 'bi-gear-fill',           module: 'settings' },
  { id: 'calendar',      label: 'Kalender Akademik',      icon: 'bi-calendar3',           module: 'calendar' },
  { id: 'communication', label: 'Ruang Komunikasi',       icon: 'bi-chat-dots-fill',      module: 'communication' },
  { id: 'class-spin',    label: 'Class Spin',             icon: 'bi-shuffle',             module: 'classspin' },
  { id: 'student-portal',label: 'Portal Saya',            icon: 'bi-house-heart-fill',    module: 'portal', first: true },
  { id: 'kaprodi',       label: 'Dashboard Akademik',      icon: 'bi-bar-chart-line-fill', module: 'kaprodi', first: true },
  { id: 'prodi',         label: 'Prodi & Kelas',          icon: 'bi-diagram-3-fill',      module: 'prodi' },
  { id: 'pmb',           label: 'PMB',                    icon: 'bi-person-plus-fill',    module: 'pmb' },
  { id: 'academic',      label: 'KRS & Nilai',            icon: 'bi-mortarboard-fill',    module: 'academic' },
  { id: 'practicum',     label: 'Praktikum & Lab',        icon: 'bi-pc-display',          module: 'practicum' },
  { id: 'billing',       label: 'Tagihan & Pembayaran',   icon: 'bi-receipt',             module: 'billing' },
  { id: 'thesis',        label: 'Skripsi',                icon: 'bi-journal-richtext',    module: 'thesis' },
  { id: 'graduation',    label: 'Kelulusan & Alumni',     icon: 'bi-award-fill',          module: 'graduation' },
];

// Role akademik memakai menu sendiri; Dashboard lama hanya untuk role kelas (km, sekretaris, bendahara, dosen).
const CLASS_ROLES = ['km', 'sekretaris', 'bendahara', 'dosen'];
export const menuFor = (role) => {
  const items = MENU.filter((m) => can(role, m.module, 'r') && !(m.id === 'dashboard' && !CLASS_ROLES.includes(role)));
  return [...items.filter((m) => m.first), ...items.filter((m) => !m.first)];
};
// Inventaris adalah bagian dari modul Keuangan: halamannya ikut aturan 'finance'.
export const PAGE_MODULE = { inventory: 'finance', 'class-spin': 'classspin', 'student-portal': 'portal' };
export const moduleOfPage = (page) => PAGE_MODULE[page] || page;
export const canSeeBalance = (role) => can(role, 'finance', 'r');
