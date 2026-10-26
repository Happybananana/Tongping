# 同频 V0.4.2：开放注册 + 邮箱密码登录

正式网站：`https://app.1t4.online`

## 本次改动

- 登录：邮箱 + 密码（Supabase `signInWithPassword`）
- 注册：邮箱 + 密码 + 确认密码（Supabase `signUp`），密码至少 8 位
- 注册后不自动加入其他人的私人圈子；必须创建圈子，或者输入有效邀请码加入现有圈子
- 「我的」页面可在当前登录态下设置 / 修改密码（Supabase `updateUser`）
- **不需要创建新 Supabase 项目、不需要改 SQL、不需要配置 Custom SMTP**
- 原有 Supabase 用户 ID、圈子、评分、排行榜、作品搜索均保留

## 必须修改 Supabase 控制台

打开 Supabase Dashboard → 当前同频项目 → Authentication：

1. 在 General Settings 或 Sign In / Providers → Email 中启用 Email provider。
2. **Allow new users to sign up = ON**（允许新用户注册）。
3. **Confirm Email = OFF**。这是免邮件注册的关键；否则 `signUp` 可能创建待确认用户、却没有登录 session，需要确认邮件才能登录。
4. 密码长度最小建议设置 **8 位**，与页面校验一致。生产环境应启用适合的密码强度和反滥用控制。
5. 请确认所使用 Supabase 项目没有额外的电子邮件确认流程、Auth Hook 或 CAPTCHA 要求；否则需要同步更新前端配置。

**注意安全代价：关闭 Confirm Email 后，Supabase 会隐式确认注册者填写的邮箱，但不能证明他们拥有该邮箱。有人可能抢先以朋友的邮箱注册。没有 SMTP 时也无法通过常规邮件找回密码。** 这仅是小圈子试运行的权衡。建议限制公开传播、开启 Auth 速率限制，并在后续考虑验证码或可信 OAuth。

## 如何迁移旧版 Magic Link / OTP 账号

1. **如果旧账号在某个设备仍处于登录状态：不要先退出。** 更新到新版后，进入「我的 → 账号与云端档案 → 设置 / 修改登录密码」，输入两次新密码并保存。
2. 保存成功后，再用同一个邮箱 + 新密码在另一台设备登录测试。原用户 ID、圈子和评分不变。
3. **如果旧账号已经登出，且从未设置密码：不能直接对该邮箱“重新注册”来恢复账号。** 可短期使用旧版仍可用的邮件登录途径登录、设置密码；否则由持有后端管理员权限的项目所有者经安全的管理流程为原用户重置密码。`service_role`/`sb_secret_...` 仅可在安全的服务端或管理环境使用，禁止放入网页或公开仓库。
4. 如果 Supabase 启用 Secure password change，长时间之前创建的会话修改密码可能触发重新认证邮件；请在控制台查看相关策略。不要为了解决这个问题而泄露管理密钥。

## 更新 GitHub 与 Vercel

1. 解压新版 ZIP。将其中项目文件更新到你 GitHub 的 Vite 项目同一根目录（需包含 `src/`、`api/`、`package.json` 等）。
2. 不要上传 `.env`、`.env.search` 或私密凭据。
3. 提交后等待 Vercel 自动构建；观察 Deployments → Ready。
4. 打开 `https://app.1t4.online`，建议强制刷新或无痕窗口测试。
5. 点击「注册新账号」，用测试邮箱+密码注册，应直接进入「创建 / 加入圈子」的引导。之后退出再用相同邮箱+密码登录。
6. 使用仍登录的旧账号测试设置密码，并确保评分、圈子与以前一致。

**这次无需调整 Vercel 环境变量，也无需重跑 Supabase SQL**；仍沿用已有 Supabase URL 和 Publishable Key。

## 常见故障

- `Email not confirmed` 或注册后未自动登录：检查 Confirm Email 是否真的关闭，且使用的是同一个 Supabase 项目。
- `Invalid login credentials`：邮箱或密码不对；旧 OTP 用户可能从未设置过密码。
- `User already registered`：应返回登录；如果旧用户没有密码，请按旧账号迁移说明处理。
- `Failed to fetch` / 登录一直转圈：大陆浏览器到 `*.supabase.co/auth/v1/*` 不通；Cloudflare 只代理 `app.1t4.online`，不会自动代理 Supabase。更换登录方式无法解决网络链路问题。
- 重复刷新或使用无痕窗口仍出现旧验证码页面：检查 GitHub 提交、Vercel 当前 Deployment 与 Cloudflare 缓存，避免 Cache Everything 缓存 `index.html`。

## 验证范围

已完成 JS 语法检查及原有搜索测试。没有你的真实 Supabase 后端权限，因此**不能声称已经完成登录/注册的联机测试**。上线前请分别用新账号、旧账号和无邀请码账号测试权限边界。

参考：
- https://supabase.com/docs/guides/auth/general-configuration
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- https://supabase.com/docs/reference/javascript/auth-signup
- https://supabase.com/docs/reference/javascript/auth-updateuser
- https://supabase.com/docs/guides/auth/auth-smtp
