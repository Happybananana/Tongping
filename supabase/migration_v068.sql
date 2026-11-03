-- 同频 V0.6.8：旅途年鉴与未来双人交汇地图的数据基础。
-- 安全增量迁移：不删除任何旧数据；旧旅行日期保持 NULL；保留全部既有 RLS。
-- 请在上传 V0.6.8 前先于原 Supabase 项目执行本文件，不要重跑 schema.sql。
begin;

alter table public.experiences
  add column if not exists visited_on date,
  add column if not exists visit_date_precision text;

alter table public.experiences drop constraint if exists experiences_visit_date_valid;
alter table public.experiences add constraint experiences_visit_date_valid check (
    (visited_on is null and visit_date_precision is null)
    or (visited_on is not null and status='done'
       and visit_date_precision in ('year','month','day')
       and (visit_date_precision <> 'year' or
            (extract(month from visited_on)=1 and extract(day from visited_on)=1))
       and (visit_date_precision <> 'month' or extract(day from visited_on)=1))
);

-- 高德 GCJ-02 坐标仅属于共享地点目录，不是任何用户的实时位置。
-- 新入库的高德 POI 会在可用时保存坐标；旧地点不会被虚构坐标。
alter table public.catalog_items
  add column if not exists place_latitude numeric(9,6),
  add column if not exists place_longitude numeric(9,6),
  add column if not exists place_coordinate_system text;

alter table public.catalog_items drop constraint if exists catalog_place_coordinates_valid;
alter table public.catalog_items add constraint catalog_place_coordinates_valid check (
  (place_latitude is null and place_longitude is null and place_coordinate_system is null)
  or (
    category='place' and place_latitude between -90 and 90
    and place_longitude between -180 and 180
    and place_coordinate_system='GCJ-02'
  )
);

-- 不增加公开访问策略：原 catalog_items / experiences 的 RLS 和成员限制继续生效。
notify pgrst, 'reload schema';
commit;
