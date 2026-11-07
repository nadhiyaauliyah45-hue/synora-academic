-- =====================================================================
-- SYNORA — schema.sql
-- Urutan eksekusi: schema.sql -> relationships.sql -> rls-policies.sql -> seed.sql
-- Jalankan di Supabase Dashboard > SQL Editor.
-- File ini membuat tabel, primary key, unique constraint, dan validasi (CHECK).
-- Foreign key, index, trigger, dan view ada di relationships.sql.
-- =====================================================================

create extension if not exists pgcrypto;

-- 1. profiles : satu baris per akun auth.users -------------------------
create table if not exists public.profiles (
  id          uuid primary key,
  nim         text not null unique check (nim ~ '^[A-Za-z0-9._-]{3,30}$'),
  full_name   text not null check (char_length(full_name) between 2 and 120),
  avatar_url  text,
  avatar_path text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2. user_roles : role tiap akun ---------------------------------------
create table if not exists public.user_roles (
  user_id    uuid primary key,
  role       text not null check (role in ('km','sekretaris','bendahara','dosen')),
  created_at timestamptz not null default now()
);

-- 3. students : data inti anggota kelas TI24D --------------------------
create table if not exists public.students (
  id            uuid primary key default gen_random_uuid(),
  nim           text not null unique check (char_length(nim) between 3 and 30),
  full_name     text not null check (char_length(full_name) between 2 and 120),
  program_studi text not null default 'Teknik Informatika',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 4. lecturers : kontak dosen -------------------------------------------
create table if not exists public.lecturers (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null check (char_length(full_name) between 2 and 120),
  nidn        text,
  email       text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone       text,
  photo_url   text,
  photo_path  text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 5. courses : mata kuliah ----------------------------------------------
create table if not exists public.courses (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  name            text not null,
  sks             smallint not null default 2 check (sks between 1 and 6),
  lecturer_id     uuid,
  room            text,
  semester        text,
  description     text,
  assignment_info text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 6. schedules : jadwal kuliah mingguan (1 = Senin ... 7 = Minggu) -----
create table if not exists public.schedules (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  start_time  time not null,
  end_time    time not null,
  room        text,
  created_at  timestamptz not null default now(),
  check (end_time > start_time)
);

-- 7. attendance : satu pertemuan ----------------------------------------
create table if not exists public.attendance (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null,
  lecturer_id  uuid,
  meeting_date date not null,
  topic        text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (course_id, meeting_date)
);

-- 8. attendance_details : status tiap mahasiswa pada satu pertemuan -----
create table if not exists public.attendance_details (
  id            uuid primary key default gen_random_uuid(),
  attendance_id uuid not null,
  student_id    uuid not null,
  status        text not null check (status in ('hadir','izin','sakit','alfa')),
  note          text,
  unique (attendance_id, student_id)
);

-- 9. finance_categories --------------------------------------------------
create table if not exists public.finance_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 60),
  type       text not null check (type in ('pemasukan','pengeluaran')),
  created_at timestamptz not null default now(),
  unique (name, type)
);

-- 10. inventory ------------------------------------------------------------
create table if not exists public.inventory (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 2 and 120),
  category      text,
  quantity      integer not null default 1 check (quantity >= 0),
  condition     text not null default 'baik' check (condition in ('baik','cukup','rusak')),
  purchase_date date,
  notes         text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 11. transactions : SALDO TIDAK DISIMPAN, selalu dihitung dari tabel ini
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  type         text not null check (type in ('pemasukan','pengeluaran')),
  amount       numeric(14,2) not null check (amount > 0),
  category_id  uuid,
  trx_date     date not null default current_date,
  description  text,
  proof_path   text,
  inventory_id uuid,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 12. inventory_history : riwayat perubahan inventaris (diisi trigger) ----
create table if not exists public.inventory_history (
  id           uuid primary key default gen_random_uuid(),
  inventory_id uuid,
  item_name    text,
  action       text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data     jsonb,
  new_data     jsonb,
  changed_by   uuid,
  changed_at   timestamptz not null default now()
);

-- 13. documents : perpustakaan & arsip -------------------------------------
create table if not exists public.documents (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null check (char_length(title) between 2 and 200),
  kind                 text not null check (kind in ('file','link')),
  course_id            uuid,
  description          text,
  file_path            text,
  file_name            text,
  mime_type            text,
  file_size            bigint,
  link_url             text,
  visible_to_lecturers boolean not null default true,
  uploaded_by          uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((kind = 'file' and file_path is not null) or (kind = 'link' and link_url is not null))
);

-- 14. memories_profiles : profil diperluas anggota (1:1 dengan students) ---
create table if not exists public.memories_profiles (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null unique,
  photo_url     text,
  photo_path    text,
  origin        text,
  hobby         text,
  interests     text,
  favorite_song text,
  bio           text,
  extra         jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 15. academic_events -------------------------------------------------------
create table if not exists public.academic_events (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (char_length(title) between 2 and 200),
  category       text not null check (category in ('kuliah','uts','uas','tugas','presentasi','kelas','kampus','penting')),
  start_at       timestamptz not null,
  end_at         timestamptz,
  all_day        boolean not null default false,
  location       text,
  description    text,
  course_id      uuid,
  remind_minutes integer check (remind_minutes is null or remind_minutes >= 0),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_at is null or end_at >= start_at)
);

-- 16. announcements ---------------------------------------------------------
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 2 and 200),
  body       text not null,
  course_id  uuid,
  pinned     boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 17. chat_rooms ------------------------------------------------------------
create table if not exists public.chat_rooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 80),
  description text,
  kind        text not null check (kind in ('pengurus','dosen_pengurus')),
  created_by  uuid,
  created_at  timestamptz not null default now()
);

-- 18. chat_messages ---------------------------------------------------------
create table if not exists public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null,
  sender_id       uuid not null,
  body            text check (body is null or char_length(body) <= 4000),
  attachment_path text,
  attachment_name text,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  check (body is not null or attachment_path is not null)
);

-- 19. spin_history ----------------------------------------------------------
create table if not exists public.spin_history (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  total_students integer not null check (total_students > 0),
  num_groups     integer not null check (num_groups > 0),
  created_by     uuid,
  created_at     timestamptz not null default now()
);

-- 20. groups ----------------------------------------------------------------
create table if not exists public.groups (
  id       uuid primary key default gen_random_uuid(),
  spin_id  uuid not null,
  group_no integer not null check (group_no > 0),
  name     text not null,
  unique (spin_id, group_no)
);

-- 21. group_members ---------------------------------------------------------
create table if not exists public.group_members (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null,
  student_id uuid not null,
  unique (group_id, student_id)
);

-- 22. notifications ---------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  title      text not null,
  body       text,
  link       text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

-- 23. app_settings : pengaturan global (background aktif, playlist musik) -
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
