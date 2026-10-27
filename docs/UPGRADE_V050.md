# 同频 V0.5.0 — VIDEO CLUB × RAILWAYS

## 版本内容

- **图片完整显示**：保留统一 3:4 封面槽，`object-fit: contain`，不拉伸、不裁切 Bangumi / IGDB 原图。比例不同的图片会出现留白（letterbox）。
- **「找片」分页**：共享馆藏浏览每页 10 条，包含页码、上一页、下一页；输入关键词或切换频道会回到第一页。
- **在线搜索服务端分页**：Vercel `/api/search?category=anime|game|place&q=关键词&page=1...100`。Bangumi 使用 `offset/limit`，IGDB 使用 `offset/limit`，高德使用 `page_num/page_size`。API 基于本页结果数量估算下一页是否存在，尾页可能还会出现一次空结果。每页独立缓存；上线后注意外部 API 频控。
- **好友频道**：保留 TOP 3 排版，放大作品名称、评分和参与人数，封面保持完整比例，减少无意义留白。
- **旅行独立「沿途车站」**：站台式场景、地点搜索（高德）、旅行地点独立排行榜与三人筛选、个人旅行车票，路由 `#travel`。此前保存在 Supabase 的 `place` 条目与 `experiences` 自动使用，不需要迁移。
- **录像店主页面**：只展示游戏和动画动态、精选作品和共享榜单；个人录像柜不再混入旅行记录。

## Vercel 更新

1. 如果现在用 V0.4.9，下载完整项目或补丁覆盖同名文件（补丁保留 `src/main.js`、`server/search.mjs`、`api/search.js`、样式和图片等对应目录）。
2. 保留你现有的 `.env` / Vercel 环境变量。不要在 GitHub 上传 `.env`、密钥或本地数据库。
3. `npm install && npm run test:search && npm run build`，确保构建无误后推送 GitHub。
4. Vercel 自动部署后验收 `#discover` 的下一页、`#circle` 排行榜、`#travel` 高德搜索、`#me` 录像柜。

本版本 **无需执行 Supabase SQL**，不更换认证或 RLS。

## 大量作品下的进一步扩展

当前共享库分页在前端进行：加载了当前圈子允许看到的条目后，只绘制当前页。作品规模达到成千上万时，应把 `catalog_items` 的查询升级为 Supabase `range` / 服务端搜索与数据库分页，而不再一次性拉取全量资料。在线第三方搜索则已经是服务端按页查询。留意 Supabase 的行数上限与可见性 RLS。

## 兼容与注意

- 私人记录仍不会进入圈子榜单；旅行评分同样服从现有 RLS。
- 站台页的在线高德地点搜索需要部署环境变量 `AMAP_WEB_KEY`。
- 即使页面走 Cloudflare，浏览器仍可能直连 Supabase；中国大陆访问稳定性需要线上验证。
- 预览 HTML 使用模拟数据与原创 SVG 海报，不代表生产数据已通过联机验收。
- 服务端 `hasMore` 暂以各来源实际返回条数估算，并非严格的总页数元数据。
