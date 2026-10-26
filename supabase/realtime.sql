-- 可选：启用多人实时刷新。适用于新项目；如果不执行仍可点击页面右上角的刷新按钮。
-- 使用 Postgres Changes，适合 5～15 人的小圈子。
-- 事件发送以 Supabase Realtime 的行级权限检查为边界。
do $$
begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='experiences') then
    execute 'alter publication supabase_realtime add table public.experiences';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='catalog_items') then
    execute 'alter publication supabase_realtime add table public.catalog_items';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='circle_members') then
    execute 'alter publication supabase_realtime add table public.circle_members';
  end if;
end $$;
