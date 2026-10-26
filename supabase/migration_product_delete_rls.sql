-- Permite que somente administradores cadastrados excluam sabores.
-- Execute no SQL Editor do projeto Supabase usado pelo site.
begin;

grant delete on table public.products to authenticated;

drop policy if exists "Admins can delete products" on public.products;
create policy "Admins can delete products"
  on public.products
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.admin_users
      where user_id = (select auth.uid())
    )
  );

commit;
