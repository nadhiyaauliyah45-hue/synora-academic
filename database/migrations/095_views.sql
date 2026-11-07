-- 095_views.sql — laporan Kaprodi (semua dihitung dari database; security_invoker => RLS pemanggil berlaku)
-- Definisi: TERDAFTAR = status mahasiswa_baru ke atas (calon..registrasi_ulang tidak dihitung).
-- BELUM LULUS bukan gagal. Batas tepat waktu = 4 tahun (app_settings.graduation_rules.max_years_on_time).
create or replace view public.v_lifecycle_summary with (security_invoker=true) as
select status_akademik, count(*)::int as total from public.students group by status_akademik;

create or replace view public.v_cohort_graduation with (security_invoker=true) as
with r as (select coalesce((value->>'max_years_on_time')::int,4) yrs from public.app_settings where key='graduation_rules')
select s.angkatan,
  count(*)::int as terdaftar,
  count(*) filter (where s.status_akademik in ('lulus','alumni'))::int as lulus,
  count(*) filter (where s.status_akademik='mengundurkan_diri')::int as resign,
  count(*) filter (where s.status_akademik='do')::int as do_count,
  count(*) filter (where s.status_akademik in ('aktif','cuti','nonaktif','proses_penyelesaian','mengajukan_kelulusan','belum_memenuhi_syarat','mahasiswa_baru'))::int as belum_lulus,
  count(*) filter (where s.status_akademik='cuti')::int as cuti,
  round(100.0*count(*) filter (where s.status_akademik in ('lulus','alumni'))/nullif(count(*),0),1) as pct_lulus_dari_terdaftar,
  round(100.0*count(*) filter (where s.status_akademik in ('lulus','alumni'))
     /nullif(count(*) filter (where s.status_akademik in ('lulus','alumni','mengundurkan_diri','do')),0),1) as pct_lulus_dari_selesai,
  round(avg(g.ipk),2) as rata_ipk,
  round(avg((g.graduation_date - s.tanggal_masuk)/30.4375),1) as rata_masa_studi_bulan,
  count(*) filter (where g.graduation_date is not null and g.graduation_date <= s.tanggal_masuk + make_interval(years => (select yrs from r)))::int as lulus_tepat_waktu,
  count(*) filter (where g.graduation_date is not null and g.graduation_date >  s.tanggal_masuk + make_interval(years => (select yrs from r)))::int as lulus_terlambat
from public.students s left join public.student_graduation g on g.student_id=s.id
where s.status_akademik not in ('calon','pendaftar','peserta_seleksi','diterima','registrasi_ulang') and s.angkatan is not null
group by s.angkatan;

create or replace view public.v_graduation_yearly with (security_invoker=true) as
select extract(year from g.graduation_date)::int as tahun, count(*)::int as lulusan, round(avg(g.ipk),2) as rata_ipk,
  round(avg((g.graduation_date - s.tanggal_masuk)/30.4375),1) as rata_masa_studi_bulan
from public.student_graduation g join public.students s on s.id=g.student_id group by 1;

create or replace view public.v_ipk_distribution with (security_invoker=true) as
select case when ipk>=3.5 then '3,50 - 4,00' when ipk>=3.0 then '3,00 - 3,49' when ipk>=2.5 then '2,50 - 2,99' else '< 2,50' end as rentang,
  count(*)::int as jumlah from public.student_graduation where ipk is not null group by 1;

create or replace view public.v_pmb_summary with (security_invoker=true) as
select p.id period_id, p.name, p.quota,
  count(a.id)::int as pendaftar,
  count(a.id) filter (where a.status in ('peserta_seleksi','diterima','registrasi_ulang'))::int as ikut_seleksi,
  count(a.id) filter (where a.status in ('diterima','registrasi_ulang'))::int as diterima,
  count(a.id) filter (where a.status='tidak_lolos')::int as tidak_lolos,
  count(a.id) filter (where a.status='mengundurkan_diri')::int as mengundurkan_diri,
  count(a.id) filter (where a.status='registrasi_ulang')::int as registrasi_ulang,
  p.program_id
from public.pmb_periods p left join public.pmb_applicants a on a.period_id=p.id group by p.id;

create or replace view public.v_finance_student_summary with (security_invoker=true) as
select to_char(date_trunc('month', coalesce(py.verified_at, py.created_at)),'YYYY-MM') bulan,
  sum(py.amount) filter (where py.status='terverifikasi') as diterima,
  count(*) filter (where py.status='menunggu')::int as menunggu
from public.payments py group by 1;

-- Varian per prodi (dipakai filter Fakultas/Prodi di dashboard)
create or replace view public.v_lifecycle_summary_p with (security_invoker=true) as
select program_id, status_akademik, count(*)::int as total from public.students group by program_id, status_akademik;

create or replace view public.v_cohort_graduation_p with (security_invoker=true) as
with r as (select coalesce((value->>'max_years_on_time')::int,4) yrs from public.app_settings where key='graduation_rules')
select s.program_id, s.angkatan,
  count(*)::int as terdaftar,
  count(*) filter (where s.status_akademik in ('lulus','alumni'))::int as lulus,
  count(*) filter (where s.status_akademik='mengundurkan_diri')::int as resign,
  count(*) filter (where s.status_akademik='do')::int as do_count,
  count(*) filter (where s.status_akademik in ('aktif','cuti','nonaktif','proses_penyelesaian','mengajukan_kelulusan','belum_memenuhi_syarat','mahasiswa_baru'))::int as belum_lulus,
  count(*) filter (where s.status_akademik='cuti')::int as cuti,
  round(100.0*count(*) filter (where s.status_akademik in ('lulus','alumni'))/nullif(count(*),0),1) as pct_lulus_dari_terdaftar,
  round(100.0*count(*) filter (where s.status_akademik in ('lulus','alumni'))
     /nullif(count(*) filter (where s.status_akademik in ('lulus','alumni','mengundurkan_diri','do')),0),1) as pct_lulus_dari_selesai,
  round(avg(g.ipk),2) as rata_ipk,
  round(avg((g.graduation_date - s.tanggal_masuk)/30.4375),1) as rata_masa_studi_bulan,
  count(*) filter (where g.graduation_date is not null and g.graduation_date <= s.tanggal_masuk + make_interval(years => (select yrs from r)))::int as lulus_tepat_waktu,
  count(*) filter (where g.graduation_date is not null and g.graduation_date >  s.tanggal_masuk + make_interval(years => (select yrs from r)))::int as lulus_terlambat
from public.students s left join public.student_graduation g on g.student_id=s.id
where s.status_akademik not in ('calon','pendaftar','peserta_seleksi','diterima','registrasi_ulang') and s.angkatan is not null
group by s.program_id, s.angkatan;

create or replace view public.v_graduation_yearly_p with (security_invoker=true) as
select s.program_id, extract(year from g.graduation_date)::int as tahun, count(*)::int as lulusan, round(avg(g.ipk),2) as rata_ipk,
  round(avg((g.graduation_date - s.tanggal_masuk)/30.4375),1) as rata_masa_studi_bulan
from public.student_graduation g join public.students s on s.id=g.student_id group by 1, 2;

create or replace view public.v_ipk_distribution_p with (security_invoker=true) as
select s.program_id, case when g.ipk>=3.5 then '3,50 - 4,00' when g.ipk>=3.0 then '3,00 - 3,49' when g.ipk>=2.5 then '2,50 - 2,99' else '< 2,50' end as rentang,
  count(*)::int as jumlah from public.student_graduation g join public.students s on s.id=g.student_id where g.ipk is not null group by 1, 2;

create or replace view public.v_program_summary with (security_invoker=true) as
select sp.id program_id, sp.code, sp.name program_name, sp.level, f.id faculty_id, f.name faculty_name,
  count(s.id) filter (where s.status_akademik not in ('calon','pendaftar','peserta_seleksi','diterima','registrasi_ulang'))::int as terdaftar,
  count(s.id) filter (where s.status_akademik in ('mahasiswa_baru','aktif'))::int as aktif,
  count(s.id) filter (where s.status_akademik in ('lulus','alumni'))::int as lulus,
  round(100.0*count(s.id) filter (where s.status_akademik in ('lulus','alumni'))
     /nullif(count(s.id) filter (where s.status_akademik not in ('calon','pendaftar','peserta_seleksi','diterima','registrasi_ulang')),0),1) as pct_lulus_dari_terdaftar
from public.study_programs sp left join public.faculties f on f.id=sp.faculty_id left join public.students s on s.program_id=sp.id
where public.program_in_scope(sp.id) group by sp.id, f.id order by f.name, sp.name;

grant select on public.v_class_roster, public.v_invoices, public.v_grades, public.v_khs, public.v_ipk, public.v_lifecycle_summary,
  public.v_cohort_graduation, public.v_graduation_yearly, public.v_ipk_distribution, public.v_pmb_summary, public.v_finance_student_summary,
  public.v_lifecycle_summary_p, public.v_cohort_graduation_p, public.v_graduation_yearly_p, public.v_ipk_distribution_p, public.v_program_summary to authenticated;
