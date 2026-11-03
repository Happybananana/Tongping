# 同频 V0.6.6 · 从 V0.6.5 升级

将补丁内的 `src/`、`package.json`、`index.html` 按相同路径覆盖到原 GitHub 仓库。
保留原来的环境变量和数据库，无需新增 SQL。
新入口位于「我的收藏 → 一键导出 Excel / CSV」。原账号区域保留完整 JSON 备份。

推荐运行：`npm run test:features && npm run test:search && npm run build`。

注意：Excel / CSV 导出只包含本人动画和游戏，旅行记录继续使用完整 JSON 备份。
