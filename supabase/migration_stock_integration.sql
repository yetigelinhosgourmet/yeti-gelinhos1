-- Campos e RPC para pedidos públicos do cardápio.
-- Execute este arquivo no Supabase do cardápio antes de publicar a integração.

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending',
  fulfillment_method text not null default 'Retirada',
  delivery_fee numeric(10,2) not null default 0,
  subtotal numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  unit_price numeric(10,2) not null default 0,
  quantity integer not null check (quantity > 0)
);

alter table public.orders add column if not exists status text;
alter table public.orders add column if not exists fulfillment_method text;
alter table public.orders add column if not exists delivery_fee numeric(10,2);
alter table public.orders add column if not exists subtotal numeric(10,2);
alter table public.orders add column if not exists total numeric(10,2);
alter table public.orders add column if not exists created_at timestamptz;
alter table public.orders add column if not exists confirmed_at timestamptz;
alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders add column if not exists customer_name text;
alter table public.orders add column if not exists customer_phone text;
alter table public.orders add column if not exists delivery_address text;
alter table public.orders add column if not exists notes text;
alter table public.orders drop constraint if exists orders_status_check;

update public.orders set status = 'pending' where status is null;
update public.orders set fulfillment_method = 'Retirada' where fulfillment_method is null;
update public.orders set delivery_fee = 0 where delivery_fee is null;
update public.orders set subtotal = 0 where subtotal is null;
update public.orders set total = 0 where total is null;
update public.orders set created_at = now() where created_at is null;
alter table public.orders alter column status set default 'pending';
alter table public.orders alter column status set not null;
alter table public.orders alter column fulfillment_method set default 'Retirada';
alter table public.orders alter column fulfillment_method set not null;
alter table public.orders alter column delivery_fee set default 0;
alter table public.orders alter column delivery_fee set not null;
alter table public.orders alter column subtotal set default 0;
alter table public.orders alter column subtotal set not null;
alter table public.orders alter column total set default 0;
alter table public.orders alter column total set not null;
alter table public.orders alter column created_at set default now();
alter table public.orders alter column created_at set not null;
update public.orders set status = case when status = 'confirmed' then 'confirmed' when status in ('cancelled', 'cancelado') then 'cancelled' else 'pending' end where status is null or status not in ('pending', 'confirmed', 'cancelled');
alter table public.orders add constraint orders_status_check check (status in ('pending', 'confirmed', 'cancelled'));

alter table public.order_items add column if not exists id uuid default gen_random_uuid();
alter table public.order_items add column if not exists order_id uuid;
alter table public.order_items add column if not exists product_id uuid;
alter table public.order_items add column if not exists product_name text;
alter table public.order_items add column if not exists unit_price numeric(10,2) default 0;
alter table public.order_items add column if not exists quantity integer default 1;

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists order_items_order_id_idx on public.order_items (order_id);
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
revoke all on public.orders, public.order_items from anon, authenticated;
grant select on public.orders, public.order_items to authenticated;

drop policy if exists "Admins can view orders" on public.orders;
create policy "Admins can view orders" on public.orders
  for select to authenticated
  using (exists (select 1 from public.admin_users where user_id = (select auth.uid())));
drop policy if exists "Admins can view order items" on public.order_items;
create policy "Admins can view order items" on public.order_items
  for select to authenticated
  using (exists (select 1 from public.admin_users where user_id = (select auth.uid())));

drop function if exists public.create_order_from_site(jsonb, text, numeric);
create or replace function public.create_order_from_site(
  p_items jsonb,
  p_fulfillment text,
  p_delivery_fee numeric default 0,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_delivery_address text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid := gen_random_uuid();
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_product record;
  v_subtotal numeric(10,2) := 0;
  v_items jsonb := '[]'::jsonb;
  v_count integer;
  v_unique_count integer;
begin
  if p_fulfillment not in ('Entrega', 'Retirada') then raise exception 'Escolha entrega ou retirada.'; end if;
  if p_delivery_fee is null or p_delivery_fee < 0 or (p_fulfillment = 'Retirada' and p_delivery_fee <> 0) then raise exception 'Taxa de entrega inválida.'; end if;
  if p_customer_name is null or length(trim(p_customer_name)) < 2 then raise exception 'Informe seu nome.'; end if;
  if p_fulfillment = 'Entrega' and coalesce(trim(p_delivery_address), '') = '' then raise exception 'Informe o endereço de entrega.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then raise exception 'A sacola está vazia ou contém itens demais.'; end if;
  select count(*), count(distinct value->>'product_id') into v_count, v_unique_count from jsonb_array_elements(p_items);
  if v_count <> v_unique_count then raise exception 'O pedido contém sabores repetidos de forma inválida.'; end if;

  insert into public.orders (id, status, fulfillment_method, delivery_fee, customer_name, customer_phone, delivery_address, notes)
  values (v_order_id, 'pending', p_fulfillment, p_delivery_fee, trim(p_customer_name), nullif(trim(coalesce(p_customer_phone, '')), ''), nullif(trim(coalesce(p_delivery_address, '')), ''), nullif(trim(coalesce(p_notes, '')), ''));

  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Identificador de sabor inválido.'; end if;
    v_product_id := (v_item->>'product_id')::uuid;
    if coalesce(v_item->>'quantity', '') !~ '^[1-9][0-9]*$' or (v_item->>'quantity')::numeric > 100 then raise exception 'Quantidade de sabor inválida.'; end if;
    v_quantity := (v_item->>'quantity')::integer;
    select id, name, price, active into v_product from public.products where id = v_product_id;
    if not found or v_product.active is false then raise exception 'Um sabor do pedido não está mais disponível.'; end if;

    insert into public.order_items (order_id, product_id, product_name, unit_price, quantity)
    values (v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);
    v_subtotal := v_subtotal + (v_product.price * v_quantity);
    v_items := v_items || jsonb_build_array(jsonb_build_object('name', v_product.name, 'quantity', v_quantity, 'unit_price', v_product.price));
  end loop;

  update public.orders set subtotal = v_subtotal, total = v_subtotal + p_delivery_fee where id = v_order_id;
  return jsonb_build_object('id', v_order_id, 'subtotal', v_subtotal, 'delivery_fee', p_delivery_fee, 'total', v_subtotal + p_delivery_fee, 'items', v_items);
end;
$$;
revoke all on function public.create_order_from_site(jsonb, text, numeric, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_order_from_site(jsonb, text, numeric, text, text, text, text) to anon, authenticated;

-- Impede que a tela antiga do cardápio faça baixa em um estoque paralelo.
drop function if exists public.confirm_order(uuid);
drop function if exists public.cancel_order(uuid);



