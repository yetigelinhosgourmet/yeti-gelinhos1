-- Corrige pedidos do cardápio no banco compartilhado com o sistema de estoque.
-- A coluna orders.order_number é obrigatória e não possui valor padrão.
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
  v_order_number integer;
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

  -- Keep site order numbers unique across concurrent checkout requests.
  perform pg_advisory_xact_lock(hashtext('public.orders.order_number'));
  select coalesce(max(order_number), 0) + 1 into v_order_number from public.orders;

  insert into public.orders (id, order_number, status, source, fulfillment_method, delivery_fee, customer_name, customer_phone, delivery_address, notes)
  values (v_order_id, v_order_number, 'pending', 'site', p_fulfillment, p_delivery_fee, trim(p_customer_name), nullif(trim(coalesce(p_customer_phone, '')), ''), nullif(trim(coalesce(p_delivery_address, '')), ''), nullif(trim(coalesce(p_notes, '')), ''));

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
