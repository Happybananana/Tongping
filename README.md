# 同频 V0.6.8 · JOURNEY ARCHIVE / 旅途年鉴

基于现有 GitHub V0.6.7 提供的**直接覆盖升级包**，无需安装脚本、无需 GitHub Actions。

## 升级顺序（请严格执行）

1. **先备份 Supabase 项目，并在 SQL Editor 执行单独提供的 `migration_v068.sql`。** 不要重跑 `supabase/schema.sql`。
2. 解压 `Tongpin_V0.6.8_Upgrade.zip`，在 GitHub 仓库 `main` 的根目录上传同路径文件，覆盖原有 `index.html`、`package.json`、`README.md`，新增 `src/`、`server/`、`api/`、`docs/` 中的对应文件。**不要只上传压缩包。**
3. 提交更改，等待现有 Vercel 集成重新部署。无需修改 `AMAP_WEB_KEY`，也无需新的环境变量。
4. 登录网站，确认右上角版本为 `0.6.8`，打开「沿途车站」验收旅行年鉴、想去清单、记录日期与高德搜索。

## 功能

- 旅行年鉴：按真实到访日期分组、筛选和排序，旧旅行日期为空时明确显示「日期未记」。
- 旅行记录：到访日期可按年、月、日精度填写；私密优先；0.1 分评分；旅行回忆；状态随时可由想去改为去过。
- 下一站想去：与已到访车票分开展示，避免强迫未出发的地点评分。
- 高德搜索：沿用现有 `AMAP_WEB_KEY`；新的记录向导可搜索包含 GCJ-02 坐标的高德地点，供未来交汇地图使用。
- 旅行档案 JSON 导出/恢复：单独包含日期精度与地点坐标，恢复时默认私密且跳过已有记录；原本的全站 JSON 备份逻辑保持不变。
- 圈内排行榜、高德原有搜索、游戏与动画模块维持原状。

## 验证

本补丁的新增模块可以在根目录运行 `npm run test:features && npm run test:search && npm run build`。上线后仍须实际验证 Supabase RLS、账号保存、移动端、Vercel API 和高德结果。

完整验收说明见 `docs/FEATURES_V068.md`。
