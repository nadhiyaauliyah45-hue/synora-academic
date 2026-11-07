-- 085_rpc_extra.sql — fungsi pendukung KRS, skripsi, bimbingan
create or replace function public.krs_submit(p_krs uuid) returns void language plpgsql security definer set search_path=public as $$
declare n int;
begin
  if not exists (select 1 from public.krs where id=p_krs and student_id=public.my_student_id()) then raise exception 'KRS bukan milik Anda'; end if;
  select count(*) into n from public.krs_items where krs_id=p_krs;
  if n=0 then raise exception 'KRS masih kosong'; end if;
  update public.krs set status='diajukan', submitted_at=now(), note=null where id=p_krs and status in ('draft','ditolak');
  if not found then raise exception 'KRS tidak dapat diajukan pada status saat ini'; end if;
end $$;
grant execute on function public.krs_submit(uuid) to authenticated;

create or replace function public.thesis_resubmit(p_thesis uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_thesis_owner(p_thesis) then raise exception 'Bukan skripsi Anda'; end if;
  update public.thesis set status='diajukan', updated_at=now() where id=p_thesis and status='revisi_judul';
  if not found then raise exception 'Skripsi tidak berstatus revisi judul'; end if;
end $$;
grant execute on function public.thesis_resubmit(uuid) to authenticated;

create or replace function public.guidance_review(p_id uuid, p_status text, p_note text) returns void language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
  select thesis_id into t from public.thesis_guidance where id=p_id;
  if t is null or not (public.is_thesis_supervisor(t) or public.staff_of_student(public.student_of_thesis(t))) then raise exception 'Tidak berhak'; end if;
  if p_status not in ('disetujui','revisi') then raise exception 'Status tidak valid'; end if;
  update public.thesis_guidance set status=p_status, lecturer_note=p_note, lecturer_id=coalesce(public.my_lecturer_id(),lecturer_id) where id=p_id;
end $$;
grant execute on function public.guidance_review(uuid,text,text) to authenticated;

create or replace function public.set_final_grade(p_item uuid, p_att numeric, p_asg numeric, p_mid numeric, p_fin numeric, p_final boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not (public.staff_of_student(public.student_of_item(p_item)) or public.lecturer_teaches_item(p_item)) then raise exception 'Anda bukan pengampu mata kuliah ini'; end if;
  if p_final and (p_att is null or p_asg is null or p_mid is null or p_fin is null) then raise exception 'Semua komponen nilai harus diisi sebelum finalisasi'; end if;
  insert into public.grades(krs_item_id,attendance_score,assignment_score,mid_score,final_score,is_final,entered_by,updated_at)
  values (p_item,p_att,p_asg,p_mid,p_fin,p_final,auth.uid(),now())
  on conflict (krs_item_id) do update set attendance_score=excluded.attendance_score, assignment_score=excluded.assignment_score,
    mid_score=excluded.mid_score, final_score=excluded.final_score, is_final=excluded.is_final, entered_by=auth.uid(), updated_at=now()
  where public.grades.is_final = false or public.staff_of_student(public.student_of_item(p_item));
end $$;
grant execute on function public.set_final_grade(uuid,numeric,numeric,numeric,numeric,boolean) to authenticated;
