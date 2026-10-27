# 同频 V0.4.4 — 基于《收藏柜》源码的 Bangumi 容灾优化

## 源码对照与设计取舍

参考用户提供的《收藏柜》源码：
- `lib/http.ts`：多域名、900ms 对冲、失败冷却、健康源优先
- `lib/cache.ts`：10 分钟 TTL、相同查询并发去重
- `lib/bangumi.ts`：Bangumi 搜索/详情映射与关键词重排
- `app/api/proxy/image/route.ts`：封面代理、尝试图片镜像与降级
- `components/SearchBar.tsx`：300ms 防抖与键盘联想

实际调整如下：
1. `server/bangumi-transport.mjs`：新建独立请求传输层；默认只走官方 `https://api.bgm.tv`，**不会默认向社区镜像发送关键词**；设置环境变量 `BANGUMI_API_BASES` 后可显式配置经过核实的备用站点。仅支持规定的 Bangumi v0 搜索、详情路径；900ms 对冲（按配置顺序），失败域名 10 分钟冷却、成功域名优先；先成功的 2xx JSON 作为结果，取消其余请求。
2. `server/search.mjs`：动画/游戏都使用传输层，原有 IGDB/高德逻辑不变；暖实例内同关键词查询共享进行中的 Promise，避免并发重复请求；保留现有成功结果缓存（5 分钟，空结果 1 分钟）。
3. `server/cover.mjs`：保留固定域名、固定封面路径、禁止重定向、MIME 白名单、边接收边限制大小 5MiB；加上 `Referer` 请求头；**可选**图片镜像 `BANGUMI_COVER_MIRROR=1`，默认关闭。不接受任意自定义主机或网址，不会形成开放 HTTP 代理。
4. `src/coverUrl.js`：支持 `r/800` 预览图路径；客户端仍通过同站点 `/api/cover` 取图。

## Vercel 设置

无需新增数据库 SQL，也不需要修改 Supabase 账号。

在 Vercel → Project → Settings → Environment Variables 中保留原有所有变量。
- `BANGUMI_USER_AGENT=你的标识/Tongpin/0.4.4 (https://app.1t4.online)`
- `BANGUMI_API_BASES=https://api.bgm.tv`（默认；可不填）
- `BANGUMI_COVER_MIRROR=0`（默认；可不填）

只有在确认社区镜像的使用许可、隐私及内容可信度以后，再自行设置示例：

```env
BANGUMI_API_BASES=https://api.bgm.tv,https://bgmapi.anibt.net
BANGUMI_COVER_MIRROR=1
```

这些镜像是上传的项目源码所使用的地址，**不是我们已验证的可用性保证，也不是官方指定镜像**。启用前请单独确认其服务协议。镜像可能看到搜索关键词，应谨慎开启。修改 Vercel 环境变量后要重新部署。

## 验证

```bash
npm install
npm run test:search
npm run build
```

在 `https://app.1t4.online`：
1. 登录 → 发现 → 动画，搜索 `葬送的芙莉莲`，检查名称与封面。
2. 搜索 `CLANNAD` 游戏，确认 `type=4` 不变。
3. 检查浏览器 Network，封面请求应走 `/api/cover?path=...`。
4. 测试已有作品导入、保存评分和「至少 3 人评分」筛选。
5. 如启用备用 API，可在测试环境中暂时模拟官方请求失败，验证备用结果和错误提示；不要在生产环境中人为干扰官方服务。

## 限制和注意

- **Vercel 的内存缓存和失败冷却只对当前函数实例有效**，并不是跨地区、跨实例全局状态。小圈子可以先用；如果后续用户增多，可增加共享缓存和限流。
- 启用镜像只是服务端出站容灾；中国大陆用户到 Cloudflare/Vercel 或 Supabase 的连通性问题仍需独立测试。
- 网站公开时，应当设置 API 请求额度和日志脱敏；不要记录 Supabase JWT 与任何服务密钥。
- 图片的镜像与长期缓存应符合图片提供方的协议，不要未经允许批量抓取或者长期重新发布。
- `README.md` 所称的 `AniList` 辅助评分没有移植：同频仍保持外部评分和圈内成员评分完全分离。
- **源文件只供审阅**：上传的 161MB 压缩包含 `.env`、构建缓存和本地数据库，不能原样推送 GitHub。若 `.env` 含真实凭据，建议更换相应密钥。
