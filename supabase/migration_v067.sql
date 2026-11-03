-- 同频 V0.6.7：个人评分从 0.5 步长改为 0.1 步长。
-- 请在现有已部署的 Supabase 数据库执行；不重建表、不删除历史评分。
-- experiences.rating 已是 numeric(3,1)，无需更改列类型，天然保留 1 位小数。
-- 目前最低允许 0.5，最高 10.0；0 分不作为有效评分。
begin;

alter table public.experiences
  drop constraint if exists experiences_rating_check;

alter table public.experiences
  add constraint experiences_rating_check
  check (rating is null or (rating between 0.5 and 10
         and rating * 10 = trunc(rating * 10)));

commit;
