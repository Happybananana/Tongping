-- 同频 V0.6.5：安全删除无关联记录的圈内共享条目。
-- 仅在已运行 v0.5.7 迁移的现有 Supabase 数据库执行；不修改、删除任何已有数据。
-- 用户只能删除本人在当前圈子创建的条目；即使别人的评分是私密的也会被阻止。
-- 为避免 ON DELETE CASCADE 意外删除朋友资料，任何 experiences（包括未评分收藏）和帖子都会阻止删除。

begin;

create or replace function private.delete_unused_catalog_item_impl(p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item public.catalog_items%rowtype;
begin
  if v_uid is null then
    raise exception '请先登录' using errcode = '42501';
  end if;
  -- Lock the parent catalog row; concurrent FK inserts must coordinate with this lock.
  select * into v_item from public.catalog_items
    where id = p_item_id for update;
  if not found then
    raise exception '条目不存在或已被删除' using errcode = 'P0002';
  end if;
  if v_item.circle_id is null or v_item.created_by is distinct from v_uid
    or not exists (
      select 1 from public.circle_members m
      where m.circle_id = v_item.circle_id and m.user_id = v_uid
    ) then
    raise exception '只能删除本人在当前圈子创建的条目' using errcode = '42501';
  end if;
  if exists (select 1 from public.experiences x where x.item_id = p_item_id) then
    raise exception '仍有成员收藏或评分该条目，禁止删除；请先清理相关记录' using errcode = '23503';
  end if;
  if exists (select 1 from public.circle_posts p where p.item_id = p_item_id) then
    raise exception '已有圈内帖子引用该条目，禁止删除' using errcode = '23503';
  end if;
  delete from public.catalog_items where id = p_item_id;
  return true;
end;
$$;

create or replace function public.delete_unused_catalog_item(p_item_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.delete_unused_catalog_item_impl(p_item_id);
$$;

revoke all on function private.delete_unused_catalog_item_impl(uuid) from public, anon, authenticated;
revoke all on function public.delete_unused_catalog_item(uuid) from public, anon, authenticated;
grant execute on function private.delete_unused_catalog_item_impl(uuid) to authenticated;
grant execute on function public.delete_unused_catalog_item(uuid) to authenticated;

commit;
