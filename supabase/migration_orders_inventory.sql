begin;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  fulfillment_method text not null check (fulfillment_method in ('Entrega', 'Retirada')),
  delivery_fee numeric(10,2) not null default 0 check (delivery_fee >= 0),
  subtotal numeric(10,2) not null default 0 check (subtotal >= 0),
  total numeric(10,2) not null default 0 check (total >= 0),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0)
);

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

create or replace function public.create_order_from_site(
  p_items jsonb,
  p_fulfillment text,
  p_delivery_fee numeric default 0
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
  if p_fulfillment not in ('Entrega', 'Retirada') then
    raise exception 'Escolha entrega ou retirada.';
  end if;
  if p_delivery_fee is null or p_delivery_fee < 0 or (p_fulfillment = 'Retirada' and p_delivery_fee <> 0) then
    raise exception 'Taxa de entrega inválida.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A sacola está vazia.';
  end if;
  select count(*), count(distinct value->>'product_id')
    into v_count, v_unique_count
    from jsonb_array_elements(p_items);
  if v_count <> v_unique_count then
    raise exception 'O pedido contém sabores repetidos de forma inválida.';
  end if;

  insert into public.orders (id, fulfillment_method, delivery_fee)
  values (v_order_id, p_fulfillment, p_delivery_fee);

  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Identificador de sabor inválido.';
    end if;
    v_product_id := (v_item->>'product_id')::uuid;
    if coalesce(v_item->>'quantity', '') !~ '^[1-9][0-9]*$' then
      raise exception 'Quantidade de sabor inválida.';
    end if;
    v_quantity := (v_item->>'quantity')::integer;
    select id, name, price, stock, active into v_product
      from public.products where id = v_product_id;
    if not found or v_product.active is false then
      raise exception 'Um sabor do pedido não está mais disponível.';
    end if;
    if v_product.stock is not null and v_product.stock < v_quantity then
      raise exception 'Estoque insuficiente para %.', v_product.name;
    end if;

    insert into public.order_items (order_id, product_id, product_name, unit_price, quantity)
    values (v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);
    v_subtotal := v_subtotal + (v_product.price * v_quantity);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'name', v_product.name,
      'quantity', v_quantity,
      'unit_price', v_product.price
    ));
  end loop;

  update public.orders
    set subtotal = v_subtotal, total = v_subtotal + p_delivery_fee
    where id = v_order_id;

  return jsonb_build_object(
    'id', v_order_id,
    'subtotal', v_subtotal,
    'delivery_fee', p_delivery_fee,
    'total', v_subtotal + p_delivery_fee,
    'items', v_items
  );
end;
$$;

create or replace function public.confirm_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_item record;
  v_stock integer;
begin
  if not exists (select 1 from public.admin_users where user_id = (select auth.uid())) then
    raise exception 'Acesso administrativo necessário.';
  end if;
  select status into v_status from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_status <> 'pending' then raise exception 'Este pedido já foi processado.'; end if;

  for v_item in
    select product_id, quantity from public.order_items
    where order_id = p_order_id order by product_id
  loop
    select stock into v_stock from public.products where id = v_item.product_id for update;
    if not found then raise exception 'Um sabor deste pedido não existe mais.'; end if;
    if v_stock is not null and v_stock < v_item.quantity then
      raise exception 'Estoque insuficiente para confirmar este pedido.';
    end if;
    if v_stock is not null then
      update public.products set stock = stock - v_item.quantity where id = v_item.product_id;
    end if;
  end loop;

  update public.orders set status = 'confirmed', confirmed_at = now() where id = p_order_id;
end;
$$;

create or replace function public.cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_item record;
begin
  if not exists (select 1 from public.admin_users where user_id = (select auth.uid())) then
    raise exception 'Acesso administrativo necessário.';
  end if;
  select status into v_status from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_status = 'cancelled' then raise exception 'Este pedido já foi cancelado.'; end if;

  if v_status = 'confirmed' then
    for v_item in
      select product_id, quantity from public.order_items
      where order_id = p_order_id order by product_id
    loop
      update public.products set stock = stock + v_item.quantity
      where id = v_item.product_id and stock is not null;
    end loop;
  end if;

  update public.orders set status = 'cancelled', cancelled_at = now() where id = p_order_id;
end;
$$;

revoke all on function public.create_order_from_site(jsonb, text, numeric) from public, anon, authenticated;
revoke all on function public.confirm_order(uuid) from public, anon, authenticated;
revoke all on function public.cancel_order(uuid) from public, anon, authenticated;
grant execute on function public.create_order_from_site(jsonb, text, numeric) to anon, authenticated;
grant execute on function public.confirm_order(uuid) to authenticated;
grant execute on function public.cancel_order(uuid) to authenticated;

commit;