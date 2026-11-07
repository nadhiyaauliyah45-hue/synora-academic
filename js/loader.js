// loader.js — path dasar proyek & pemuat script. Tidak bergantung pada lokasi halaman (root atau /pages).
export const ROOT = new URL('../', import.meta.url).href; // mis. http://127.0.0.1:5500/synora/

export const pageUrl = (id) => (id === 'dashboard' ? ROOT + 'dashboard.html' : id === 'login' ? ROOT + 'index.html' : ROOT + 'pages/' + id + '.html');

const loaded = new Map();
export function loadScript(src) {
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Gagal memuat ' + src));
    document.head.appendChild(s);
  });
  loaded.set(src, p);
  return p;
}
