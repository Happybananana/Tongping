# 同频 V0.4.5 · Bangumi 元信息 + 立体书架

本次修改基于 V0.4.4（Supabase + Vercel + Cloudflare）。保留游戏、动画、旅行地点、登录、圈子动态、私密记录与圈子评分榜。

## 数据源能提供什么

- Bangumi `rating.score`：社区平均评分（0–10）；`rating.total`：参与人数；`rating.rank`：社区排名。有的条目尚未评分，因此显示 `—`。
- `type`：作品大类（2 动画，4 游戏）。`platform`：TV / 剧场版 / 游戏平台等；不等同于题材。
- `tags` 与 `meta_tags`：作品标签，可能包含奇幻、冒险、RPG 等，但由不同用户维护，不是完整、统一的官方类型本体；缺失时不强行推断。
- 这些来源于 Bangumi，并不与同频好友平均分混算。圈子榜单仍只统计 Supabase `experiences` 中已公开的评分。

相关官方接口：POST `/v0/search/subjects`，GET `/v0/subjects/{id}`。本项目仍采用后端代理，不要求大陆浏览器直连 Bangumi。

## 在已有项目升级（顺序很重要）

1. 下载 V0.4.5 **补丁 ZIP**，按原目录覆盖到现有的 GitHub 仓库，保留你的私人环境变量；或者使用完整 ZIP 的项目文件更新仓库。
2. **先**登录 Supabase Dashboard → SQL Editor，执行 `supabase/migration_v045.sql`。只增加 `catalog_items` 的四个字段及约束，**不会删除现有评分或条目**；之前做过 V0.4 的人不需要重跑 `migration_v04.sql`。
3. Git 提交并推送，等待 Vercel 自动部署。
4. 保留原有环境变量：`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`BANGUMI_USER_AGENT`。**没有新增 Secret 或 API Key。**
5. 打开 `https://app.1t4.online` 登录，进入「发现 → 动画」，搜索「葬送的芙莉莲」，搜索卡片应出现 Bangumi 平均分、平台和标签（上游某字段缺失则不会显示）。
6. 选择条目「加入并评分」，详情数据优先从 Bangumi 获取后导入；如果详情源暂时失败，则回退搜索结果。打开条目详情查看独立的 Bangumi 社区评分模块以及圈内平均分。
7. 在「我的」选择「✦ 立体书架」：动画、游戏分开展示；鼠标悬停时书本浮起/倾斜，移动端轻触进入作品详情。也可以切回「☷ 列表」。旅行地点依然使用地点卡片，不硬套书本外观。

### 旧 Bangumi 条目怎么办？

V0.4.4 或更早导入的条目可能没有 Bangumi 评分和标签。进入该条目详情时，V0.4.5 会**按需补查** Bangumi，并在本次浏览会话显示。出于共享数据安全的考虑，这类旧条目的实时补查结果不会通过客户端直接改写他人创建的共享条目；如果未来需要在数据库中定期批量回填，我们应另外编写具备服务端验证的安全同步作业。

## 测试

```bash
npm install
npm run test:search
npm run build
```

本交付环境已通过 37 项 Node 测试和 `node --check` 语法检查。由于网络访问受限，未成功安装前端 npm 依赖，因此 **Vite 正式构建、真实 Supabase 联机和 Vercel 上的浏览器视觉检查尚未完成**。请在本地运行上述三个命令；若构建失败，保留 Vercel 的 Build Logs 以便排错。

## 兼容与性能

- 私人评分和 Bangumi 平均分明确分开展示；现有榜单公式、默认不限人数与「至少 3 人评分」开关不变。
- `/api/subject` 需要有效 Supabase 登录令牌，且限制数字条目 ID；避免成为任意 URL 代理。
- 搜索返回简要评分/标签；点击导入时最多额外获取一次详情，不对整页搜索结果逐条调用详情。
- 书架 CSS 使用轻量 3D transform；触屏禁用持续漂浮，系统开启「减少动态效果」后禁用漂浮与旋转。图片仍是懒加载。
- 旧条目没有平台/评分时显示 `—`，不自动填造数据。Bangumi 社区评分可能随时间变化，新导入的数据库字段是导入时快照。
