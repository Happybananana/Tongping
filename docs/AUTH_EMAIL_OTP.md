# 同频 V0.4.1：邮箱验证码登录（无需点击 Supabase 验证链接）

适用于 `https://app.1t4.online`，继续使用已有 Supabase Cloud 项目、用户、圈子和评分数据。**不需要运行 SQL，也不要删除 auth.users 或重新注册账号。**

## 先配置 Supabase 控制台（必须）

1. 打开 Supabase → 项目 → **Authentication → Email Templates**（控制台界面可能显示 `Templates`）。
2. 编辑 **Magic Link** 模板，把默认的 `{{ .ConfirmationURL }}` 链接改为包含 `{{ .Token }}` 的数字验证码。例如：

   Subject：`同频 · 登录验证码`

   ```html
   <h2>同频登录验证码</h2>
   <p>你的验证码是：<strong>{{ .Token }}</strong></p>
   <p>如非本人操作，请忽略本邮件。请勿向其他人透露验证码。</p>
   ```

   注意：`{{ .Token }}` 是 Supabase 模板变量，必须保留原样，**不要自行替换为数字**。
3. 还建议编辑 **Confirm sign up**（确认注册）模板，改成同样的验证码形式，因为首次注册用户可能收到单独的确认注册邮件：

   Subject：`同频 · 注册验证码`

   ```html
   <h2>欢迎来到同频</h2>
   <p>你的注册验证码：<strong>{{ .Token }}</strong></p>
   <p>返回同频网页输入验证码即可继续，无须打开链接。</p>
   ```

4. 在 **Authentication → Sign In / Providers → Email** 确认 Email 已开启、注册允许；**不要为了绕开邮件链接而关闭邮箱验证**。
5. **Authentication → SMTP Settings**：正式邀请朋友前，需要配置 Custom SMTP（带你拥有的域名的发件邮箱，如 `no-reply@1t4.online`）。Supabase 默认发信服务仅面向项目团队已授权邮箱，而且每小时额度极低，不适合多用户正式使用。供应商处配置域名 SPF/DKIM 等记录。
6. 可将 OTP 过期时间改为 10 分钟（如果希望提高安全性；前端不依赖默认过期时间）。Supabase 默认有同邮箱约 60 秒重发间隔。

## 更新 GitHub / Vercel

1. 用此包中的更新文件覆盖 GitHub 仓库对应文件，提交并推送到 `main`：`src/main.js`, `src/style.css` 及新增文档等。
2. Vercel 将按现有 Git 集成重新部署；确认 Deployment Ready。
3. 打开 `https://app.1t4.online`，建议强制刷新（Ctrl+Shift+R），必要时检查 Cloudflare 没有开启 Cache Everything。
4. 输入已经使用过的邮箱 → 点击“发送验证码” → 直接在网页中输入邮件数字码 → 登录。登录后旧圈子和评分应保持不变。
5. 用新的邮箱重复一次，确认首次注册与加入圈子流程。

## 大陆可访问性和排错

- **验证码替代的是邮件中的确认链接，并不是 Supabase Auth API 网络代理。** 浏览器仍需能通过 HTTPS 请求 `https://<project-ref>.supabase.co/auth/v1/otp` 和 `/auth/v1/verify`。
- 如果点击“发送验证码”后报 `Failed to fetch`、`ERR_CONNECTION_TIMED_OUT`：在浏览器 F12 → Network 找 `/auth/v1/otp`。这是 Supabase 连通性问题，不是邮件模板或 GitHub 问题；Cloudflare 橙云代理 `app.1t4.online` 不会自动代理 Supabase 项目域名。
- 如果发送成功但收到的仍是链接：确认在**同一个 Supabase 项目**修改并保存了 Magic Link 和 Confirm sign up 模板；用新生成的邮件测试。
- 如果 `Email address not authorized`：配置 Custom SMTP 或在仅测试时使用项目团队被允许的邮箱。
- 如果出现 `Email rate limit exceeded`：不要连续点击，按后台限流等待；正式运营使用 Custom SMTP。
- 如果“验证码错误或过期”：确认复制的是**最近一次邮件**中的代码，避免多次发送后使用旧码；确认邮箱和验证码匹配。
- 不要复制验证码、令牌或服务端密钥给任何人。测试时可把 Network 的**状态码和错误文字**发给开发者，但应遮盖邮箱、Authorization 等信息。

## 验收标准

- 老账号仅输入邮箱+OTP即可登录，用户 UUID、原有记录不变；不再依赖点击 `*.supabase.co/auth/v1/verify`。
- 全新邮箱也能使用同一入口创建用户并验证。
- 断开 VPN 在真实中国大陆网络下发送与验证 OTP 都正常，数据读写稳定；否则需单独处理 Supabase 的中国大陆 API 网络问题。

官方资料：
- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/guides/auth/auth-smtp
