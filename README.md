# 同频 V0.6.7 · 海报墙评分牌与十分位评分

基于 V0.6.6 升级。海报墙的个人评分牌采用红/黄/绿三种主色系、
共六档视觉区分；9.5–10.0 分有双框与菱形标记。游戏与动画统一规则。

同步把个人评分、CSV/XLSX 批量导入及 JSON 恢复的合法步长从 0.5 调整为 0.1，
允许 7.6、8.3、9.7 等一位小数。最低评分仍为 0.5，最高为 10.0。

**在部署新版前，先于现有 Supabase 数据库运行 `supabase/migration_v067.sql`。**
不要重跑 `supabase/schema.sql`，不要清空数据库。原账号、圈子、收藏、评分、
隐私规则、第三方 API 和环境变量均沿用。

验证：`npm run test:features && npm run test:search && npm run build`。

详情见 `docs/FEATURES_V067.md`。
\n## 本升级包的 GitHub 拖入方式\n\n解压后把全部文件（含 `.github/`）拖入仓库根目录并提交。\nGitHub Actions 的 `Tongpin V0.6.7 Auto Upgrade` 会在上传后自动修改源代码、\n运行测试和构建，然后提交至 `main`。你不需要本地运行脚本。\n若 Actions 不允许写入仓库，请先检查仓库 Actions/Workflow 权限。\n详见 `上传说明.txt`。\n