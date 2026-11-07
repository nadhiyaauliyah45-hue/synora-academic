-- 040_finance.sql — tagihan & pembayaran (terpisah dari kas kelas `transactions`)
create table if not exists public.fee_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('pendaftaran','registrasi_ulang','ukt','praktikum','skripsi','lainnya')),
  amount numeric(14,2) not null check (amount >= 0), is_active boolean not null default true,
  created_at timestamptz not null default now());

create sequence if not exists public.invoice_seq;
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text unique,
  fee_type_id uuid references public.fee_types(id),
  description text not null,
  student_id uuid references public.students(id) on delete cascade,
  applicant_id uuid references public.pmb_applicants(id) on delete cascade,
  semester_id uuid references public.semesters(id),
  amount numeric(14,2) not null check (amount > 0), due_date date,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(),
  check (student_id is not null or applicant_id is not null));
create index if not exists ix_inv_student on public.invoices(student_id);
create index if not exists ix_inv_app on public.invoices(applicant_id);
create or replace function public.trg_invoice_no() returns trigger language plpgsql as $$
begin if new.number is null then new.number := 'INV-' || to_char(now(),'YYYYMM') || '-' || lpad(nextval('public.invoice_seq')::text,5,'0'); end if; return new; end $$;
drop trigger if exists invoice_no on public.invoices;
create trigger invoice_no before insert on public.invoices for each row execute function public.trg_invoice_no();

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  paid_at date not null default current_date, method text default 'transfer',
  proof_path text,
  status text not null default 'menunggu' check (status in ('menunggu','terverifikasi','ditolak')),
  note text, submitted_by uuid references auth.users(id),
  verified_by uuid references auth.users(id), verified_at timestamptz,
  created_at timestamptz not null default now());
create index if not exists ix_pay_inv on public.payments(invoice_id, status);

-- Status tagihan dihitung database (hanya pembayaran terverifikasi yang dihitung)
create or replace view public.v_invoices with (security_invoker=true) as
select i.*, coalesce(p.paid,0) as paid,
  i.amount - coalesce(p.paid,0) as remaining,
  case when coalesce(p.paid,0) >= i.amount then 'lunas' when coalesce(p.paid,0) > 0 then 'sebagian' else 'belum_bayar' end as pay_status,
  coalesce(p.pending,0) as pending_count
from public.invoices i
left join (select invoice_id,
   sum(amount) filter (where status='terverifikasi') paid,
   count(*) filter (where status='menunggu') pending
   from public.payments group by invoice_id) p on p.invoice_id = i.id;

create or replace function public.verify_payment(p_payment uuid, p_ok boolean, p_note text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.fin_of_program(public.program_of_payment(p_payment)) then raise exception 'Tidak berhak memverifikasi pembayaran'; end if;
  if not p_ok and coalesce(trim(p_note),'')='' then raise exception 'Alasan penolakan wajib diisi'; end if;
  update public.payments set status = case when p_ok then 'terverifikasi' else 'ditolak' end,
    verified_by=auth.uid(), verified_at=now(), note=p_note
  where id=p_payment and status='menunggu';
  if not found then raise exception 'Pembayaran tidak ditemukan atau sudah diproses'; end if;
end $$;
revoke all on function public.verify_payment(uuid,boolean,text) from public, anon;
grant execute on function public.verify_payment(uuid,boolean,text) to authenticated;
