# 同频 V0.4.3 · Bangumi 封面大陆访问修复

## 问题根因
Bangumi 搜索经过同频的 `/api/search`，但图片 URL 指向 `https://lain.bgm.tv`，由浏览器直接访问。某些中国大陆网络无法连接 `lain.bgm.tv`，导致文字正常、封面不显示。历史 Bangumi URL 还可能是 `http://`，之前的映射会直接丢弃它。

## 修复
- 新增 **`GET /api/cover?path=%2Fpic%2Fcover%2Fl%2F...jpg`**。浏览器请求同频自身域名，Vercel 函数访问 Bangumi 图片域名。
- 仅接受 Bangumi 官方 `/pic/cover/` 封面路径以及有限的 `/r/<size>/` 路径，拒绝任意 URL、重定向、非图片 MIME、超过 5MiB 的结果。
- 公开图片可缓存，评分、用户资料、认证信息不可缓存。
- `src/main.js` 会同时转换搜索结果封面和已经导入 Supabase 的 Bangumi 条目封面；**无需数据库迁移**。
- Bangumi 返回 `http://lain.bgm.tv` 时规范为 HTTPS；不允许其他站点的 HTTP 图片。

## 更新 Vercel
1. 用本版完整项目更新 GitHub 仓库根目录并提交；保持已配置的 Supabase 环境变量原样。
2. 在 Vercel 的最新 Deployment 看到 Ready。
3. 在浏览器无代理模式访问正式站点，在「发现 → 动画」重新搜索。也可刷新已经评分的条目详情，检查封面。
4. Chrome F12 → Network → Img：Bangumi 封面请求地址应由 `lain.bgm.tv` 改为 `app.1t4.online/api/cover?path=...`。
5. 如果 `/api/cover` 返回 502，则是 Vercel 无法从 Bangumi 获取图片、上游非图片响应或超时。进入 Vercel Logs 查看对应函数异常；不要向前端增加第三方加速服务的账号凭据。
6. 如果返回 404，检查 `api/cover.js` 是否已上传、Vercel Root Directory 是否与 `package.json` 一致；不要仅上传 dist。
7. 如果返回 200 但无法显示，查看 Response 的 `content-type` 是否为 `image/jpeg`、`image/png`、`image/webp` 或 `image/avif`，以及 Cloudflare 是否缓存了旧的失败响应。

**警告：图片网关无法保证中国大陆所有运营商稳定**：它依赖用户 → Cloudflare/Vercel 与 Vercel → Bangumi 两段网络。先做小圈子实际网络验收，再决定是否采用经授权的国内对象存储缓存。图片内容的缓存、再分发应遵守 Bangumi/上游的授权和服务条款。
