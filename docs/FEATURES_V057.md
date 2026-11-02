# V0.5.7 交互与数据结构

- `src/sheetImport.js`: 纯客户端 CSV/XLSX 解析、列名归一化、状态与评分验证；仅 `.xlsx` 动态加载 `read-excel-file/browser`。
- `src/personalStats.js`: 个人记录统计，年代图按发行年份分组。
- `src/main.js`: 导入预览与确认、讨论列表、帖子详情、回复、主题控制。
- `src/v057-archive.css`: COLLECTION 简约主题和新模块组件视觉；VIDEO CLUB 仍为默认主题。
- `supabase/migration_v057.sql`: 新表、索引、GRANT/REVOKE、RLS 校验逻辑。

帖子结构为 `circle_posts(circle_id, item_id, user_id, title, body, spoiler)`；回复为 `post_comments(post_id, circle_id, user_id, body)`。所有创建行为都要同时满足 `auth.uid() = user_id`、同圈成员资格；帖子所对应作品必须为游戏或动画，且作品属于同圈或公共条目。回复的 `circle_id` 必须与帖子一致。SQL 不提供编辑他人帖子/回复的权限。客户端的按钮隐藏只是体验设计，不作为安全措施。
