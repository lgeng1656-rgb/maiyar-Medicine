# 麦芽医疗 AI

这是一个医疗 AI 网站雏形，包含：

- 用户提问页面：优先检索本地“麦芽知识库”，命中后标注 `来自麦芽知识库`。
- 外部模型兜底：知识库没有命中时，可调用 DeepSeek 或千问，并标注来源。
- 后台上传页面：上传文字、图片、视频等资料，并维护标题、标签、文字内容。

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

说明：这里的“前端用户网站”和“后台知识库网站”是两个独立访问入口。开发阶段它们共用同一个 Vite 服务，正式部署时可以继续保持两个路径，也可以拆成两个域名。

## 配置 API Key

复制 `.env.example` 为 `.env`，再填写后端环境变量。不要把 `.env` 提交到 GitHub。

```bash
copy .env.example .env
```

通用 OpenAI 兼容 API：

- `AI_API_KEY`
- `AI_BASE_URL`
- `AI_MODEL`
- `AI_PROVIDER_LABEL`

当前线上默认按硅基流动配置：

- `AI_BASE_URL=https://api.siliconflow.cn/v1`
- `AI_MODEL=deepseek-ai/DeepSeek-V4-Flash`
- `AI_PROVIDER_LABEL=硅基流动`

DeepSeek：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL`
- `DEEPSEEK_BASE_URL`

千问/阿里云百炼：

- `DASHSCOPE_API_KEY`
- `QWEN_MODEL`
- `QWEN_BASE_URL`

## 当前知识库能力

当前版本是本地 MVP：

- 文本、标题、标签可以直接检索。
- `.txt`、`.md`、`.json` 文件会自动读取为文本。
- 图片和视频会保存文件，但不会自动理解画面或声音。

如果要让图片和视频也能真正参与问答，后续需要加 OCR、语音转文字和向量数据库。

## Cloudflare Pages 部署

Cloudflare Pages 推荐配置：

- Framework preset：`Vite`
- Build command：`npm run build`
- Build output directory：`dist`
- Production branch：`main`

项目已包含 `functions/api/*`，Cloudflare Pages 部署后会提供同域 API：

- `GET /api/health`
- `GET /api/knowledge`
- `POST /api/knowledge`
- `DELETE /api/knowledge/:id`
- `POST /api/chat`

Cloudflare 需要配置：

- KV binding：`MAIYA_KV`
- Environment variables：`AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`、`AI_PROVIDER_LABEL`、`KNOWLEDGE_MIN_SCORE`

不要把 `AI_API_KEY` 写进前端代码，也不要提交 `.env`。
