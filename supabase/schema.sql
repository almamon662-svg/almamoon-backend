
-- ALMAMOON DATABASE

create extension if not exists pgcrypto;

-- PRODUCTS TABLE
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  price numeric(10,2) not null,
  currency text default 'BDT',
  image_url text,
  pdf_path text not null,
  active boolean default true,
  created_at timestamptz default now()
);

-- ORDERS TABLE
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  tran_id text unique not null,
  product_id uuid references public.products(id),
  amount numeric(10,2) not null,
  currency text default 'BDT',
  customer_name text not null,
  customer_email text not null,
  status text default 'PENDING'
    check (status in ('PENDING', 'PAID', 'FAILED', 'CANCELLED')),
  created_at timestamptz default now()
);

-- INDEXES
create index if not exists orders_tran_id_idx
on public.orders(tran_id);

create index if not exists orders_email_idx
on public.orders(customer_email);

-- ENABLE ROW LEVEL SECURITY
alter table public.products enable row level security;
alter table public.orders enable row level security;

-- PUBLIC CAN VIEW ACTIVE PRODUCTS
create policy "Anyone can view active products"
on public.products
for select
to anon, authenticated
using (active = true);

-- No public order access policies.
-- Backend uses service role key securely.
