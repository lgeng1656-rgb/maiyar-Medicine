# 麦芽医疗 AI

这是一个医疗 AI 网站雏形，包含：

- `/Web/`：用户提问页面，历史对话在侧边栏，用户消息靠右，AI 回答靠左。
- `/admin/`：知识库上传和管理页面。
- 知识库优先：问题和麦芽知识库资料足够相关时，优先使用知识库并标注“来自麦芽知识库”。
- 外部 AI 兜底：知识库没有足够相关资料时，自动调用已配置的外部 AI API。
- 邮箱密码登录：同一邮箱账号登录后，可跨设备读取历史对话，并支持用户名、头像和邮箱更换。
- 图片/视频理解：图片会交给千问视觉模型提取文字和病例信息；视频会在浏览器抽取关键帧后交给千问分析。
- 上下文追问：提问时会把当前对话最近几轮消息传给后端，支持“这场手术”“杨波参与的那场”等追问。

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

图片和视频抽帧分析使用千问视觉模型：

- `QWEN_VL_API_KEY`（推荐）
- `SILICONFLOW_API_KEY`（如果使用硅基流动）
- `DASHSCOPE_API_KEY`（旧变量名，仍然兼容）
- `QWEN_VL_BASE_URL`
- `QWEN_VL_MODEL`

当前视觉模型配置：

- `QWEN_VL_BASE_URL=https://api.siliconflow.cn/v1`
- `QWEN_VL_MODEL=Qwen/Qwen3-VL-32B-Instruct`

当前实现不会把 20MB 视频整段传给后端，而是在浏览器本地抽取最多 6 张关键帧，再把压缩后的图片帧发送给后端调用千问视觉模型。这样速度更快，也避免 Cloudflare Functions 处理大文件上传。

## 当前知识库能力

- 文本、标题、标签可以直接检索。
- `.txt`、`.md`、`.json` 文件会自动读取为文本。
- 图片和视频会保存文件元信息；为了避免大视频上传很慢，视频默认不整段保存到后端。
- 配置千问视觉模型后，图片和视频帧会生成“图片/视频 AI 解析”文字，并写入知识库参与检索。
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
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/change-email`
- `GET /api/me`
- `PATCH /api/me`
- `GET /api/conversations`
- `PUT /api/conversations`

Cloudflare 需要配置：

- KV binding：`MAIYA_KV`
- AI 环境变量：`AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`、`AI_PROVIDER_LABEL`
- 千问视觉环境变量：`QWEN_VL_API_KEY` 或 `SILICONFLOW_API_KEY`，以及 `QWEN_VL_BASE_URL`、`QWEN_VL_MODEL`

没有配置千问视觉环境变量时，图片/视频解析接口会返回明确错误，普通文字知识库和聊天仍可使用。
