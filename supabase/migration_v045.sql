-- 同频 V0.4.5 · 只需在已有 V0.4+ Supabase 项目执行一次（重复执行也安全）。
-- Bangumi 公共评分与圈子 experiences.rating 完全分离；不改已有记录和 RLS。
begin;
alter table public.catalog_items
  add column if not exists bangumi_score numeric(4,2),
  add column if not exists bangumi_rating_total integer,
  add column if not exists bangumi_rank integer,
  add column if not exists bangumi_platform text not null default '';
-- 安全且向后兼容：不给非 Bangumi 条目伪造外部评分。
alter table public.catalog_items
  drop constraint if exists catalog_bangumi_score_range,
  add constraint catalog_bangumi_score_range check (bangumi_score is null or (bangumi_score > 0 and bangumi_score <= 10)),
  drop constraint if exists catalog_bangumi_rating_total_nonnegative,
  add constraint catalog_bangumi_rating_total_nonnegative check (bangumi_rating_total is null or bangumi_rating_total >= 0),
  drop constraint if exists catalog_bangumi_platform_length,
  add constraint catalog_bangumi_platform_length check (char_length(bangumi_platform)<=80);
commit;
