// config.js — SATU-SATUNYA file yang perlu Anda isi untuk menghubungkan SYNORA ke Supabase.
//
// Ambil dari: Supabase Dashboard > Project Settings > API
//   - Project URL            -> SUPABASE_URL
//   - anon / publishable key -> SUPABASE_ANON_KEY
//
// PENTING: gunakan HANYA anon/publishable key. JANGAN PERNAH menaruh service_role key di sini
// atau di file frontend mana pun. Keamanan data dijaga oleh Row Level Security (RLS) di database.

export const SUPABASE_URL = 'https://corpunnprtmguhpnyiqe.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Peqk6H72UTqcbhW7S3vUrQ_N2ItcYNY'; // publishable key (aman di frontend; data dijaga RLS)

// Login memakai NIM/username. Supabase Auth butuh email, jadi NIM dipetakan ke email internal.
// Jika Anda mengubah domain ini, ubah juga EMAIL_DOMAIN pada Edge Function admin-users
// dan pada email akun KM yang dibuat lewat bootstrap-km.sql.
export const EMAIL_DOMAIN = 'synora.local';

export const APP = {
  name: 'SYNORA',
  slogan: 'One Class, One Connected Space',
  className: 'TI24D',
  institution: 'Universitas Muhammadiyah Cirebon',
  quote: 'Satu ruang untuk belajar, berbagi, mengelola, mengabadikan kenangan, dan tumbuh bersama.',
};
