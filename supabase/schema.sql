-- 同频 V0.3 · 适用于全新 Supabase 项目（在 SQL Editor 执行一次）
-- 重要：此脚本不是对旧版草案的原地迁移；请勿直接覆盖已有正式业务数据库。
-- 原则：未登录不可读；成员仅能查看自己与同一圈子公开的体验；邀请码只经受控 RPC 返回。

create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null default '同频伙伴' check (char_length(trim(nickname)) between 1 and 40),
  created_at timestamptz not null default now()
);

create table if not exists public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  owner_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.circle_members (
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id),
  unique (user_id) -- V0.3: 一个账号只能加入一个圈子
);

-- 邀请码属于密钥，不存进有成员 SELECT 权限的 public.circles。
create table if not exists private.circle_invites (
  circle_id uuid primary key references public.circles(id) on delete cascade,
  code text not null unique check (char_length(code)=24),
  created_at timestamptz not null default now()
);

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('game','anime','place')),
  name text not null check (char_length(trim(name)) between 1 and 100),
  subtitle text not null default '' check (char_length(subtitle)<=120),
  description text not null default '',
  cover_url text not null default '',
  source_url text not null default '',
  wiki_title text not null default '',
  emoji text not null default '✳',
  year text not null default '',
  tags text[] not null default '{}',
  provider text,
  provider_item_id text,
  circle_id uuid references public.circles(id), -- NULL = 官方/示例公共条目；非 NULL = 仅所属圈子可见
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint safe_cover_url check (cover_url='' or left(cover_url,8)='https://')
);
create unique index if not exists catalog_category_name_unique on public.catalog_items(coalesce(circle_id,'00000000-0000-0000-0000-000000000000'::uuid),category, lower(trim(name)));
create unique index if not exists catalog_provider_unique on public.catalog_items(provider, provider_item_id) where provider is not null and provider_item_id is not null;

create table if not exists public.experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  circle_id uuid references public.circles(id) on delete set null,
  status text not null check (status in ('want','doing','done','paused')),
  rating numeric(3,1) check (rating is null or (rating between 0.5 and 10 and rating*2=trunc(rating*2))),
  note text not null default '' check (char_length(note)<=2000),
  spoiler boolean not null default false,
  visibility text not null check (visibility in ('circle','private')),
  updated_at timestamptz not null default now(),
  unique (user_id, item_id),
  constraint experience_circle_consistency check (
    (visibility='private' and circle_id is null) or
    (visibility='circle' and circle_id is not null)
  )
);
create index if not exists experience_shared_recent on public.experiences(circle_id,updated_at desc) where visibility='circle';
create index if not exists experience_owner_idx on public.experiences(user_id);
create index if not exists experience_item_idx on public.experiences(item_id);
create index if not exists circle_members_user_idx on public.circle_members(user_id);

-- 成员查询使用不暴露在 API schema 的 SECURITY DEFINER 帮助函数，避免成员表策略自递归。
create or replace function private.my_circle_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select cm.circle_id from public.circle_members cm where cm.user_id = (select auth.uid());
$$;

create or replace function private.shares_circle(other_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.circle_members a
    join public.circle_members b on a.circle_id=b.circle_id
    where a.user_id=(select auth.uid()) and b.user_id=other_user
  );
$$;

create or replace function private.is_member(member_id uuid, target_circle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.circle_members cm
    where cm.user_id=member_id and cm.circle_id=target_circle
  );
$$;

-- Auth 注册时自动创建个人资料，避免成员关联指向不存在的 Profile。
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id,nickname)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'nickname'),''),'同频伙伴'),40))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists tongpin_user_signup on auth.users;
create trigger tongpin_user_signup after insert on auth.users
for each row execute function private.handle_new_user();

-- 控制邀请码与成员写入：权限提升函数只放在非暴露的 private schema。
create or replace function private.create_circle_impl(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  new_id uuid;
  new_code text;
begin
  if uid is null then raise exception '请先登录'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 60 then
    raise exception '圈子名称需要 1～60 个字符';
  end if;
  if exists (select 1 from public.circle_members where user_id=uid) then
    raise exception '当前账号已加入一个圈子';
  end if;
  insert into public.circles(name,owner_id) values(trim(p_name),uid) returning id into new_id;
  -- 96 bit 随机值；服务端生成，不由浏览器指定。
  new_code := upper(substring(replace(pg_catalog.gen_random_uuid()::text,'-','') from 1 for 24));
  insert into private.circle_invites(circle_id,code) values(new_id,new_code);
  insert into public.circle_members(circle_id,user_id) values(new_id,uid);
  return jsonb_build_object('circle_id',new_id,'invite_code',new_code);
end;
$$;

create or replace function private.join_circle_impl(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  target_id uuid;
begin
  if uid is null then raise exception '请先登录'; end if;
  if exists (select 1 from public.circle_members where user_id=uid) then
    raise exception '当前账号已加入一个圈子';
  end if;
  if p_code is null or char_length(trim(p_code))<>24 then
    raise exception '邀请码格式不正确';
  end if;
  select i.circle_id into target_id from private.circle_invites i
  where i.code=upper(trim(p_code));
  if target_id is null then raise exception '邀请码不存在或已失效'; end if;
  insert into public.circle_members(circle_id,user_id) values(target_id,uid);
  return target_id;
end;
$$;

create or replace function private.get_invite_code_impl()
returns text language sql stable security definer set search_path = '' as $$
  select i.code from private.circle_invites i
  join public.circles c on c.id=i.circle_id
  where c.owner_id=(select auth.uid())
  limit 1;
$$;

-- 对外 RPC 是 invoker 包装器，不能以提升权限在公开 schema 内执行任意操作。
create or replace function public.create_circle(p_name text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.create_circle_impl(p_name);
$$;
create or replace function public.join_circle(p_code text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.join_circle_impl(p_code);
$$;
create or replace function public.get_invite_code()
returns text language sql security invoker set search_path = '' as $$
  select private.get_invite_code_impl();
$$;

-- GRANT 与 RLS 必须同时正确，不能只依赖客户端隐藏。
alter table public.profiles enable row level security;
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.catalog_items enable row level security;
alter table public.experiences enable row level security;
alter table private.circle_invites enable row level security;

revoke all on public.profiles,public.circles,public.circle_members,public.catalog_items,public.experiences from anon,authenticated;
grant select,insert on public.profiles to authenticated;
grant update(nickname) on public.profiles to authenticated;
grant select on public.circles,public.circle_members to authenticated;
grant select,insert on public.catalog_items to authenticated;
grant select,insert,update,delete on public.experiences to authenticated;
revoke all on private.circle_invites from anon,authenticated;

revoke all on function private.my_circle_ids(), private.shares_circle(uuid),private.is_member(uuid,uuid),private.create_circle_impl(text),private.join_circle_impl(text),private.get_invite_code_impl() from public;
revoke all on function public.create_circle(text), public.join_circle(text),public.get_invite_code() from public;
grant usage on schema private to authenticated;
grant execute on function private.my_circle_ids(), private.shares_circle(uuid),private.is_member(uuid,uuid),private.create_circle_impl(text),private.join_circle_impl(text),private.get_invite_code_impl() to authenticated;
grant execute on function public.create_circle(text),public.join_circle(text),public.get_invite_code() to authenticated;

-- 可安全重复运行 RLS 创建段（表结构仍面向新项目）。
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
  id=(select auth.uid()) or (select private.shares_circle(id))
);
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert to authenticated with check (id=(select auth.uid()));
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
using (id=(select auth.uid())) with check (id=(select auth.uid()));

drop policy if exists circles_read_member on public.circles;
create policy circles_read_member on public.circles for select to authenticated
using (id in (select private.my_circle_ids()));

drop policy if exists members_read_member on public.circle_members;
create policy members_read_member on public.circle_members for select to authenticated
using (circle_id in (select private.my_circle_ids()));

drop policy if exists catalog_read_signed_in on public.catalog_items;
create policy catalog_read_signed_in on public.catalog_items for select to authenticated
using (circle_id is null or circle_id in (select private.my_circle_ids()));
drop policy if exists catalog_insert_signed_in on public.catalog_items;
create policy catalog_insert_signed_in on public.catalog_items for insert to authenticated
with check (created_by=(select auth.uid()) and circle_id in (select private.my_circle_ids()));

drop policy if exists experiences_read_authorized on public.experiences;
create policy experiences_read_authorized on public.experiences for select to authenticated using (
  user_id=(select auth.uid()) or (
    visibility='circle' and circle_id in (select private.my_circle_ids())
    and (select private.is_member(user_id,circle_id))
  )
);
drop policy if exists experiences_insert_self on public.experiences;
create policy experiences_insert_self on public.experiences for insert to authenticated with check (
  user_id=(select auth.uid()) and (
    (visibility='private' and circle_id is null) or
    (visibility='circle' and circle_id in (select private.my_circle_ids()))
  )
);
drop policy if exists experiences_update_self on public.experiences;
create policy experiences_update_self on public.experiences for update to authenticated
using (user_id=(select auth.uid())) with check (
  user_id=(select auth.uid()) and (
    (visibility='private' and circle_id is null) or
    (visibility='circle' and circle_id in (select private.my_circle_ids()))
  )
);
drop policy if exists experiences_delete_self on public.experiences;
create policy experiences_delete_self on public.experiences for delete to authenticated
using (user_id=(select auth.uid()));

-- 公共基础条目。两端统一使用 UUID；provider_item_id 保留旧版备份 g1/a1/p1 等别名。
insert into public.catalog_items(id,category,name,subtitle,description,cover_url,source_url,wiki_title,emoji,year,tags,provider,provider_item_id)
values
('00000000-0000-4000-8000-000000000001','game','艾尔登法环','Elden Ring','在辽阔的交界地开启探索之旅。','https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/library_600x900.jpg','https://store.steampowered.com/app/1245620/','','⚔️','2022',array['动作角色扮演','开放世界'],'demo','g1'),
('00000000-0000-4000-8000-000000000002','game','空洞骑士','Hollow Knight','深入圣巢遗迹，探索手绘地下王国。','https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/367520/library_600x900.jpg','https://store.steampowered.com/app/367520/','','🗡️','2017',array['探索'],'demo','g2'),
('00000000-0000-4000-8000-000000000003','game','星露谷物语','Stardew Valley','按自己的节奏经营一片农场。','https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/413150/library_600x900.jpg','https://store.steampowered.com/app/413150/','','🌱','2016',array['模拟经营'],'demo','g3'),
('00000000-0000-4000-8000-000000000004','game','Balatro','牌组构筑','将扑克组合与小丑牌效果融合的策略游戏。','https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2379780/library_600x900.jpg','https://store.steampowered.com/app/2379780/','','🃏','2024',array['卡牌'],'demo','g4'),
('00000000-0000-4000-8000-000000000005','anime','葬送的芙莉莲','葬送のフリーレン','勇者一行结束旅程之后的故事。','https://api.bgm.tv/v0/subjects/400602/image?type=large','https://bangumi.tv/subject/400602','','🌙','2023',array['奇幻'],'demo','a1'),
('00000000-0000-4000-8000-000000000006','anime','命运石之门','STEINS;GATE','一群年轻人碰触时间奥秘的故事。','https://api.bgm.tv/v0/subjects/10380/image?type=large','https://bangumi.tv/subject/10380','','⏳','2011',array['科幻'],'demo','a2'),
('00000000-0000-4000-8000-000000000007','anime','紫罗兰永恒花园','ヴァイオレット・エヴァーガーデン','通过书信逐渐理解语言与情感。','https://api.bgm.tv/v0/subjects/183878/image?type=large','https://bangumi.tv/subject/183878','','🌸','2018',array['剧情'],'demo','a3'),
('00000000-0000-4000-8000-000000000008','anime','钢之炼金术师FA','FULLMETAL ALCHEMIST','两兄弟踏上寻找贤者之石的旅途。','https://api.bgm.tv/v0/subjects/1428/image?type=large','https://bangumi.tv/subject/1428','','🔥','2009',array['冒险'],'demo','a4'),
('00000000-0000-4000-8000-000000000009','place','京都','日本 · 城市','日本古都，拥有丰富寺院和传统街区。','','https://en.wikipedia.org/wiki/Kyoto','Kyoto','⛩️','',array['城市'],'demo','p1'),
('00000000-0000-4000-8000-000000000010','place','上海','中国 · 城市','外滩天际线与丰富街区文化。','','https://en.wikipedia.org/wiki/Shanghai','Shanghai','🌆','',array['城市'],'demo','p2'),
('00000000-0000-4000-8000-000000000011','place','清水寺','日本京都 · 景点','京都东山的历史寺院。','','https://en.wikipedia.org/wiki/Kiyomizu-dera','Kiyomizu-dera','🏯','',array['景点'],'demo','p3'),
('00000000-0000-4000-8000-000000000012','place','成都','中国 · 城市','美食、熊猫和悠闲节奏。','','https://en.wikipedia.org/wiki/Chengdu','Chengdu','🐼','',array['城市'],'demo','p4')
on conflict do nothing;
