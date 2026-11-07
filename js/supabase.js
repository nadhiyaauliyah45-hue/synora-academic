// supabase.js — membuat client Supabase (memakai anon key + RLS).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { loadScript, ROOT } from './loader.js';

export const isConfigured =
  /^https?:\/\//.test(SUPABASE_URL) && !SUPABASE_URL.includes('ISI_') &&
  !!SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes('ISI_');

let client = null;
if (isConfigured) {
  // Library Supabase dimuat lokal dari /vendor (tidak bergantung CDN).
  if (!window.supabase) await loadScript(ROOT + 'vendor/supabase.umd.js');
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
}
export const sb = client;
