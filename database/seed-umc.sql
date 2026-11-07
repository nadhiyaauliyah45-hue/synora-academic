-- =====================================================================
-- seed-umc.sql — Fakultas & program studi Universitas Muhammadiyah Cirebon (data master, bukan data dummy)
-- Sumber: daftar yang Anda berikan (rujukan: pmb.umc.ac.id). Silakan periksa dan sesuaikan dengan SK resmi.
-- Aman dijalankan ulang. Jalankan SETELAH migrasi 020 (tabel faculties & study_programs).
-- =====================================================================
insert into public.faculties(code,name) values
 ('FH','Fakultas Ilmu Hukum'),('FIKES','Fakultas Ilmu Kesehatan'),('FISIP','Fakultas Ilmu Sosial dan Ilmu Politik'),
 ('FEB','Fakultas Ekonomi dan Bisnis'),('FKIP','Fakultas Keguruan dan Ilmu Pendidikan'),('FT','Fakultas Teknik'),
 ('FAI','Fakultas Agama Islam')
on conflict (code) do nothing;

with p(code,name,level,fac) as (values
 ('HK','Ilmu Hukum','S1','FH'),
 ('KEP','Ilmu Keperawatan','S1','FIKES'),('GIZI','Ilmu Gizi','S1','FIKES'),('OR','Ilmu Keolahragaan','S1','FIKES'),('NERS','Profesi Ners','Profesi','FIKES'),
 ('IKOM','Ilmu Komunikasi','S1','FISIP'),('IP','Ilmu Pemerintahan','S1','FISIP'),('HUMAS','Hubungan Masyarakat','D3','FISIP'),
 ('MNJ','Manajemen','S1','FEB'),('AK','Akuntansi','S1','FEB'),
 ('PGPAUD','Pendidikan Anak Usia Dini (PG-PAUD)','S1','FKIP'),('PGSD','Pendidikan Guru Sekolah Dasar (PGSD)','S1','FKIP'),
 ('PBI','Pendidikan Bahasa Inggris','S1','FKIP'),('PIPA','Pendidikan IPA','S1','FKIP'),('PKIM','Pendidikan Kimia','S1','FKIP'),('PMAT','Pendidikan Matematika','S1','FKIP'),
 ('TI','Teknik Informatika','S1','FT'),('TIN','Teknik Industri','S1','FT'),('PTK','Peternakan','S1','FT'),('TI-D3','Teknik Informatika','D3','FT'),
 ('IAT','Ilmu Al-Qur''an dan Tafsir','S1','FAI'),('TP','Tasawuf dan Psikoterapi','S1','FAI'))
insert into public.study_programs(code,name,level,faculty_id)
select p.code,p.name,p.level,(select id from public.faculties where code=p.fac) from p
on conflict (code) do update set faculty_id=coalesce(public.study_programs.faculty_id, excluded.faculty_id);
