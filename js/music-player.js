// music-player.js — pemutar musik jendela terpisah (pop-up). Tetap memutar saat halaman utama berpindah atau ditutup.
import { sb, isConfigured } from './supabase.js';
import { applyTheme } from './layout.js';
import { $, $$, esc } from './utils.js';

applyTheme();
const root = $('#root');
const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
const audio = new Audio(); audio.volume = 0.7;
let list = [], cur = -1;

async function main() {
  if (!isConfigured) { root.innerHTML = '<div class="empty">Supabase belum dikonfigurasi.</div>'; return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { root.innerHTML = '<div class="empty">Silakan masuk di jendela utama SYNORA, lalu buka pemutar ini lagi.</div>'; return; }
  const { data, error } = await sb.from('app_settings').select('value').eq('key', 'music_playlist').maybeSingle();
  if (error) { root.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  list = Array.isArray(data?.value) ? data.value : [];
  if (!list.length) { root.innerHTML = '<div class="empty">Belum ada lagu instrumental. KM atau Sekretaris dapat menambahkannya di Dashboard.</div>'; return; }
  render();
}

function meta() {
  if (!('mediaSession' in navigator) || cur < 0) return;
  const t = list[cur];
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || 'Instrumental', album: 'SYNORA',
      artwork: [{ src: new URL('../assets/icons/icon-512.png', import.meta.url).href, sizes: '512x512', type: 'image/png' }] });
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => play(cur - 1));
    navigator.mediaSession.setActionHandler('nexttrack', () => play(cur + 1));
    navigator.mediaSession.setActionHandler('seekto', (d) => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
  } catch { /* browser lama */ }
}
function play(i) {
  cur = (i + list.length) % list.length;
  audio.src = list[cur].url; meta();
  audio.play().catch(() => {});
  document.title = `${list[cur].title} — SYNORA`;
  render();
}
function render() {
  const t = list[cur];
  root.innerHTML = `
    <div class="now"><div class="disc"><i class="bi bi-music-note-beamed"></i></div>
      <div style="flex:1;min-width:0"><strong>${esc(t ? t.title : 'Pilih lagu')}</strong><br><small class="muted">${t ? esc(t.artist || 'Instrumental') : 'Pilih lagu dari daftar'}</small></div></div>
    <div><input type="range" id="seek" min="0" max="100" value="0" step="0.1" aria-label="Progress"><div class="flex-between small muted"><span id="tcur">0:00</span><span id="tdur">0:00</span></div></div>
    <div class="flex" style="justify-content:center;gap:14px">
      <button class="btn btn-secondary btn-icon" id="prev" aria-label="Sebelumnya"><i class="bi bi-skip-start-fill"></i></button>
      <button class="btn btn-primary btn-icon" id="pp" style="width:48px;height:48px" aria-label="Putar/Jeda"><i class="bi ${audio.paused ? 'bi-play-fill' : 'bi-pause-fill'}"></i></button>
      <button class="btn btn-secondary btn-icon" id="next" aria-label="Berikutnya"><i class="bi bi-skip-end-fill"></i></button>
    </div>
    <label class="flex small"><i class="bi bi-volume-up-fill"></i><input type="range" id="vol" min="0" max="1" step="0.01" value="${audio.volume}" style="flex:1"></label>
    <strong>Daftar Putar</strong>
    <div>${list.map((x, i) => `<div class="track ${i === cur ? 'active' : ''}" data-i="${i}"><span><i class="bi bi-music-note"></i> ${esc(x.title)}</span></div>`).join('')}</div>`;
  const seek = $('#seek', root);
  $('#pp', root).addEventListener('click', () => { if (cur < 0) return play(0); audio.paused ? audio.play() : audio.pause(); });
  $('#prev', root).addEventListener('click', () => play((cur < 0 ? 0 : cur) - 1));
  $('#next', root).addEventListener('click', () => play((cur < 0 ? -1 : cur) + 1));
  $('#vol', root).addEventListener('input', (e) => { audio.volume = Number(e.target.value); });
  seek.addEventListener('input', () => { if (audio.duration) audio.currentTime = (seek.value / 100) * audio.duration; });
  $$('.track', root).forEach((el) => el.addEventListener('click', () => play(Number(el.dataset.i))));
}
audio.ontimeupdate = () => { const s = $('#seek', root); if (s && audio.duration) { s.value = (audio.currentTime / audio.duration) * 100; $('#tcur', root).textContent = fmt(audio.currentTime); $('#tdur', root).textContent = fmt(audio.duration); } };
audio.onplay = audio.onpause = () => { const b = $('#pp', root); if (b) b.innerHTML = `<i class="bi ${audio.paused ? 'bi-play-fill' : 'bi-pause-fill'}"></i>`; };
audio.onended = () => play(cur + 1);
main();
