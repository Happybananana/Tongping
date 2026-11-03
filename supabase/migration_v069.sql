-- 同频 V0.6.9「轨迹交汇」增量迁移。
-- 依赖：已执行 V0.6.8 的 migration_v068.sql（到访日期与 GCJ-02 坐标字段）。
-- 安全：默认不开启分享；好友查询必须双向同意且双方是同一圈子成员；
-- 仅返回双方已设置为圈内可见、已到访、带有效坐标的历史地点。
-- 不重建 experiences/catalog_items，不修改既有收藏、评分、RLS。
begin;

create table if not exists public.travel_share_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  circle_id uuid not null references public.circles(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists travel_share_by_circle
  on public.travel_share_settings(circle_id,user_id) where enabled=true;

alter table public.travel_share_settings enable row level security;
revoke all on public.travel_share_settings from anon, authenticated;
grant select,insert,update on public.travel_share_settings to authenticated;

drop policy if exists travel_share_read_self on public.travel_share_settings;
create policy travel_share_read_self on public.travel_share_settings
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists travel_share_insert_self on public.travel_share_settings;
create policy travel_share_insert_self on public.travel_share_settings
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.circle_members m
      where m.user_id=(select auth.uid()) and m.circle_id=travel_share_settings.circle_id)
  );

drop policy if exists travel_share_update_self on public.travel_share_settings;
create policy travel_share_update_self on public.travel_share_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.circle_members m
      where m.user_id=(select auth.uid()) and m.circle_id=travel_share_settings.circle_id)
  );

-- 必须从数据库内部再次验证所有权限，不能依赖前端过滤。
-- SECURITY DEFINER 只返回严格控制的字段与可公开共享的记录。
create or replace function public.get_travel_crossing_tracks(p_friend_id uuid)
returns table (
  traveler_id uuid,
  item_id uuid,
  place_name text,
  place_subtitle text,
  provider text,
  provider_item_id text,
  longitude double precision,
  latitude double precision,
  coordinate_system text,
  visited_on date,
  visit_date_precision text,
  status text,
  visibility text,
  rating numeric,
  note text,
  spoiler boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_circle uuid;
begin
  if v_me is null or p_friend_id is null or p_friend_id=v_me then
    return;
  end if;

  select m.circle_id into v_circle from public.circle_members m where m.user_id=v_me limit 1;
  if v_circle is null or not exists (
    select 1 from public.circle_members m
    where m.user_id=p_friend_id and m.circle_id=v_circle
  ) then return; end if;

  if not exists (
    select 1 from public.travel_share_settings s
    where s.user_id=v_me and s.circle_id=v_circle and s.enabled=true
  ) or not exists (
    select 1 from public.travel_share_settings s
    where s.user_id=p_friend_id and s.circle_id=v_circle and s.enabled=true
  ) then return; end if;

  return query
    select e.user_id, e.item_id, p.name, p.subtitle,
      p.provider, p.provider_item_id,
      p.place_longitude::double precision, p.place_latitude::double precision,
      p.place_coordinate_system,
      e.visited_on, e.visit_date_precision, e.status, e.visibility, e.rating, e.note, e.spoiler
    from public.experiences e
    join public.catalog_items p on p.id=e.item_id
    where e.user_id in (v_me,p_friend_id)
      and e.circle_id=v_circle and e.visibility='circle'
      and e.status='done'
      and p.category='place'
      and (p.circle_id is null or p.circle_id=v_circle)
      and p.place_latitude is not null
      and p.place_longitude is not null
      and p.place_coordinate_system='GCJ-02'
    order by e.user_id,e.visited_on nulls last,e.item_id
    limit 2000;
end;
$$;

revoke all on function public.get_travel_crossing_tracks(uuid) from public, anon, authenticated;
grant execute on function public.get_travel_crossing_tracks(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
