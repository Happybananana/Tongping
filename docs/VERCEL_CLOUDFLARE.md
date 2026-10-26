# 同频 V0.4：Vercel + 已备案自有域名 + Cloudflare 灰/橙云对照

## 先明确预期

- **Vercel 与普通 Cloudflare Pages/Proxy 不提供默认的中国大陆境内源站/CDN 承诺。** ICP 已备案并不等于获得中国境内加速能力。
- 当前架构保留浏览器直连 Supabase（Auth/PostgREST/Realtime），即使入口网站快，也可能遇到 Supabase 请求延迟或不可达。
- 本方案是先验证低维护成本路径，**不是承诺中国大陆完全稳定的最终架构**。

## 1. 准备仓库

在本机的 `tongpin-v04-vercel` 目录运行：

```bash
npm install
npm run test:search
npm run build
```

建立私人 Git 仓库，先确认 `git status --short` 看不到 `.env`、`.env.search`、`.env.local`。如需 Git 操作，可按 GitHub 建库页面的步骤 `git init; git add .; git commit ...; git remote add origin ...; git push -u origin main`；不要在任何位置粘贴密钥给他人。

## 2. 在 Vercel 新建网站

Vercel Dashboard → Add New → Project → Import Git Repository；选择你的私人仓库。

| 项目字段 | 值 |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | `./`（项目代码所在目录） |
| Build Command | `npm run build` |
| Output Directory | `dist` |

本仓库的 `api/search.js`、`api/health.js` 是 Node.js Vercel Functions。**无需设置额外反向代理或启动常驻搜索服务器**。

### 环境变量

**前端编译时可公开：**

```text
VITE_SUPABASE_URL=https://你的项目.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
```

**仅 Serverless Function 服务端：**

```text
SUPABASE_URL=https://你的项目.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
BANGUMI_USER_AGENT=你的开发者标识/Tongpin/0.4 (https://app.你的域名)
IGDB_CLIENT_ID=...                 # 可选
IGDB_CLIENT_SECRET=...             # 可选，机密
AMAP_WEB_KEY=...                   # 可选，机密
```

不要在 Vercel 创建 `VITE_SEARCH_API_BASE`；保留空白，本项目就会调用自己域名的 `/api/search`。不要设置 `SUPABASE_SERVICE_ROLE_KEY`；搜索校验只需 Publishable Key。

不要对 Vercel 的静态缓存/CDN设置通配「缓存所有内容」；API 响应设为 no-store。

### 预检

首次部署后访问：

```text
https://你的项目.vercel.app/api/health
```

显示 `{"ok":true,"service":"tongpin-search-v0.4-vercel"}` 代表健康接口可达。访问 `/api/search?category=anime&q=芙莉莲`（未登录）应被拒绝并显示 401，而不是泄露开放 API。

## 3. 绑定备案域名、先灰云

在 Vercel 项目 → Settings → Domains 添加 `app.你的域名`。Vercel 会给出 CNAME/A 或 TXT 记录要求，**以项目控制台显示的实际目标为准**，不要盲抄互联网上的固定 IP/主机名。

如果你的域名 DNS 托管于 Cloudflare：

1. 在 Cloudflare → DNS → Records 按 Vercel 要求添加 `app` 的 CNAME/A，**Proxy status 选择 DNS only（灰云）**。
2. 如果需要 TXT 验证，按 Vercel 提示添加 TXT。等待控制台显示域名验证完成和 TLS 证书可用。
3. 用 `https://app.你的域名` 验证网站、`/api/health`、登录。某些地区无法打开要记录网络、运营商和时间，不要只测自己一台电脑。

**ICP 已备案但仅使用 Vercel 境外托管，不会让流量自动进入境内机房。** 请确保域名和备案主体符合实际用途及当地适用规则。

## 4. Supabase 邮箱登录回调

Supabase Dashboard → Authentication → URL Configuration：

- Site URL：`https://app.你的域名`
- Additional Redirect URLs：`https://app.你的域名/`、`http://localhost:5173/**`

现有应用 `signInWithOtp` 使用 `emailRedirectTo` 为当前网址。**线上应优先使用精确路径**，不需要把 `https://**` 之类过宽的通配地址加入授权名单。

将来若换成用户输入验证码（Email OTP），请单独修改前端登录逻辑与邮件模板；此版本仍为邮箱登录链接。

### 邮件服务

Supabase 默认 Auth 邮件服务可能限制收件人和发送频率。朋友正式注册前，请先按官方 Custom SMTP 指南配置合适的邮件提供商并验证发件域名 SPF、DKIM。SMTP 凭据只在 Supabase 后台保存。

## 5. Cloudflare 橙云作为对照实验（可选）

验证灰云域名和 HTTPS **完全可用之后**，才将 `app` 记录从 DNS only 切为 Proxied（橙云），并：

- Cloudflare SSL/TLS 设置 `Full (strict)`，确保 Vercel 源站证书有效。
- 不缓存 `/api/*`、`/.well-known/vercel/*`；不要对 HTML 与 Auth 交互设置 Cache Everything。避免意外缓存个性化数据和认证响应。
- 验证 `/.well-known/acme-challenge/*` 的证书挑战路径不被特殊重定向/封锁。
- 如果出现 403、证书验证失败、循环跳转、接口错误，先切回灰云，检查 Vercel 的自有域名配置和防火墙。
- **灰云与橙云分别测相同任务**，至少数次，分电信/联通/移动手机与家庭网络测。记录网站首屏、登录、条目搜索、保存评分的可用率和耗时。

Vercel 官方不推荐常规使用双层反向代理，Cloudflare 有可能让性能或防火墙检测变差。**不应未经实测就默认橙云更快**。

## 6. 最终验收表

| 测试动作 | 预期 | 测量 |
|---|---|---|
| 大陆手机 4G/5G 打开 `https://app.你的域名` | 主页加载、图标样式正常 | 首屏秒数 / 失败次数 |
| 发送 Supabase 登录邮件 | 邮箱收到并完成回跳 | 邮件投递时间 / 成功次数 |
| 进入已创建圈子 | 成员、个人评分显示 | 读取耗时 |
| 修改自己的评分并刷新 | 分数持久化 | 成功率 |
| 第二个真实用户加入圈子 | 看到共享评分，不见私人评分 | RLS 隐私检查 |
| 搜索动画/游戏/地点 | 有结果或友好降级 | 分类、来源、耗时 |
| 仅显示至少 3 人评分 | 只显示评价人数 >=3 的条目 | 条目数量/准确性 |
| 灰云对比橙云 | 比较成功率、延迟 | 三大运营商分别记录 |

**只要 Supabase 登录/写入在目标大陆网络持续失败，就不应向所有朋友宣称“已实现全流程大陆稳定访问”。** 灰橙云仅影响站点入口，不是 Supabase 代理。

## 官方参考

- Vercel Vite：https://vercel.com/docs/frameworks/frontend/vite
- Vercel Functions：https://vercel.com/docs/functions/runtimes/node-js
- Vercel 反向代理：https://vercel.com/docs/security/reverse-proxy
- Cloudflare DNS Proxy：https://developers.cloudflare.com/dns/proxy-status/
- Supabase Redirect URLs：https://supabase.com/docs/guides/auth/redirect-urls
