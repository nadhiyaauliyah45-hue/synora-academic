// pmb-saya.js — halaman calon mahasiswa: status pendaftaran, unggah berkas sendiri, dan tes seleksi online.
// Lulus jika nilai > 75, tidak lulus jika nilai <= 75 (diputuskan otomatis oleh fungsi database pmb_test_submit).
import { sb } from './supabase.js';
import { initPage } from './layout.js';
import { $, $$, esc, loadingHTML, errorHTML, emptyHTML, fmtDate, fmtDateTime, ok, fail, confirmDialog } from './utils.js';

const { ctx, content } = await initPage('pmb-saya');
content.innerHTML = loadingHTML();

const STATUS = {
  pendaftar: ['Terdaftar', 'Pendaftaran Anda diterima. Lengkapi berkas, lalu tunggu verifikasi Admin PMB.'],
  berkas_lengkap: ['Berkas Lengkap', 'Berkas Anda dinyatakan lengkap dan menunggu proses seleksi.'],
  peserta_seleksi: ['Peserta Seleksi', 'Anda terdaftar sebagai peserta seleksi. Ikuti tes online sesuai jadwal.'],
  diterima: ['Diterima', 'Selamat, Anda dinyatakan LULUS! Lanjutkan pembayaran dan registrasi ulang sesuai arahan Admin PMB.'],
  tidak_lolos: ['Tidak Lulus', 'Mohon maaf, Anda dinyatakan tidak lulus seleksi pada periode ini.'],
  registrasi_ulang: ['Registrasi Ulang Selesai', 'Registrasi ulang selesai. NIM dan akun mahasiswa akan diberikan oleh pengelola.'],
  mengundurkan_diri: ['Mengundurkan Diri', 'Pendaftaran ini berstatus mengundurkan diri.'],
};
const FLOW = ['pendaftar', 'berkas_lengkap', 'peserta_seleksi', 'diterima', 'registrasi_ulang'];
const DOCS = [['ktp', 'KTP / Kartu Pelajar', true], ['kk', 'Kartu Keluarga', true], ['ijazah', 'Ijazah / SKL', true], ['pas_foto', 'Pas Foto', true], ['transkrip', 'Transkrip / Rapor', false]];
const REASON = {
  berkas: 'Semua berkas wajib (KTP, KK, Ijazah, Pas Foto) harus diunggah dan sudah diverifikasi Admin PMB sebelum Anda boleh mengikuti tes.',
  belum_tersedia: 'Tes belum dipublikasikan oleh Admin PMB.',
  belum_mulai: 'Tes belum dimulai. Perhatikan jadwal di bawah.',
  sudah_lewat: 'Jadwal tes sudah berakhir. Hubungi Admin PMB.',
  status: 'Status pendaftaran Anda saat ini tidak memerlukan tes.',
};
let timer = null, saveTimer = null;

async function main() {
  clearInterval(timer);
  content.innerHTML = loadingHTML();
  const { data: a, error } = await sb.from('pmb_applicants')
    .select('id,reg_number,full_name,email,status,created_at,test_score,pmb_periods(name,study_programs(name,level))')
    .eq('user_id', ctx.user.id).maybeSingle();
  if (error) { content.innerHTML = `<div class="card">${errorHTML(error)}</div>`; return; }
  if (!a) { content.innerHTML = `<div class="card">${emptyHTML('Data pendaftaran tidak ditemukan. Hubungi Admin PMB.')}</div>`; return; }
  const [{ data: hist }, { data: docs }, { data: st, error: e3 }] = await Promise.all([
    sb.from('pmb_status_history').select('to_status,note,created_at').eq('applicant_id', a.id).order('created_at', { ascending: false }),
    sb.from('pmb_documents').select('id,doc_type,file_path,verified,note,created_at').eq('applicant_id', a.id).order('created_at'),
    sb.rpc('pmb_my_test_status'),
  ]);
  const [title, desc] = STATUS[a.status] || [a.status, ''];
  const idx = FLOW.indexOf(a.status);
  const prog = a.pmb_periods?.study_programs;
  const lulus = a.status === 'diterima' || a.status === 'registrasi_ulang';
  const tone = lulus ? '#1f9d55' : a.status === 'tidak_lolos' ? '#c0392b' : 'inherit';

  content.innerHTML = `
    <div class="page-head"><div><h2>Pendaftaran Saya</h2><p class="muted">Pantau status, lengkapi berkas, dan ikuti tes seleksi.</p></div></div>
    <div class="card" style="margin-bottom:16px">
      <div class="muted small">Nomor pendaftaran</div><div style="font:700 22px Consolas,monospace">${esc(a.reg_number)}</div>
      <h3 style="margin:14px 0 4px;color:${tone}">${esc(title)}${a.test_score != null ? ` · Nilai tes ${Number(a.test_score).toFixed(2)}` : ''}</h3><p class="muted">${esc(desc)}</p>
      ${a.status === 'tidak_lolos' || a.status === 'mengundurkan_diri' ? '' : `<div style="display:flex;gap:6px;margin-top:12px">${FLOW.map((f, i) => `<div style="flex:1;height:6px;border-radius:3px;background:${i <= idx ? 'var(--primary,#E98532)' : 'var(--border,#eadfce)'}"></div>`).join('')}</div>`}
    </div>
    <div class="card" style="margin-bottom:16px" id="docs-card"></div>
    <div class="card" style="margin-bottom:16px" id="test-card"></div>
    <div class="card" style="margin-bottom:16px"><h3>Data Pendaftaran</h3>
      <div class="table-wrap"><table class="table"><tbody>
        <tr><th>Nama</th><td>${esc(a.full_name)}</td></tr>
        <tr><th>Email (terverifikasi)</th><td>${esc(a.email || '-')}</td></tr>
        <tr><th>Program studi</th><td>${esc(prog ? `${prog.level || ''} ${prog.name}`.trim() : '-')}</td></tr>
        <tr><th>Periode</th><td>${esc(a.pmb_periods?.name || '-')}</td></tr>
        <tr><th>Tanggal daftar</th><td>${fmtDate(a.created_at)}</td></tr></tbody></table></div></div>
    <div class="card"><h3>Riwayat Status</h3>
      ${(hist || []).length ? `<ul style="list-style:none;padding:0;margin:0">${hist.map((h) => `<li style="padding:8px 0;border-bottom:1px solid var(--border,#eee)"><b>${esc((STATUS[h.to_status] || [h.to_status])[0])}</b> <span class="muted small">· ${fmtDateTime(h.created_at)}${h.note ? ' · ' + esc(h.note) : ''}</span></li>`).join('')}</ul>` : emptyHTML('Belum ada riwayat.')}
    </div>`;
  drawDocs(a, docs || []);
  drawTest(a, e3 ? null : st, e3);
}

/* ---------- Berkas ---------- */
function drawDocs(a, docs) {
  const box = $('#docs-card');
  const locked = ['diterima', 'tidak_lolos', 'registrasi_ulang', 'mengundurkan_diri'].includes(a.status);
  box.innerHTML = `<h3>Berkas Persyaratan</h3><p class="muted small">PDF / PNG / JPG, maksimal 5 MB. Berkas bertanda * wajib dan harus diverifikasi Admin PMB sebelum Anda dapat mengikuti tes.</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Berkas</th><th>Status</th><th style="text-align:right">Aksi</th></tr></thead><tbody>
    ${DOCS.map(([k, name, req]) => {
      const mine = docs.filter((d) => d.doc_type === k);
      const okv = mine.some((d) => d.verified);
      const st = okv ? '<span class="badge ok">Terverifikasi</span>' : mine.length ? '<span class="badge">Menunggu verifikasi</span>' : `<span class="badge" style="opacity:.7">${req ? 'Belum diunggah' : 'Opsional'}</span>`;
      const note = mine.map((d) => d.note).filter(Boolean).join('; ');
      return `<tr><td>${esc(name)}${req ? ' *' : ''}${note ? `<div class="muted small">Catatan admin: ${esc(note)}</div>` : ''}</td><td>${st}</td>
        <td style="text-align:right;white-space:nowrap">${mine.map((d) => `<button class="btn btn-ghost btn-icon" data-view="${d.id}" title="Lihat"><i class="bi bi-eye"></i></button>${d.verified || locked ? '' : `<button class="btn btn-danger btn-icon" data-rm="${d.id}" title="Hapus"><i class="bi bi-trash"></i></button>`}`).join('')}
        ${okv || locked ? '' : `<label class="btn btn-secondary" style="cursor:pointer;margin:0"><i class="bi bi-upload"></i> Unggah<input type="file" data-up="${k}" accept=".pdf,.png,.jpg,.jpeg,.webp" hidden></label>`}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  const by = Object.fromEntries(docs.map((d) => [d.id, d]));
  $$('[data-view]', box).forEach((b) => b.addEventListener('click', async () => {
    const { data, error } = await sb.storage.from('academic').createSignedUrl(by[b.dataset.view].file_path, 120);
    if (error) fail(error); else window.open(data.signedUrl, '_blank', 'noopener');
  }));
  $$('[data-rm]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Hapus berkas ini?'))) return;
    const d = by[b.dataset.rm];
    const { error } = await sb.from('pmb_documents').delete().eq('id', d.id);
    if (error) return fail(error);
    await sb.storage.from('academic').remove([d.file_path]);
    ok('Berkas dihapus.'); main();
  }));
  $$('[data-up]', box).forEach((inp) => inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (f.size > 5 * 1048576) return fail('Ukuran file melebihi 5 MB.');
    if (!['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) return fail('Tipe file harus PDF/PNG/JPG/WEBP.');
    const path = `pmb/${a.id}/${crypto.randomUUID()}.${ext}`;
    const { error: e1 } = await sb.storage.from('academic').upload(path, f, { contentType: f.type || undefined });
    if (e1) return fail(e1);
    const { error: e2 } = await sb.from('pmb_documents').insert({ applicant_id: a.id, doc_type: inp.dataset.up, file_path: path, uploaded_by: ctx.user.id });
    if (e2) { await sb.storage.from('academic').remove([path]); return fail(e2); }
    ok('Berkas diunggah. Menunggu verifikasi Admin PMB.'); main();
  }));
}

/* ---------- Tes ---------- */
function drawTest(a, st, err) {
  const box = $('#test-card');
  if (err || !st) { box.innerHTML = `<h3>Tes Seleksi Online</h3>${errorHTML(err || 'Gagal memuat')}`; return; }
  const t = st.test, att = st.attempt;
  let body;
  if (att?.submitted_at) {
    const pass = att.passed;
    body = `<div style="text-align:center;padding:12px"><div class="muted">Nilai tes Anda</div>
      <div style="font:800 44px Poppins,sans-serif;color:${pass ? '#1f9d55' : '#c0392b'}">${Number(att.score).toFixed(2)}</div>
      <div style="font-weight:700;color:${pass ? '#1f9d55' : '#c0392b'}">${pass ? 'LULUS' : 'TIDAK LULUS'}</div>
      <p class="muted small" style="margin-top:8px">Aturan: lulus jika nilai lebih dari ${t ? Number(t.pass_score) : 75}; nilai ${t ? Number(t.pass_score) : 75} atau kurang dinyatakan tidak lulus. Dikirim ${fmtDateTime(att.submitted_at)}.</p></div>`;
  } else if (!t) {
    body = `<p class="muted">${REASON[st.reason] || 'Tes belum tersedia.'}</p>`;
  } else {
    const jadwal = t.scheduled_start ? `${fmtDateTime(t.scheduled_start)}${t.scheduled_end ? ' – ' + fmtDateTime(t.scheduled_end) : ''}` : 'Kapan saja selama tes dibuka';
    body = `<div class="table-wrap"><table class="table"><tbody>
      <tr><th>Tes</th><td>${esc(t.title)}</td></tr><tr><th>Jadwal</th><td>${esc(jadwal)}</td></tr>
      <tr><th>Durasi</th><td>${t.duration_minutes} menit · ${t.question_count} soal</td></tr>
      <tr><th>Syarat lulus</th><td>Nilai lebih dari ${Number(t.pass_score)}</td></tr></tbody></table></div>
      ${st.eligible ? `<button class="btn btn-primary" id="start-test" style="margin-top:12px"><i class="bi bi-play-fill"></i> ${att ? 'Lanjutkan Tes' : 'Mulai Tes'}</button>
        <p class="muted small" style="margin-top:8px">Waktu berjalan sejak tombol ditekan dan tidak bisa dijeda. Jawaban tersimpan otomatis; tes hanya bisa diikuti satu kali.</p>`
        : `<p style="margin-top:12px;color:#c0392b">${esc(REASON[st.reason] || '')}${st.reason === 'berkas' && st.missing_docs?.length ? ' Belum terverifikasi: ' + st.missing_docs.map((m) => DOCS.find((d) => d[0] === m)?.[1] || m).join(', ') + '.' : ''}</p>`}`;
  }
  box.innerHTML = `<h3>Tes Seleksi Online</h3>${body}`;
  $('#start-test', box)?.addEventListener('click', async (e) => {
    if (!att && !(await confirmDialog(`Mulai tes sekarang? Waktu ${t.duration_minutes} menit langsung berjalan dan tes tidak bisa diulang.`))) return;
    e.target.disabled = true;
    const { data, error } = await sb.rpc('pmb_test_start');
    if (error) { fail(error); e.target.disabled = false; return; }
    runTest(data, t);
  });
}

function runTest(d, t) {
  const answers = { ...(d.answers || {}) };
  const offset = new Date(d.server_now).getTime() - Date.now();
  const deadline = new Date(d.deadline).getTime();
  const qs = d.questions;
  let done = false;
  content.innerHTML = `<div class="card" style="position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div><b>${esc(t.title)}</b><div class="muted small" id="prog"></div></div>
      <div style="font:700 24px Consolas,monospace" id="clock">--:--</div></div>
    ${qs.map((q, i) => `<div class="card" style="margin-top:12px"><div style="font-weight:600;margin-bottom:8px">${i + 1}. ${esc(q.question)}</div>
      ${Object.entries(q.options).map(([k, v]) => `<label class="check" style="display:flex;gap:8px;padding:6px 0;cursor:pointer"><input type="radio" name="q_${q.id}" value="${k}" ${answers[q.id] === k ? 'checked' : ''}> <span><b>${k.toUpperCase()}.</b> ${esc(v)}</span></label>`).join('')}</div>`).join('')}
    <div style="margin:16px 0"><button class="btn btn-primary" id="finish"><i class="bi bi-check2-circle"></i> Kirim Jawaban</button></div>`;
  const upd = () => { $('#prog').textContent = `Terjawab ${Object.keys(answers).length} dari ${qs.length} soal`; };
  upd();
  const save = async () => { const { data } = await sb.rpc('pmb_test_save', { p_answers: answers }); if (data?.expired) finish(true); };
  $$('input[type=radio]', content).forEach((r) => r.addEventListener('change', () => {
    answers[r.name.slice(2)] = r.value; upd();
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 800);
  }));
  const finish = async (auto) => {
    if (done) return; done = true; clearInterval(timer); clearTimeout(saveTimer);
    const { data, error } = await sb.rpc('pmb_test_submit', { p_answers: answers });
    if (error) { done = false; fail(error); return; }
    window.removeEventListener('beforeunload', warn);
    ok(auto ? 'Waktu habis. Jawaban dikirim otomatis.' : 'Jawaban terkirim.');
    main();
  };
  const warn = (e) => { if (!done) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);
  $('#finish').addEventListener('click', async () => {
    const left = qs.length - Object.keys(answers).length;
    if (await confirmDialog(left ? `Masih ada ${left} soal belum dijawab. Kirim sekarang?` : 'Kirim jawaban sekarang? Tes tidak bisa diulang.')) finish(false);
  });
  const tick = () => {
    const ms = deadline - (Date.now() + offset);
    if (ms <= 0) { $('#clock').textContent = '00:00'; finish(true); return; }
    const s = Math.floor(ms / 1000);
    $('#clock').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    $('#clock').style.color = s < 60 ? '#c0392b' : '';
  };
  tick(); timer = setInterval(tick, 1000);
}

main();
