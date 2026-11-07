// Edge Function: admin-users
// Dipakai Pengaturan > Manajemen Pengguna (hanya super_admin) dan registrasi ulang PMB (admin_pmb / admin_prodi, hanya akun mahasiswa).
// service_role key HANYA ada di environment Edge Function (otomatis tersedia di Supabase), tidak pernah di frontend.
//
// Deploy:  supabase functions deploy admin-users
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY disediakan otomatis oleh Supabase.)
// Opsional: supabase secrets set EMAIL_DOMAIN=synora.local

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ROLES = ["km", "sekretaris", "bendahara", "dosen", "super_admin", "admin_prodi", "admin_pmb", "admin_keuangan", "mahasiswa", "asisten_lab", "kaprodi", "dekan", "admin_universitas"];
// Role staf yang wajib punya cakupan (fakultas/prodi). super_admin & admin_universitas = tingkat universitas (tanpa cakupan).
const NEED_PROGRAM = ["kaprodi", "admin_prodi"];
const NEED_FACULTY = ["dekan"];
const NEED_EITHER = ["admin_pmb", "admin_keuangan"];
const UNI_WIDE = ["super_admin", "admin_universitas"];
// Pengelola akun penuh. Admin PMB/Prodi hanya boleh membuat akun role mahasiswa untuk NIM yang sudah ada di tabel students.
const FULL_ADMIN = ["super_admin"];
const STUDENT_ACCOUNT_CREATORS = ["admin_pmb", "admin_prodi"];
const DOMAIN = Deno.env.get("EMAIL_DOMAIN") ?? "synora.local";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIM_RE = /^[A-Za-z0-9._-]{3,30}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // 1. Identifikasi pemanggil dari JWT
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await caller.auth.getUser();
  if (userErr || !user) return json(401, { error: "Sesi tidak valid. Silakan login ulang." });

  // 2. Pastikan pemanggil adalah KM yang aktif
  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
  const { data: me } = await admin.from("profiles").select("is_active").eq("id", user.id).maybeSingle();
  const callerRole = roleRow?.role ?? "";
  const isFull = FULL_ADMIN.includes(callerRole);
  const canMakeStudent = STUDENT_ACCOUNT_CREATORS.includes(callerRole);
  if (!me?.is_active || !(isFull || canMakeStudent)) return json(403, { error: "Anda tidak berhak mengelola akun." });

  // Validasi & simpan cakupan (user_scopes). Mengembalikan pesan error atau null.
  async function checkScope(role: string, fac: unknown, prog: unknown): Promise<{ err?: string; faculty_id: string | null; program_id: string | null }> {
    const f = fac ? String(fac) : null, p = prog ? String(prog) : null;
    if (f && !UUID_RE.test(f)) return { err: "Fakultas tidak valid.", faculty_id: null, program_id: null };
    if (p && !UUID_RE.test(p)) return { err: "Prodi tidak valid.", faculty_id: null, program_id: null };
    if (UNI_WIDE.includes(role) || role === "mahasiswa" || ["km", "sekretaris", "bendahara", "dosen", "asisten_lab"].includes(role)) {
      return { faculty_id: null, program_id: null };
    }
    if (f && p) return { err: "Pilih salah satu: fakultas ATAU prodi.", faculty_id: null, program_id: null };
    if (NEED_PROGRAM.includes(role) && !p) return { err: "Role ini wajib dipasangkan ke satu Program Studi.", faculty_id: null, program_id: null };
    if (NEED_FACULTY.includes(role) && !f) return { err: "Dekan wajib dipasangkan ke satu Fakultas.", faculty_id: null, program_id: null };
    if (NEED_EITHER.includes(role) && !f && !p) return { err: "Pilih Fakultas atau Program Studi untuk role ini.", faculty_id: null, program_id: null };
    if (f) { const { data } = await admin.from("faculties").select("id").eq("id", f).maybeSingle(); if (!data) return { err: "Fakultas tidak ditemukan.", faculty_id: null, program_id: null }; }
    if (p) { const { data } = await admin.from("study_programs").select("id").eq("id", p).maybeSingle(); if (!data) return { err: "Prodi tidak ditemukan.", faculty_id: null, program_id: null }; }
    return { faculty_id: f, program_id: p };
  }
  async function saveScope(uid: string, sc: { faculty_id: string | null; program_id: string | null }) {
    if (!sc.faculty_id && !sc.program_id) { await admin.from("user_scopes").delete().eq("user_id", uid); return null; }
    const { error } = await admin.from("user_scopes").upsert({ user_id: uid, faculty_id: sc.faculty_id, program_id: sc.program_id });
    return error?.message ?? null;
  }

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "Body JSON tidak valid." }); }
  const action = body?.action;

  try {
    // ---- Tambah akun ----
    if (action === "create") {
      const nim = String(body.nim ?? "").trim();
      const fullName = String(body.full_name ?? "").trim();
      const role = String(body.role ?? "");
      const password = String(body.password ?? "");
      if (!NIM_RE.test(nim)) return json(400, { error: "NIM/username 3-30 karakter (huruf, angka, titik, strip, garis bawah)." });
      if (fullName.length < 2) return json(400, { error: "Nama lengkap wajib diisi." });
      if (!ROLES.includes(role)) return json(400, { error: "Role tidak valid." });
      if (password.length < 8) return json(400, { error: "Password minimal 8 karakter." });
      if (!isFull) {
        if (role !== "mahasiswa") return json(403, { error: "Anda hanya boleh membuat akun mahasiswa." });
        const { data: st } = await admin.from("students").select("id, program_id").eq("nim", nim).maybeSingle();
        if (!st) return json(400, { error: "NIM belum terdaftar sebagai mahasiswa (selesaikan registrasi ulang dulu)." });
        // Admin PMB/Prodi hanya boleh untuk mahasiswa di cakupan prodi/fakultasnya
        const { data: cs } = await admin.from("user_scopes").select("faculty_id, program_id").eq("user_id", user.id).maybeSingle();
        let ok = false;
        if (cs?.program_id) ok = st.program_id === cs.program_id;
        else if (cs?.faculty_id && st.program_id) {
          const { data: pg } = await admin.from("study_programs").select("faculty_id").eq("id", st.program_id).maybeSingle();
          ok = pg?.faculty_id === cs.faculty_id;
        }
        if (!ok) return json(403, { error: "Mahasiswa ini di luar cakupan prodi/fakultas Anda." });
      }

      const sc = await checkScope(role, body.faculty_id, body.program_id);
      if (sc.err) return json(400, { error: sc.err });

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: `${nim.toLowerCase()}@${DOMAIN}`, password, email_confirm: true,
      });
      if (cErr || !created.user) return json(400, { error: cErr?.message ?? "Gagal membuat akun." });
      const uid = created.user.id;

      const { error: pErr } = await admin.from("profiles").insert({ id: uid, nim, full_name: fullName, is_active: true });
      if (pErr) { await admin.auth.admin.deleteUser(uid); return json(400, { error: pErr.message }); }
      const { error: rErr } = await admin.from("user_roles").insert({ user_id: uid, role });
      if (rErr) { await admin.auth.admin.deleteUser(uid); return json(400, { error: rErr.message }); }
      const sErr = await saveScope(uid, sc);
      if (sErr) { await admin.auth.admin.deleteUser(uid); return json(400, { error: sErr }); }
      return json(200, { ok: true, id: uid });
    }

    if (!isFull) return json(403, { error: "Aksi ini hanya untuk Ketua Kelas / Super Admin." });
    // Aksi lain membutuhkan user_id target
    const target = String(body.user_id ?? "");
    if (!target) return json(400, { error: "user_id wajib diisi." });

    // ---- Ubah data / role ----
    if (action === "update") {
      const patch: Record<string, unknown> = {};
      if (body.full_name !== undefined) {
        const n = String(body.full_name).trim();
        if (n.length < 2) return json(400, { error: "Nama lengkap tidak valid." });
        patch.full_name = n;
      }
      if (Object.keys(patch).length) {
        const { error } = await admin.from("profiles").update(patch).eq("id", target);
        if (error) return json(400, { error: error.message });
      }
      if (body.role !== undefined) {
        if (!ROLES.includes(body.role)) return json(400, { error: "Role tidak valid." });
        if (target === user.id && body.role !== callerRole) return json(400, { error: "Anda tidak dapat mengubah role akun Anda sendiri." });
        const { error } = await admin.from("user_roles").upsert({ user_id: target, role: body.role });
        if (error) return json(400, { error: error.message });
      }
      if (body.role !== undefined || body.faculty_id !== undefined || body.program_id !== undefined) {
        let role = body.role as string | undefined;
        if (!role) { const { data: r } = await admin.from("user_roles").select("role").eq("user_id", target).maybeSingle(); role = r?.role ?? ""; }
        const sc = await checkScope(role!, body.faculty_id, body.program_id);
        if (sc.err) return json(400, { error: sc.err });
        const sErr = await saveScope(target, sc);
        if (sErr) return json(400, { error: sErr });
      }
      return json(200, { ok: true });
    }

    // ---- Aktifkan / nonaktifkan ----
    if (action === "set_active") {
      const active = !!body.active;
      if (target === user.id && !active) return json(400, { error: "Anda tidak dapat menonaktifkan akun Anda sendiri." });
      const { error } = await admin.from("profiles").update({ is_active: active }).eq("id", target);
      if (error) return json(400, { error: error.message });
      await admin.auth.admin.updateUserById(target, { ban_duration: active ? "none" : "876000h" });
      return json(200, { ok: true });
    }

    // ---- Reset password (KM menetapkan password sementara) ----
    if (action === "set_password") {
      const password = String(body.password ?? "");
      if (password.length < 8) return json(400, { error: "Password minimal 8 karakter." });
      const { error } = await admin.auth.admin.updateUserById(target, { password });
      if (error) return json(400, { error: error.message });
      return json(200, { ok: true });
    }

    return json(400, { error: "Aksi tidak dikenal." });
  } catch (e) {
    return json(500, { error: (e as Error).message ?? "Kesalahan server." });
  }
});
