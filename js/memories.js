// memories.js — Direktori anggota kelas (Our Class, Our Stories). CRUD students + memories_profiles + foto (bucket 'memories').
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { can } from './permissions.js';
import { uploadFile, removeFiles, BUCKETS } from './storage.js';
import { $, $$, esc, ok, fail, toast, confirmDialog, openModal, formModal, loadingHTML, emptyHTML, errorHTML, avatarHTML, debounce } from './utils.js';

const { ctx, content } = await initPage('memories');
const canC = can(ctx.role, 'memories', 'c'), canU = can(ctx.role, 'memories', 'u'), canD = can(ctx.role, 'memories', 'd');
let members = [];
const initialQ = new URLSearchParams(location.search).get('q') || '';

content.innerHTML = `
  <section class="mem-hero">
    <div><h1>Memories</h1><p>Our Class, Our Stories.</p></div>
    <div class="polaroids" aria-hidden="true"><div class="polaroid"><div><i class="bi bi-person-fill"></i></div></div><div class="polaroid"><div><i class="bi bi-camera-fill"></i></div></div><div class="polaroid"><div><i class="bi bi-heart-fill"></i></div></div></div>
  </section>
  <div class="mem-search">
    <div class="input-icon"><i class="bi bi-search"></i><input class="input" id="q" placeholder="Cari nama atau NIM anggota..." value="${esc(initialQ)}"></div>
    <select class="select" id="fo" style="width:auto"><option value="">Semua daerah</option></select>
    <button class="btn btn-primary" id="do-search"><i class="bi bi-search"></i> Cari</button>
    ${canC ? '<button class="btn btn-secondary" id="add"><i class="bi bi-person-plus-fill"></i> Tambah Anggota</button>' : ''}
  </div>
  <div id="grid">${loadingHTML()}</div>`;

async function load() {
  const { data, error } = await sb.from('students').select('*,memories_profiles(*)').eq('is_active', true).order('full_name');
  if (error) { $('#grid').innerHTML = errorHTML(error); return; }
  members = data.map((s) => ({ ...s, mp: Array.isArray(s.memories_profiles) ? s.memories_profiles[0] : s.memories_profiles }));
  const origins = [...new Set(members.map((m) => m.mp?.origin).filter(Boolean))].sort();
  const cur = $('#fo').value;
  $('#fo').innerHTML = '<option value="">Semua daerah</option>' + origins.map((o) => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('');
  render();
}

function render() {
  const q = $('#q').value.trim().toLowerCase(), fo = $('#fo').value;
  const rows = members.filter((m) => (!q || `${m.full_name} ${m.nim}`.toLowerCase().includes(q)) && (!fo || m.mp?.origin === fo));
  if (!rows.length) { $('#grid').innerHTML = `<div class="card">${emptyHTML(members.length ? 'Tidak ada anggota yang cocok.' : canC ? 'Belum ada anggota. Klik "Tambah Anggota" untuk mulai.' : 'Belum ada anggota.', 'bi-people')}</div>`; return; }
  $('#grid').innerHTML = `<div class="member-grid">${rows.map((m) => `<article class="member-card">
      ${avatarHTML(m.full_name, m.mp?.photo_url, 'lg')}<h4>${esc(m.full_name)}</h4><div class="nim">NIM: ${esc(m.nim)}</div>
      ${m.mp?.origin ? `<div class="meta"><i class="bi bi-geo-alt"></i> ${esc(m.mp.origin)}</div>` : ''}
      ${m.mp?.hobby ? `<div class="meta"><i class="bi bi-stars"></i> ${esc(m.mp.hobby)}</div>` : ''}
      ${m.mp?.favorite_song ? `<div class="song"><i class="bi bi-music-note-beamed"></i> ${esc(m.mp.favorite_song)}</div>` : ''}
      <button class="btn btn-secondary btn-sm" data-open="${m.id}">Lihat Profil <i class="bi bi-arrow-right"></i></button></article>`).join('')}</div>`;
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  $$('[data-open]', $('#grid')).forEach((b) => b.addEventListener('click', () => detail(byId[b.dataset.open])));
}

function detail(m) {
  const p = m.mp || {};
  const extra = Array.isArray(p.extra) ? p.extra : [];
  const modal = openModal({
    title: 'Profil Anggota', size: 'lg',
    content: `<div class="profile-detail"><div class="side">${avatarHTML(m.full_name, p.photo_url, 'xl')}<h3 class="mt">${esc(m.full_name)}</h3><span class="badge orange">${esc(m.nim)}</span></div>
      <div><dl class="kv"><dt>Program studi</dt><dd>${esc(m.program_studi)}</dd><dt>Asal daerah</dt><dd>${esc(p.origin || '-')}</dd><dt>Hobi</dt><dd>${esc(p.hobby || '-')}</dd><dt>Minat</dt><dd>${esc(p.interests || '-')}</dd><dt>Lagu favorit</dt><dd>${esc(p.favorite_song || '-')}</dd>
      ${extra.map((x) => `<dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd>`).join('')}</dl>
      <div class="divider"></div><h4>Deskripsi singkat</h4><p class="mt" style="white-space:pre-wrap">${esc(p.bio || 'Belum ada deskripsi.')}</p></div></div>`,
    footer: `${canD ? '<button class="btn btn-danger" id="m-del"><i class="bi bi-trash"></i> Hapus</button>' : ''}${canU ? '<button class="btn btn-primary" id="m-edit"><i class="bi bi-pencil"></i> Ubah</button>' : ''}<button class="btn btn-secondary" data-close>Tutup</button>`,
  });
  $('#m-edit', modal.root)?.addEventListener('click', () => { modal.close(); form(m); });
  $('#m-del', modal.root)?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Hapus anggota "${m.full_name}"? Data absensi dan kelompok anggota ini ikut terhapus.`))) return;
    const { error } = await sb.from('students').delete().eq('id', m.id);
    if (error) return fail(error);
    if (m.mp?.photo_path) await removeFiles('memories', m.mp.photo_path);
    ok('Anggota dihapus.'); modal.close(); load();
  });
}

function form(existing = null) {
  const p = existing?.mp || {};
  const values = existing ? { nim: existing.nim, full_name: existing.full_name, origin: p.origin, hobby: p.hobby, interests: p.interests, favorite_song: p.favorite_song, bio: p.bio } : {};
  const extra = Array.isArray(p.extra) ? [...p.extra] : [];
  const extraHTML = `<div class="divider"></div><div class="flex-between"><strong>Informasi tambahan (opsional)</strong><button type="button" class="btn btn-secondary btn-sm" id="add-extra"><i class="bi bi-plus-lg"></i> Tambah</button></div><div id="extra-box" class="mt"></div>`;
  formModal({
    title: existing ? 'Ubah Profil Anggota' : 'Tambah Anggota', size: 'lg', values, extraHTML,
    fields: [
      { name: 'full_name', label: 'Nama lengkap', required: true, maxlength: 120 },
      { name: 'nim', label: 'NIM', required: true, maxlength: 30, pattern: '^[A-Za-z0-9._-]{3,30}$', patternMsg: 'NIM 3–30 karakter (huruf/angka).' },
      { name: 'origin', label: 'Asal daerah', maxlength: 80, placeholder: 'mis. Cirebon, Jawa Barat' },
      { name: 'hobby', label: 'Hobi', maxlength: 120 },
      { name: 'interests', label: 'Minat', maxlength: 160 },
      { name: 'favorite_song', label: 'Lagu favorit', maxlength: 120, placeholder: 'Artis — Judul' },
      { name: 'photo', label: 'Foto profil', type: 'file', accept: '.png,.jpg,.jpeg,.webp', full: true, help: BUCKETS.memories.label },
      { name: 'bio', label: 'Deskripsi singkat', type: 'textarea', full: true, maxlength: 600 },
    ],
    afterRender: (formEl) => {
      const box = $('#extra-box', formEl);
      const draw = () => {
        box.innerHTML = extra.length ? extra.map((x, i) => `<div class="flex mb" data-i="${i}"><input class="input" placeholder="Label" value="${esc(x.label)}" data-k="label" maxlength="40"><input class="input" placeholder="Isi" value="${esc(x.value)}" data-k="value" maxlength="160"><button type="button" class="btn btn-danger btn-icon" data-rm="${i}"><i class="bi bi-x-lg"></i></button></div>`).join('') : '<span class="muted small">Belum ada informasi tambahan.</span>';
        $$('input[data-k]', box).forEach((inp) => inp.addEventListener('input', () => { extra[Number(inp.closest('[data-i]').dataset.i)][inp.dataset.k] = inp.value; }));
        $$('[data-rm]', box).forEach((b) => b.addEventListener('click', () => { extra.splice(Number(b.dataset.rm), 1); draw(); }));
      };
      $('#add-extra', formEl).addEventListener('click', () => { extra.push({ label: '', value: '' }); draw(); });
      draw();
    },
    onSubmit: async (v) => {
      let up = null;
      if (v.photo) up = await uploadFile('memories', v.photo, 'members');
      try {
        let sid = existing?.id;
        if (existing) {
          const { error } = await sb.from('students').update({ nim: v.nim, full_name: v.full_name }).eq('id', sid);
          if (error) throw error;
        } else {
          const { data, error } = await sb.from('students').insert({ nim: v.nim, full_name: v.full_name }).select('id').single();
          if (error) throw error;
          sid = data.id;
        }
        const prof = { student_id: sid, origin: v.origin, hobby: v.hobby, interests: v.interests, favorite_song: v.favorite_song, bio: v.bio,
          extra: extra.filter((x) => x.label.trim() && x.value.trim()), photo_url: p.photo_url || null, photo_path: p.photo_path || null };
        if (up) { prof.photo_url = up.url; prof.photo_path = up.path; }
        const { error: e2 } = await sb.from('memories_profiles').upsert(prof, { onConflict: 'student_id' });
        if (e2) { if (!existing) await sb.from('students').delete().eq('id', sid); throw e2; }
        if (up && p.photo_path) await removeFiles('memories', p.photo_path);
      } catch (e) { if (up) await removeFiles('memories', up.path); throw e; }
      ok(existing ? 'Profil diperbarui.' : 'Anggota ditambahkan.'); load();
    },
  });
}

$('#add')?.addEventListener('click', () => form());
$('#do-search').addEventListener('click', render);
$('#q').addEventListener('input', debounce(render, 200));
$('#fo').addEventListener('change', render);
await load();
