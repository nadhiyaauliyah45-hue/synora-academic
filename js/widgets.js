// widgets.js — fitur pendukung dashboard: Mode Game, Drawing Board, Musik Instrumen.
import { sb } from './supabase.js';
import { can } from './permissions.js';
import { $, $$, esc, openModal, toast, ok, fail, confirmDialog, formModal, downloadBlob, emptyHTML } from './utils.js';
import { uploadFile, removeFiles } from './storage.js';

/* =====================================================================
   MODE GAME : Memory Match, Kuis Informatika, Tebak Angka
   ===================================================================== */
const QUIZ = [
  ['Apa kepanjangan dari HTML?', ['HyperText Markup Language', 'High Transfer Machine Language', 'HyperTool Multi Language', 'Home Text Markup Level'], 0],
  ['Bahasa yang dipakai untuk menata tampilan halaman web adalah…', ['Python', 'CSS', 'SQL', 'C#'], 1],
  ['Struktur data yang bersifat LIFO adalah…', ['Queue', 'Array', 'Stack', 'Tree'], 2],
  ['Perintah SQL untuk mengambil data adalah…', ['INSERT', 'SELECT', 'UPDATE', 'DROP'], 1],
  ['Notasi Big-O dari pencarian biner adalah…', ['O(n)', 'O(n²)', 'O(1)', 'O(log n)'], 3],
  ['Sistem bilangan yang hanya memakai 0 dan 1 disebut…', ['Desimal', 'Oktal', 'Biner', 'Heksadesimal'], 2],
  ['HTTP status 404 berarti…', ['Server error', 'Tidak ditemukan', 'Berhasil', 'Dilarang'], 1],
  ['Perangkat lunak untuk mengelola versi kode adalah…', ['Git', 'Figma', 'Excel', 'Zoom'], 0],
];

export function openGameMenu() {
  const m = openModal({
    title: 'Mode Game', size: '', footer: null,
    content: `<p class="muted mb">Permainan ringan untuk mengisi waktu luang.</p>
      <div class="game-menu">
        <button data-g="memory"><i class="bi bi-grid-3x3-gap-fill"></i>Memory Match</button>
        <button data-g="quiz"><i class="bi bi-lightbulb-fill"></i>Kuis Informatika</button>
        <button data-g="guess"><i class="bi bi-123"></i>Tebak Angka</button>
      </div><div id="game-area" class="mt"></div>`,
  });
  const area = $('#game-area', m.root);
  const start = { memory: memoryGame, quiz: quizGame, guess: guessGame };
  $$('[data-g]', m.root).forEach((b) => b.addEventListener('click', () => start[b.dataset.g](area)));
}

function memoryGame(area) {
  const icons = ['💻', '⌨️', '🖱️', '💾', '📱', '🔌', '🧠', '🌐'];
  const deck = [...icons, ...icons].map((v, i) => ({ v, i })).sort(() => Math.random() - 0.5);
  let open = [], matched = 0, moves = 0, lock = false;
  area.innerHTML = `<div class="flex-between mb"><strong>Memory Match</strong><span class="badge orange">Langkah: <b id="mv">0</b></span></div><div class="mem-grid"></div><p class="center mt" id="mem-msg"></p>`;
  const grid = $('.mem-grid', area);
  deck.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'mem-card'; b.textContent = '?'; b.setAttribute('aria-label', 'Kartu');
    b.addEventListener('click', () => {
      if (lock || b.classList.contains('open') || b.classList.contains('done')) return;
      b.classList.add('open'); b.textContent = c.v; open.push({ b, c });
      if (open.length === 2) {
        moves++; $('#mv', area).textContent = moves; lock = true;
        const [a, d] = open;
        if (a.c.v === d.c.v) {
          [a.b, d.b].forEach((x) => { x.classList.remove('open'); x.classList.add('done'); });
          matched++; open = []; lock = false;
          if (matched === icons.length) $('#mem-msg', area).innerHTML = `<b>Selesai!</b> Kamu menyelesaikan dalam ${moves} langkah. 🎉`;
        } else setTimeout(() => { [a.b, d.b].forEach((x) => { x.classList.remove('open'); x.textContent = '?'; }); open = []; lock = false; }, 800);
      }
    });
    grid.appendChild(b);
  });
}

function quizGame(area) {
  const qs = [...QUIZ].sort(() => Math.random() - 0.5).slice(0, 5);
  let i = 0, score = 0;
  const render = () => {
    if (i >= qs.length) { area.innerHTML = `<div class="center"><h3>Skor: ${score} / ${qs.length}</h3><p class="muted">${score >= 4 ? 'Keren sekali! 🔥' : score >= 3 ? 'Lumayan, terus belajar!' : 'Ayo coba lagi!'}</p><button class="btn btn-primary mt" id="again">Main Lagi</button></div>`; $('#again', area).addEventListener('click', () => quizGame(area)); return; }
    const [q, opts, ans] = qs[i];
    area.innerHTML = `<div class="flex-between"><strong>Kuis Informatika</strong><span class="badge">${i + 1} / ${qs.length}</span></div><p class="mt"><b>${esc(q)}</b></p>${opts.map((o, k) => `<button class="quiz-opt" data-k="${k}">${esc(o)}</button>`).join('')}`;
    $$('.quiz-opt', area).forEach((b) => b.addEventListener('click', () => {
      const k = Number(b.dataset.k);
      $$('.quiz-opt', area).forEach((x) => { x.disabled = true; if (Number(x.dataset.k) === ans) x.classList.add('right'); });
      if (k === ans) score++; else b.classList.add('wrong');
      setTimeout(() => { i++; render(); }, 900);
    }));
  };
  render();
}

function guessGame(area) {
  const target = 1 + Math.floor(Math.random() * 100);
  let tries = 7;
  area.innerHTML = `<strong>Tebak Angka 1–100</strong><p class="muted">Kesempatan: <b id="tries">7</b></p>
    <div class="flex mt"><input class="input" id="gv" type="number" min="1" max="100" placeholder="Tebakanmu"><button class="btn btn-primary" id="gb">Tebak</button></div><p class="mt" id="gm"></p>`;
  $('#gb', area).addEventListener('click', () => {
    const v = Number($('#gv', area).value);
    if (!v || v < 1 || v > 100) { $('#gm', area).textContent = 'Masukkan angka 1 sampai 100.'; return; }
    tries--; $('#tries', area).textContent = tries;
    if (v === target) { $('#gm', area).innerHTML = `<b>Benar!</b> Angkanya ${target}. 🎉`; $('#gb', area).disabled = true; return; }
    if (tries === 0) { $('#gm', area).textContent = `Kesempatan habis. Angkanya ${target}.`; $('#gb', area).disabled = true; return; }
    $('#gm', area).textContent = v < target ? 'Terlalu kecil ⬆️' : 'Terlalu besar ⬇️';
  });
}

/* =====================================================================
   DRAWING BOARD
   ===================================================================== */
export function openDrawing() {
  const colors = ['#38271F', '#C96645', '#E98532', '#E4B23B', '#3E9B5A', '#3C7DB8', '#8B5FBF', '#D6475F'];
  const m = openModal({
    title: 'Drawing Board', size: 'lg', footer: null,
    content: `<div class="draw-tools">
        ${colors.map((c) => `<span class="swatch" data-c="${c}" style="background:${c}" title="${c}"></span>`).join('')}
        <input type="color" id="dc" value="#38271F" aria-label="Pilih warna">
        <label class="flex gap-sm small">Kuas <input type="range" id="ds" min="1" max="40" value="5"> <b id="dsv">5</b></label>
        <button class="btn btn-secondary btn-sm" id="de"><i class="bi bi-eraser-fill"></i> Penghapus</button>
        <button class="btn btn-danger btn-sm" id="dclr"><i class="bi bi-trash"></i> Hapus Semua</button>
        <button class="btn btn-primary btn-sm" id="dsave"><i class="bi bi-download"></i> Simpan Gambar</button>
      </div>
      <canvas class="draw-canvas" id="cv" width="900" height="520"></canvas>`,
  });
  const cv = $('#cv', m.root), ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  let color = '#38271F', size = 5, erase = false, drawing = false, last = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
  cv.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); cv.setPointerCapture(e.pointerId); dot(last); });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.strokeStyle = erase ? '#fff' : color; ctx.lineWidth = size;
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p;
  });
  const stop = () => { drawing = false; };
  cv.addEventListener('pointerup', stop); cv.addEventListener('pointercancel', stop);
  function dot(p) { ctx.fillStyle = erase ? '#fff' : color; ctx.beginPath(); ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2); ctx.fill(); }
  $$('.swatch', m.root).forEach((s) => s.addEventListener('click', () => { color = s.dataset.c; $('#dc', m.root).value = color; erase = false; }));
  $('#dc', m.root).addEventListener('input', (e) => { color = e.target.value; erase = false; });
  $('#ds', m.root).addEventListener('input', (e) => { size = Number(e.target.value); $('#dsv', m.root).textContent = size; });
  $('#de', m.root).addEventListener('click', (e) => { erase = !erase; e.currentTarget.classList.toggle('btn-primary', erase); e.currentTarget.classList.toggle('btn-secondary', !erase); });
  $('#dclr', m.root).addEventListener('click', async () => {
    if (await confirmDialog('Hapus seluruh gambar di kanvas?')) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
  });
  $('#dsave', m.root).addEventListener('click', () => cv.toBlob((b) => { downloadBlob(b, `synora-gambar-${Date.now()}.png`); ok('Gambar disimpan ke perangkat Anda.'); }, 'image/png'));
}

/* =====================================================================
   MUSIK INSTRUMEN — playlist disimpan di app_settings('music_playlist'), file di bucket 'music'
   ===================================================================== */
let audio = null;
const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

export async function openMusic(ctx) {
  const canEdit = can(ctx.role, 'music', 'c');
  let list = [];
  let cur = -1;
  if (!audio) { audio = new Audio(); audio.preload = 'none'; audio.volume = 0.7; }

  async function loadList() {
    const { data, error } = await sb.from('app_settings').select('value').eq('key', 'music_playlist').maybeSingle();
    if (error) throw error;
    list = Array.isArray(data?.value) ? data.value : [];
  }
  async function saveList() {
    const { error } = await sb.from('app_settings').upsert({ key: 'music_playlist', value: list, updated_by: ctx.user.id }, { onConflict: 'key' });
    if (error) throw error;
  }

  const m = openModal({
    title: 'Musik Instrumen', footer: null,
    content: '<div class="player"><div id="pl-body"></div></div>',
    onClose: () => { audio.pause(); audio.onended = audio.ontimeupdate = audio.onplay = audio.onpause = null; },
  });
  const body = $('#pl-body', m.root);

  function render() {
    if (!list.length) {
      body.innerHTML = emptyHTML('Belum ada lagu instrumental.', 'bi-music-note-list') +
        (canEdit ? '<div class="center"><button class="btn btn-primary" id="add-track"><i class="bi bi-plus-lg"></i> Tambah Lagu</button></div>' : '<p class="center muted small">KM atau Sekretaris dapat menambahkan lagu.</p>');
      $('#add-track', body)?.addEventListener('click', addTrack);
      return;
    }
    const t = list[cur];
    body.innerHTML = `
      <div class="now"><div class="disc"><i class="bi bi-music-note-beamed"></i></div>
        <div style="flex:1;min-width:0"><strong id="np-title">${esc(t ? t.title : 'Pilih lagu')}</strong><br><small class="muted">${t ? esc(t.artist || 'Instrumental') : 'Pilih lagu dari daftar'}</small></div></div>
      <div><input type="range" id="seek" min="0" max="100" value="0" step="0.1" aria-label="Progress"><div class="flex-between small muted"><span id="tcur">0:00</span><span id="tdur">0:00</span></div></div>
      <div class="flex" style="justify-content:center;gap:14px">
        <button class="btn btn-secondary btn-icon" id="prev" aria-label="Sebelumnya"><i class="bi bi-skip-start-fill"></i></button>
        <button class="btn btn-primary btn-icon" id="pp" style="width:48px;height:48px" aria-label="Putar/Jeda"><i class="bi bi-play-fill"></i></button>
        <button class="btn btn-secondary btn-icon" id="next" aria-label="Berikutnya"><i class="bi bi-skip-end-fill"></i></button>
      </div>
      <label class="flex small"><i class="bi bi-volume-up-fill"></i><input type="range" id="vol" min="0" max="1" step="0.01" value="${audio.volume}" style="flex:1"></label>
      <div class="flex-between"><strong>Daftar Putar</strong>${canEdit ? '<button class="btn btn-secondary btn-sm" id="add-track"><i class="bi bi-plus-lg"></i> Tambah Lagu</button>' : ''}</div>
      <div id="tracks">${list.map((x, i) => `<div class="track ${i === cur ? 'active' : ''}" data-i="${i}"><span><i class="bi bi-music-note"></i> ${esc(x.title)}</span>${canEdit ? `<button class="btn btn-ghost btn-sm" data-del="${i}" aria-label="Hapus"><i class="bi bi-trash"></i></button>` : ''}</div>`).join('')}</div>`;
    wire();
  }

  function setPlayIcon() { const b = $('#pp', body); if (b) b.innerHTML = `<i class="bi ${audio.paused ? 'bi-play-fill' : 'bi-pause-fill'}"></i>`; }
  function play(i) {
    cur = (i + list.length) % list.length;
    audio.src = list[cur].url;
    audio.play().catch(() => toast('Tidak dapat memutar lagu. Periksa file/URL musik.', 'error'));
    render();
  }
  function wire() {
    const seek = $('#seek', body);
    $('#pp', body).addEventListener('click', () => { if (cur < 0) return play(0); audio.paused ? audio.play() : audio.pause(); });
    $('#prev', body).addEventListener('click', () => play((cur < 0 ? 0 : cur) - 1));
    $('#next', body).addEventListener('click', () => play((cur < 0 ? -1 : cur) + 1));
    $('#vol', body).addEventListener('input', (e) => { audio.volume = Number(e.target.value); });
    seek.addEventListener('input', () => { if (audio.duration) audio.currentTime = (seek.value / 100) * audio.duration; });
    audio.ontimeupdate = () => { if (audio.duration && $('#seek', body)) { $('#seek', body).value = (audio.currentTime / audio.duration) * 100; $('#tcur', body).textContent = fmt(audio.currentTime); $('#tdur', body).textContent = fmt(audio.duration); } };
    audio.onplay = audio.onpause = setPlayIcon;
    audio.onended = () => play(cur + 1);
    $$('.track', body).forEach((el) => el.addEventListener('click', (e) => { if (e.target.closest('[data-del]')) return; play(Number(el.dataset.i)); }));
    $$('[data-del]', body).forEach((b) => b.addEventListener('click', async () => {
      const i = Number(b.dataset.del);
      if (!(await confirmDialog(`Hapus lagu "${list[i].title}"?`))) return;
      try {
        const [rm] = list.splice(i, 1);
        await saveList();
        if (rm.path) await removeFiles('music', rm.path);
        if (i === cur) { audio.pause(); cur = -1; } else if (i < cur) cur--;
        ok('Lagu dihapus.'); render();
      } catch (e) { fail(e); await loadList(); render(); }
    }));
    $('#add-track', body)?.addEventListener('click', addTrack);
    setPlayIcon();
  }

  function addTrack() {
    formModal({
      title: 'Tambah Lagu Instrumental',
      fields: [
        { name: 'title', label: 'Judul lagu', required: true, full: true, maxlength: 100 },
        { name: 'artist', label: 'Artis / keterangan', full: true, maxlength: 100 },
        { name: 'file', label: 'File musik (MP3/OGG/WAV, maks 15 MB)', type: 'file', accept: '.mp3,.ogg,.wav,audio/*', required: true, full: true,
          help: 'Gunakan musik bebas hak cipta atau yang Anda miliki lisensinya.' },
      ],
      onSubmit: async (v) => {
        const up = await uploadFile('music', v.file, 'tracks');
        list.push({ title: v.title, artist: v.artist || '', url: up.url, path: up.path });
        try { await saveList(); } catch (e) { list.pop(); await removeFiles('music', up.path); throw e; }
        ok('Lagu ditambahkan.'); render();
      },
    });
  }

  body.innerHTML = '<div class="loading-box"><span class="spinner"></span></div>';
  try { await loadList(); render(); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
