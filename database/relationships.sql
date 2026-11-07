-- =====================================================================
-- SYNORA — relationships.sql
-- Foreign key, index, trigger, dan view. Jalankan SETELAH schema.sql.
-- =====================================================================

-- ---------- FOREIGN KEYS ------------------------------------------------
do $$
declare
  fk record;
begin
  for fk in select * from (values
    ('profiles','profiles_auth_fk','foreign key (id) references auth.users(id) on delete cascade'),
    ('user_roles','user_roles_user_fk','foreign key (user_id) references public.profiles(id) on delete cascade'),
    ('courses','courses_lecturer_fk','foreign key (lecturer_id) references public.lecturers(id) on delete set null'),
    ('schedules','schedules_course_fk','foreign key (course_id) references public.courses(id) on delete cascade'),
    ('attendance','attendance_course_fk','foreign key (course_id) references public.courses(id) on delete cascade'),
    ('attendance','attendance_lecturer_fk','foreign key (lecturer_id) references public.lecturers(id) on delete set null'),
    ('attendance','attendance_creator_fk','foreign key (created_by) references public.profiles(id) on delete set null'),
    ('attendance_details','att_details_att_fk','foreign key (attendance_id) references public.attendance(id) on delete cascade'),
    ('attendance_details','att_details_student_fk','foreign key (student_id) references public.students(id) on delete cascade'),
    ('inventory','inventory_creator_fk','foreign key (created_by) references public.profiles(id) on delete set null'),
    ('transactions','transactions_category_fk','foreign key (category_id) references public.finance_categories(id) on delete set null'),
    ('transactions','transactions_inventory_fk','foreign key (inventory_id) references public.inventory(id) on delete set null'),
    ('transactions','transactions_creator_fk','foreign key (created_by) references public.profiles(id) on delete set null'),
    ('inventory_history','inv_history_user_fk','foreign key (changed_by) references public.profiles(id) on delete set null'),
    ('documents','documents_course_fk','foreign key (course_id) references public.courses(id) on delete set null'),
    ('documents','documents_uploader_fk','foreign key (uploaded_by) references public.profiles(id) on delete set null'),
    ('memories_profiles','memories_student_fk','foreign key (student_id) references public.students(id) on delete cascade'),
    ('academic_events','events_course_fk','foreign key (course_id) references public.courses(id) on delete set null'),
    ('academic_events','events_creator_fk','foreign key (created_by) references public.profiles(id) on delete set null'),
    ('announcements','announcements_course_fk','foreign key (course_id) references public.courses(id) on delete set null'),
    ('announcements','announcements_creator_fk','foreign key (created_by) references public.profiles(id) on delete set null'),
    ('chat_rooms','chat_rooms_creator_fk','foreign key (created_by) references public.profiles(id) on delete set null'),
    ('chat_messages','chat_messages_room_fk','foreign key (room_id) references public.chat_rooms(id) on delete cascade'),
    ('chat_messages','chat_messages_sender_fk','foreign key (sender_id) references public.profiles(id) on delete cascade'),
    ('spin_history','spin_creator_fk','foreign key (created_by) references public.profiles(id) on delete set null'),
    ('groups','groups_spin_fk','foreign key (spin_id) references public.spin_history(id) on delete cascade'),
    ('group_members','group_members_group_fk','foreign key (group_id) references public.groups(id) on delete cascade'),
    ('group_members','group_members_student_fk','foreign key (student_id) references public.students(id) on delete cascade'),
    ('notifications','notifications_user_fk','foreign key (user_id) references public.profiles(id) on delete cascade'),
    ('app_settings','app_settings_user_fk','foreign key (updated_by) references public.profiles(id) on delete set null')
  ) as t(tbl, cname, def)
  loop
    if not exists (select 1 from pg_constraint where conname = fk.cname) then
      execute format('alter table public.%I add constraint %I %s', fk.tbl, fk.cname, fk.def);
    end if;
  end loop;
end $$;

-- ---------- INDEXES -----------------------------------------------------
create index if not exists idx_courses_lecturer      on public.courses(lecturer_id);
create index if not exists idx_schedules_course      on public.schedules(course_id);
create index if not exists idx_schedules_day         on public.schedules(day_of_week);
create index if not exists idx_attendance_date       on public.attendance(meeting_date desc);
create index if not exists idx_attendance_course     on public.attendance(course_id);
create index if not exists idx_att_details_att       on public.attendance_details(attendance_id);
create index if not exists idx_att_details_student   on public.attendance_details(student_id);
create index if not exists idx_transactions_date     on public.transactions(trx_date desc);
create index if not exists idx_transactions_category on public.transactions(category_id);
create index if not exists idx_inventory_history_inv on public.inventory_history(inventory_id, changed_at desc);
create index if not exists idx_documents_course      on public.documents(course_id);
create index if not exists idx_documents_created     on public.documents(created_at desc);
create index if not exists idx_events_start          on public.academic_events(start_at);
create index if not exists idx_announcements_created on public.announcements(created_at desc);
create index if not exists idx_chat_messages_room    on public.chat_messages(room_id, created_at);
create index if not exists idx_group_members_group   on public.group_members(group_id);
create index if not exists idx_notifications_user    on public.notifications(user_id, is_read, created_at desc);

-- ---------- TRIGGER: updated_at ------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','students','lecturers','courses','attendance','inventory',
                           'transactions','documents','memories_profiles','academic_events',
                           'announcements','app_settings']
  loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------- TRIGGER: riwayat perubahan inventaris ------------------------
create or replace function public.inventory_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.inventory_history(inventory_id, item_name, action, new_data, changed_by)
    values (new.id, new.name, 'INSERT', to_jsonb(new), auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.inventory_history(inventory_id, item_name, action, old_data, new_data, changed_by)
    values (new.id, new.name, 'UPDATE', to_jsonb(old), to_jsonb(new), auth.uid());
    return new;
  else
    insert into public.inventory_history(inventory_id, item_name, action, old_data, changed_by)
    values (old.id, old.name, 'DELETE', to_jsonb(old), auth.uid());
    return old;
  end if;
end $$;

drop trigger if exists trg_inventory_audit on public.inventory;
create trigger trg_inventory_audit after insert or update or delete on public.inventory
  for each row execute function public.inventory_audit();

-- ---------- TRIGGER: notifikasi pengumuman & pesan baru --------------------
create or replace function public.notify_announcement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications(user_id, title, body, link)
  select p.id, 'Pengumuman baru', new.title, 'communication'
  from public.profiles p
  where p.is_active and p.id is distinct from new.created_by;
  return new;
end $$;

drop trigger if exists trg_notify_announcement on public.announcements;
create trigger trg_notify_announcement after insert on public.announcements
  for each row execute function public.notify_announcement();

create or replace function public.notify_chat_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  room public.chat_rooms;
  sender_name text;
begin
  select * into room from public.chat_rooms where id = new.room_id;
  select full_name into sender_name from public.profiles where id = new.sender_id;
  insert into public.notifications(user_id, title, body, link)
  select p.id,
         'Pesan baru di ' || room.name,
         coalesce(sender_name,'Seseorang') || ': ' || left(coalesce(new.body, 'mengirim lampiran'), 80),
         'communication'
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id
  where p.is_active
    and p.id <> new.sender_id
    and (
      (room.kind = 'pengurus'        and ur.role in ('km','sekretaris','bendahara')) or
      (room.kind = 'dosen_pengurus'  and ur.role in ('km','sekretaris','bendahara','dosen'))
    );
  return new;
end $$;

drop trigger if exists trg_notify_chat on public.chat_messages;
create trigger trg_notify_chat after insert on public.chat_messages
  for each row execute function public.notify_chat_message();

-- ---------- VIEW KEUANGAN (saldo selalu dihitung, tidak pernah disimpan) -----
-- security_invoker = true  => RLS tabel transactions tetap berlaku untuk pemanggil.
create or replace view public.v_finance_summary with (security_invoker = true) as
select
  coalesce(sum(amount) filter (where type = 'pemasukan'), 0)   as total_income,
  coalesce(sum(amount) filter (where type = 'pengeluaran'), 0) as total_expense,
  coalesce(sum(amount) filter (where type = 'pemasukan'), 0)
    - coalesce(sum(amount) filter (where type = 'pengeluaran'), 0) as balance
from public.transactions;

create or replace view public.v_finance_monthly with (security_invoker = true) as
select
  date_trunc('month', trx_date)::date as month,
  coalesce(sum(amount) filter (where type = 'pemasukan'), 0)   as income,
  coalesce(sum(amount) filter (where type = 'pengeluaran'), 0) as expense
from public.transactions
group by 1
order by 1;

-- ---------- REALTIME ----------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.chat_messages;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.notifications;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.app_settings;   exception when duplicate_object then null; end;
end $$;
