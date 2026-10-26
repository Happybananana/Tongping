-- 同频 V0.4：只在既有 Supabase V0.3 数据库执行一次；不删条目或个人评分。
-- 将跨圈子外部来源身份改为圈内唯一，同时允许不同地点/作品同名但来源不同。
begin;

-- 老索引阻止了另一个圈子导入相同外部条目。
drop index if exists public.catalog_provider_unique;
create unique index if not exists catalog_provider_circle_unique
  on public.catalog_items (
    coalesce(circle_id,'00000000-0000-0000-0000-000000000000'::uuid),
    provider, provider_item_id
  ) where provider is not null and provider_item_id is not null;

-- 老索引按圈子、分类和名称强制唯一，会错误合并不同城市的同名景点。
-- 由稳定 provider+ID 负责联网条目唯一性；人工/旧版精选条目用名称+副标题约束。
drop index if exists public.catalog_category_name_unique;
create unique index if not exists catalog_curated_name_unique
  on public.catalog_items (
    coalesce(circle_id,'00000000-0000-0000-0000-000000000000'::uuid),
    category, lower(trim(name)), lower(trim(subtitle))
  ) where provider is null or provider='demo';

commit;
