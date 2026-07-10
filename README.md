# 麦芽医疗 AI

这是一个医疗 AI 网站雏形，包含：

- `/Web/`：用户提问页面，历史对话在侧边栏，用户消息靠右，AI 回答靠左。
- `/admin/`：知识库上传和管理页面。
- 知识库优先：问题和麦芽知识库资料足够相关时，优先使用知识库并标注“来自麦芽知识库”。
- 外部 AI 兜底：知识库没有足够相关资料时，自动调用已配置的外部 AI API。
- 邮箱验证码登录：同一邮箱登录后，可跨设备读取历史对话，并支持用户名、头像和邮箱更换。

## 本地运行

在项目根目录运行：

```bash
npm.cmd install
npm.cmd run dev
```

打开：

- 前端用户网站：`http://localhost:5173/Web/`
- 后台页面：`http://localhost:5173/admin`
- 后端接口：`http://localhost:8787/api/health`

## API Key 配置

复制 `.env.example` 为 `.env`，再填写后端环境变量。不要把 `.env` 提交到 GitHub。

```bash
copy .env.example .env
```

通用 OpenAI 兼容 API：

- `AI_API_KEY`
- `AI_BASE_URL`
- `AI_MODEL`
- `AI_PROVIDER_LABEL`

邮箱验证码登录使用 Resend REST API：

- `RESEND_API_KEY`
- `EMAIL_FROM`

注意：`RESEND_API_KEY` 是密钥，只能配置在 Cloudflare Pages 的环境变量或本地 `.env`，不能写进前端代码，也不能提交到 GitHub。

## 当前知识库能力

- 文本、标题、标签可以直接检索。
- `.txt`、`.md`、`.json` 文件会自动读取为文本。
- 图片和视频会保存文件，但不会自动理解画面或声音。
- 知识库命中后，会优先让 AI 基于命中的麦芽知识库资料做总结回答。
- 匹配分只代表问题和资料之间的关键词重合程度，不代表医学可信度、答案质量或百分制分数。
- 默认只有匹配分达到 10 及以上才算知识库命中；低于 10 会自动调用外部 AI API。

如果要让图片和视频也能真正参与问答，后续需要加 OCR、语音转文字和向量数据库。

## Cloudflare Pages 部署

推荐配置：

- Framework preset：`Vite`
- Build command：`npm run build`
- Build output directory：`dist`
- Production branch：`main`

项目包含 `functions/api/*`，Cloudflare Pages 部署后会提供同域 API：

- `GET /api/health`
- `GET /api/knowledge`
- `POST /api/knowledge`
- `DELETE /api/knowledge/:id`
- `POST /api/chat`
- `POST /api/auth/request-code`
- `POST /api/auth/verify`
- `GET /api/me`
- `PATCH /api/me`
- `GET /api/conversations`
- `PUT /api/conversations`

Cloudflare 需要配置：

- KV binding：`MAIYA_KV`
- AI 环境变量：`AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`、`AI_PROVIDER_LABEL`
- 邮件环境变量：`RESEND_API_KEY`、`EMAIL_FROM`

没有配置 `RESEND_API_KEY` 和 `EMAIL_FROM` 时，邮箱验证码登录接口会返回明确错误，无法真实发送验证码。
