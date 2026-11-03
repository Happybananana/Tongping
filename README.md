# 同频 V0.6.11 · 我的旅行轨迹地图

基于 **V0.6.10** 的小版本升级：为「沿途车站」增加单人旅行地图，默认打开「我的旅行轨迹」，可切换到原来的「好友轨迹交汇（最多 4 人）」。

单人地图无需开启分享，会读取当前账号自己的已到访旅行车票（包括个人私密车票），为具有坐标的地点绘制站点，并只在到访日期先后明确时用虚线连接。缺少坐标的旧车票仍保留在年鉴里。原好友交汇权限不变，单人数据不会自动对好友开放。

**部署：解压 ZIP，把里面的文件按目录结构覆盖到 GitHub 仓库根目录并提交，Vercel 自动构建即可。无需 SQL、GitHub Actions 或任何命令行升级脚本。**

测试：`npm run test:features`；单独测试：`node --test src/travelPersonalMapModel.test.mjs src/travelCrossingModel.test.mjs`。

详见 `docs/FEATURES_V0611.md`。
