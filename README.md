# 同频 V0.4.2 · 邮箱密码登录与开放注册 + Vercel + Cloudflare DNS + Supabase

> **本版已改为密码登录**：支持注册、登录和登录后设置密码，不再使用 Magic Link 或 OTP。请先在 Supabase 启用 Email 登录、允许注册，并将 **Confirm Email 关闭**；详细步骤见 `docs/AUTH_PASSWORD.md`。

版本目标：**保留已经运行的 Supabase 后端，不迁移数据库**；Vite 前端部署 Vercel，独立的 Vercel Function `/api/search` 负责调用 Bangumi、IGDB（可选）和高德（可选）。用已经备案的自有域名访问；先测试 Cloudflare **灰云**，再按需测试 **橙云**。

> **中国大陆连通性声明**：Vercel 和普通 Cloudflare 不是中国大陆境内托管；自有备案域名并不能保证静态资源、Supabase Auth/PostgREST/Realtime 或第三方搜索全链路可达。需按 `docs/VERCEL_CLOUDFLARE.md` 用大陆电信/移动/联通真实网络验收。

## 新增功能

- 「发现」页在线搜索动画、游戏和地点：Bangumi 动画/游戏，IGDB 补充游戏（配置凭据后），高德 POI 搜索（配置 Key 后）。
- 结果可导入自己的圈子共享条目库并评分；以稳定来源 ID 去重；保留与旧版精选条目的匹配，但不把不同城市的同名景点合并。
- 同站点 **Vercel Node.js Function** `GET /api/search?category=anime&q=芙莉莲`，验证当前 Supabase Auth JWT，第三方凭据不在浏览器中。
- `GET /api/health` 检查函数是否正常部署；无需登录。
- 保留原来的浅色界面、圈子、共享榜单、默认不限人数与「至少 3 人评分」开关、私密记录。

## 数据库：对旧 Supabase 只运行增量脚本

打开已经跑通的 Supabase 项目 → SQL Editor，执行 **`supabase/migration_v04.sql`**，不要重跑旧 `schema.sql`、不要清空 `experiences` 表。脚本只调整外部条目 ID 的唯一索引。

## 本地开发

需要 Node.js 22.12+、npm。

```bash
npm install
cp .env.example .env
cp .env.search.example .env.search
# 分别在 .env 和 .env.search 中填写项目连接信息
npm run dev:search  # 终端 1：本地 Node 搜索服务 8787
npm run dev         # 终端 2：Vite 页面 5173
```

浏览 `http://localhost:5173`；Vite 通过 `vite.config.js` 把 `/api` 转发到本地 Node 服务。原 `server/index.mjs` 仅用于本地，**Vercel 使用 `api/search.js` 和 `api/health.js`，不运行常驻 Node 服务器**。

本地健康检查：`http://localhost:8787/api/health`；本地在线搜索要先登录，匿名请求会得到 401。

## Vercel 部署（推荐顺序）

1. 将项目提交到自己的 **Private GitHub 仓库**，确认 **没有提交 `.env`、`.env.search`、`.env.local` 等私有配置**。
2. Vercel → Add New Project → Import Repository。Framework Vite；Root `./`；Build `npm run build`；Output `dist`（也在 `vercel.json` 中给出）。
3. 添加 Vercel 环境变量。参见 `.env.vercel.example`。前端需要 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`；函数需要 `SUPABASE_URL` 和 `SUPABASE_PUBLISHABLE_KEY`。如使用外部搜索，另外配置 `BANGUMI_USER_AGENT`、`IGDB_CLIENT_ID`、`IGDB_CLIENT_SECRET` 和 `AMAP_WEB_KEY`。**IGDB Secret、高德 Web Key 不能用 `VITE_` 前缀**。
4. **不要设置 `VITE_SEARCH_API_BASE`**，线上直接访问同源 `/api/search`。
5. Deploy 后先访问平台分配的 `https://<project>.vercel.app/api/health`，期望 `{"ok":true,...}`。注意：可读到健康接口并不等于已验证外部来源或 Supabase。
6. Vercel 项目 → Domains，绑定 `app.你的域名`。DNS 记录以 Vercel 实际给出的目标为准；如果 DNS 在 Cloudflare，先设为 **DNS only（灰云）**，检查证书与域名验证。
7. Supabase → Authentication：启用邮箱密码登录与开放注册，并关闭 Confirm Email（详见 `docs/AUTH_PASSWORD.md`）。Site URL 可继续设置为 `https://app.你的域名`；密码登录本身不需要邮件链接跳转。
8. 在无代理的大陆网络下实测网页登录、云端评分、榜单和三类搜索，再决定是否在 Cloudflare 做**橙云对照实验**。注意不能把已备案视为 Cloudflare 中国境内 CDN 节点的保证。

详细步骤、故障诊断和验收表：**`docs/VERCEL_CLOUDFLARE.md`**。

## 测试

```bash
npm run test:search
npm run build
```

单元测试覆盖搜索参数验证、三类数据映射、同名地点防误合并、源站降级，以及 Vercel Function 的输入、登录校验和响应头。构建需要本地已安装 npm 依赖。本文件包是在无 Supabase 项目访问权环境中制作的，**未对用户真实 Supabase、域名、Vercel、IGDB、高德执行生产联调**。

## 安全和已知限制

- `/api/search` 要求 **Supabase Access Token**；服务端用 Supabase Auth API 验证，不能只解码 JWT。Function 有暖实例内的简易限流，**不是跨实例全局限流**，正式公开访问应加 Vercel 防火墙限流。
- 静态站和 API Function 都在 Vercel；Cloudflare 橙云只影响 `app` 入口，浏览器仍然**直接访问 Supabase 项目域名**，不能解决 Supabase 直连问题。
- **密码登录无需 SMTP**。但关闭 Confirm Email 会失去邮箱所有权校验；未配置 SMTP 时不能通过邮件自助找回密码，建议控制新用户注册的滥用风险。
- 旅行地点搜索高德主要针对中国 POI；境外地点覆盖不保证。Bangumi/IGDB 也依赖其各自 API 的访问限制和数据授权。
- 作品图片可能仍引用外部地址。图片不能未经许可直接转存；加载失败使用占位图。
- 由于不同译名、同名作品存在，当前「同名或同来源」去重只做基本处理，用户应确认后再打分。
- 此版本尚未添加评论系统；圈内显示的「动态」来自大家的评分/短评记录。
