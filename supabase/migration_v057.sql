-- 同频 V0.5.7：圈内作品帖子与回复。仅在已有 Supabase 项目执行本增量脚本。
-- 不修改用户、原有评分、作品或邀请码。
create table if not exists public.circle_posts (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 80),
  body text not null check (char_length(trim(body)) between 1 and 5000),
  spoiler boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists circle_posts_circle_recent on public.circle_posts(circle_id,created_at desc);
create index if not exists circle_posts_item_recent on public.circle_posts(item_id,created_at desc);
create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.circle_posts(id) on delete cascade,
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists post_comments_post_recent on public.post_comments(post_id,created_at);
create index if not exists post_comments_circle_idx on public.post_comments(circle_id);

alter table public.circle_posts enable row level security;
alter table public.post_comments enable row level security;
revoke all on public.circle_posts, public.post_comments from anon,authenticated;
grant select,insert,delete on public.circle_posts, public.post_comments to authenticated;

drop policy if exists circle_posts_read on public.circle_posts;
create policy circle_posts_read on public.circle_posts for select to authenticated using (
  circle_id in (select private.my_circle_ids())
);
drop policy if exists circle_posts_create on public.circle_posts;
create policy circle_posts_create on public.circle_posts for insert to authenticated with check (
  user_id=(select auth.uid())
  and circle_id in (select private.my_circle_ids())
  and exists (
    select 1 from public.catalog_items i
    where i.id=item_id and i.category in ('anime','game')
    and (i.circle_id is null or i.circle_id=circle_id)
  )
);
drop policy if exists circle_posts_delete on public.circle_posts;
create policy circle_posts_delete on public.circle_posts for delete to authenticated using (
  user_id=(select auth.uid()) and circle_id in (select private.my_circle_ids())
);

drop policy if exists post_comments_read on public.post_comments;
create policy post_comments_read on public.post_comments for select to authenticated using (
  circle_id in (select private.my_circle_ids())
  and exists (select 1 from public.circle_posts p where p.id=post_id and p.circle_id=circle_id)
);
drop policy if exists post_comments_create on public.post_comments;
create policy post_comments_create on public.post_comments for insert to authenticated with check (
  user_id=(select auth.uid())
  and circle_id in (select private.my_circle_ids())
  and exists (select 1 from public.circle_posts p where p.id=post_id and p.circle_id=circle_id)
);
drop policy if exists post_comments_delete on public.post_comments;
create policy post_comments_delete on public.post_comments for delete to authenticated using (
  user_id=(select auth.uid()) and circle_id in (select private.my_circle_ids())
);
-- 可选：Supabase Realtime 公共发布仅供圈内权限支持的订阅使用；
-- 前端会在进入发帖页面时重新加载帖子，不依赖 Realtime 才能展示。
