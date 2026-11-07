-- 050_akademik.sql — KRS, nilai, KHS/transkrip
create table if not exists public.krs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  semester_id uuid not null references public.semesters(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','diajukan','disetujui','ditolak')),
  submitted_at timestamptz, decided_by uuid references auth.users(id), decided_at timestamptz, note text,
  created_at timestamptz not null default now(),
  unique (student_id, semester_id));
create table if not exists public.krs_items (
  id uuid primary key default gen_random_uuid(),
  krs_id uuid not null references public.krs(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete restrict,
  unique (krs_id, course_id));
create index if not exists ix_ki_course on public.krs_items(course_id);

create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  krs_item_id uuid not null unique references public.krs_items(id) on delete cascade,
  attendance_score numeric(5,2) check (attendance_score between 0 and 100),
  assignment_score numeric(5,2) check (assignment_score between 0 and 100),
  mid_score numeric(5,2) check (mid_score between 0 and 100),
  final_score numeric(5,2) check (final_score between 0 and 100),
  is_final boolean not null default false,
  entered_by uuid references auth.users(id), updated_at timestamptz not null default now());

-- Batas SKS per KRS (maks 24)
create or replace function public.trg_krs_sks() returns trigger language plpgsql as $$
declare tot int;
begin
  select coalesce(sum(c.sks),0) + (select sks from public.courses where id=new.course_id) into tot
  from public.krs_items i join public.courses c on c.id=i.course_id where i.krs_id=new.krs_id and i.id is distinct from new.id;
  if tot > 24 then raise exception 'Total SKS KRS tidak boleh lebih dari 24 (menjadi %)', tot; end if;
  return new; end $$;
drop trigger if exists krs_sks on public.krs_items;
create trigger krs_sks before insert on public.krs_items for each row execute function public.trg_krs_sks();

-- Nilai: bobot kehadiran 10%, tugas 20%, UTS 30%, UAS 40%. Skala: A>=85(4), AB>=80(3.5), B>=70(3), BC>=65(2.5), C>=55(2), D>=40(1), E(0).
create or replace view public.v_grades with (security_invoker=true) as
select g.id grade_id, k.student_id, k.semester_id, i.id krs_item_id, c.id course_id, c.code, c.name course_name, c.sks,
  g.is_final, g.attendance_score, g.assignment_score, g.mid_score, g.final_score,
  t.total,
  case when t.total is null then null when t.total>=85 then 'A' when t.total>=80 then 'AB' when t.total>=70 then 'B'
       when t.total>=65 then 'BC' when t.total>=55 then 'C' when t.total>=40 then 'D' else 'E' end as letter,
  case when t.total is null then null when t.total>=85 then 4.0 when t.total>=80 then 3.5 when t.total>=70 then 3.0
       when t.total>=65 then 2.5 when t.total>=55 then 2.0 when t.total>=40 then 1.0 else 0 end as points
from public.krs_items i
join public.krs k on k.id=i.krs_id and k.status='disetujui'
join public.courses c on c.id=i.course_id
left join public.grades g on g.krs_item_id=i.id
left join lateral (select case when g.id is null or g.attendance_score is null or g.assignment_score is null or g.mid_score is null or g.final_score is null then null
   else round(0.1*g.attendance_score+0.2*g.assignment_score+0.3*g.mid_score+0.4*g.final_score,2) end as total) t on true;

-- Hanya nilai yang sudah difinalisasi dihitung ke IPS/IPK
create or replace view public.v_khs with (security_invoker=true) as
select student_id, semester_id, sum(sks)::int sks, round(sum(points*sks)/nullif(sum(sks),0),2) ips
from public.v_grades where is_final and points is not null group by student_id, semester_id;
create or replace view public.v_ipk with (security_invoker=true) as
select student_id, sum(sks)::int total_sks, round(sum(points*sks)/nullif(sum(sks),0),2) ipk
from public.v_grades where is_final and points is not null group by student_id;

create or replace function public.krs_decide(p_krs uuid, p_ok boolean, p_note text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not (public.staff_of_student(public.student_of_krs(p_krs)) or exists (select 1 from public.krs k join public.students s on s.id=k.student_id
      join public.class_members m on m.student_id=s.id join public.classes c on c.id=m.class_id
      where k.id=p_krs and c.advisor_id = public.my_lecturer_id())) then raise exception 'Tidak berhak memutuskan KRS'; end if;
  if not p_ok and coalesce(trim(p_note),'')='' then raise exception 'Catatan wajib diisi saat menolak KRS'; end if;
  update public.krs set status = case when p_ok then 'disetujui' else 'ditolak' end, decided_by=auth.uid(), decided_at=now(), note=p_note
  where id=p_krs and status='diajukan';
  if not found then raise exception 'KRS tidak berstatus diajukan'; end if;
end $$;
revoke all on function public.krs_decide(uuid,boolean,text) from public, anon;
grant execute on function public.krs_decide(uuid,boolean,text) to authenticated;
