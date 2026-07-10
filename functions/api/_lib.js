const KNOWLEDGE_KEY = 'knowledge-items';
const CODE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init.headers || {}),
    },
  });
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function getKnowledgeItems(env) {
  const raw = await env.MAIYA_KV?.get(KNOWLEDGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function saveKnowledgeItems(env, items) {
  await env.MAIYA_KV.put(KNOWLEDGE_KEY, JSON.stringify(items));
}

export function getKnowledgeStats(items) {
  return {
    total: items.length,
    indexed: items.filter((item) => item.status === 'indexed').length,
    fileCount: items.filter((item) => item.file).length,
  };
}

export function searchKnowledge(items, question, minScore = 10) {
  const query = normalize(question);
  const terms = buildTerms(query);

  return items
    .map((item) => {
      const searchable = normalize(
        [item.title, item.content, (item.tags || []).join(' '), item.sourceName].join(' '),
      );
      const score = scoreText(searchable, query, terms);
      return {
        ...item,
        score,
        relevanceLabel: getRelevanceLabel(score),
        scoreDescription: getScoreDescription(score),
        excerpt: buildExcerpt(item, query, terms),
      };
    })
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export async function summarizeKnowledgeAnswer(env, { question, matches, conversationContext = '' }) {
  const selectedProvider = selectProvider(env, 'api');
  if (!selectedProvider) {
    return buildKnowledgeAnswer(question, matches);
  }

  const context = matches
    .slice(0, 5)
    .map((match, index) =>
      [
        `资料 ${index + 1}`,
        `标题：${match.title}`,
        `相关度：${match.relevanceLabel}（匹配分 ${match.score}）`,
        `内容：${match.excerpt}`,
      ].join('\n'),
    )
    .join('\n\n');

  const baseUrl = env.AI_BASE_URL || 'https://api.siliconflow.cn/v1';
  const model = env.AI_MODEL || 'deepseek-ai/DeepSeek-V4-Flash';
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.AI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            '你是麦芽医疗 AI 的知识库总结助手。必须只根据用户提供的“麦芽知识库资料”回答，不要编造资料外内容。回答用中文，先给直接结论，再用要点总结。若资料不足，要明确说资料不足。最后保留医疗学习免责声明。',
        },
        {
          role: 'user',
          content: [
            conversationContext ? `当前对话上下文：\n${conversationContext}` : '',
            '',
            `用户问题：${question}`,
            '',
            '麦芽知识库资料：',
            context,
            '',
            '请基于以上资料做总结回答，不要只复制原文。',
          ].join('\n'),
        },
      ],
      stream: false,
      temperature: 0.2,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || '知识库总结失败');
  }

  return data?.choices?.[0]?.message?.content || buildKnowledgeAnswer(question, matches);
}

export async function callExternalModel(env, { question, provider, messages = [] }) {
  const selectedProvider = selectProvider(env, provider);

  if (!selectedProvider) {
    return {
      provider: 'not-configured',
      label: '本地演示模式',
      answer: '当前知识库没有命中，同时 Cloudflare 还没有配置可用 API Key。',
    };
  }

  const baseUrl = env.AI_BASE_URL || 'https://api.siliconflow.cn/v1';
  const model = env.AI_MODEL || 'deepseek-ai/DeepSeek-V4-Flash';
  const label = env.AI_PROVIDER_LABEL || '硅基流动';
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const conversationMessages = buildModelMessages(messages, question);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.AI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            '你是一个严谨的医疗知识助手。回答必须使用中文，不能替代医生诊断。遇到急症、用药剂量、诊断结论时，要提醒用户咨询正规医疗机构。',
        },
        ...conversationMessages,
      ],
      stream: false,
      temperature: 0.3,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `${label} API 调用失败`);
  }

  return {
    provider: selectedProvider,
    label,
    answer: data?.choices?.[0]?.message?.content || '模型已返回结果，但响应里没有可显示的文本内容。',
  };
}

export async function callVisualModel(env, { frames, prompt, mediaType }) {
  const visualBaseUrl = env.QWEN_VL_BASE_URL || '';
  const visualApiKey = selectVisualApiKey(env, visualBaseUrl);
  if (!visualApiKey || !env.QWEN_VL_BASE_URL) {
    const error = new Error(
      '还没有配置千问视觉模型。请配置 QWEN_VL_API_KEY 或 SILICONFLOW_API_KEY，并配置 QWEN_VL_BASE_URL 和 QWEN_VL_MODEL。',
    );
    error.status = 503;
    throw error;
  }

  const normalizedFrames = Array.isArray(frames) ? frames.slice(0, 8) : [];
  if (normalizedFrames.length === 0) {
    const error = new Error('没有可分析的图片或视频帧');
    error.status = 400;
    throw error;
  }

  const endpoint = `${env.QWEN_VL_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  const model = env.QWEN_VL_MODEL || 'Qwen/Qwen3.6-35B-A3B';
  const content = [
    {
      type: 'text',
      text:
        prompt ||
        [
          `请分析这些${mediaType === 'video' ? '视频关键帧' : '图片'}中的病例、手术、器械、文字信息。`,
          '请尽量提取画面里的中文文字、患者基本信息、诊断、主诉、手术名称、医生姓名、操作步骤、器械名称。',
          '如果无法确定，请明确写“无法确定”，不要编造。',
          '输出为中文结构化摘要，供知识库检索使用。',
        ].join('\n'),
    },
    ...normalizedFrames.map((url) => ({
      type: 'image_url',
      image_url: { url },
    })),
  ];

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${visualApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      stream: false,
      temperature: 0.1,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const upstreamMessage =
      data?.error?.message ||
      data?.message ||
      (data?.error ? JSON.stringify(data.error) : '') ||
      JSON.stringify(data).slice(0, 300);
    const error = new Error(upstreamMessage || '千问视觉模型分析失败');
    error.status = 502;
    throw error;
  }

  return {
    model,
    analysis: data?.choices?.[0]?.message?.content || '',
  };
}

function selectVisualApiKey(env, baseUrl) {
  const normalizedBaseUrl = String(baseUrl || '').toLowerCase();
  if (normalizedBaseUrl.includes('siliconflow')) {
    return env.SILICONFLOW_API_KEY || env.QWEN_VL_API_KEY || env.DASHSCOPE_API_KEY;
  }
  if (normalizedBaseUrl.includes('dashscope') || normalizedBaseUrl.includes('aliyuncs')) {
    return env.DASHSCOPE_API_KEY || env.QWEN_VL_API_KEY || env.SILICONFLOW_API_KEY;
  }
  return env.QWEN_VL_API_KEY || env.SILICONFLOW_API_KEY || env.DASHSCOPE_API_KEY;
}

export function buildKnowledgeAnswer(question, matches) {
  const snippets = matches
    .slice(0, 3)
    .map((match, index) => `${index + 1}. 《${match.title}》：${match.excerpt}`)
    .join('\n');

  return [
    `根据麦芽知识库中与“${question}”相关的资料，优先整理如下：`,
    '',
    snippets,
    '',
    '医疗提醒：以上内容只用于医学知识学习和辅助参考，不能替代医生面诊、诊断或治疗方案。',
  ].join('\n');
}

export function getRelevanceLabel(score) {
  if (score >= 20) return '高';
  if (score >= 10) return '中';
  return '低';
}

export function getScoreDescription(score) {
  return `匹配分 ${score} 只表示问题和资料在标题、标签、正文里的关键词重合程度，不代表医学可信度或百分制得分。`;
}

export async function requestEmailCode(env, { email, purpose = 'login', userId = null }) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    const error = new Error('请输入有效邮箱');
    error.status = 400;
    throw error;
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const payload = {
    email: normalizedEmail,
    code,
    purpose,
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + CODE_TTL_SECONDS * 1000,
  };

  await env.MAIYA_KV.put(codeKey(purpose, normalizedEmail, userId), JSON.stringify(payload), {
    expirationTtl: CODE_TTL_SECONDS,
  });

  await sendVerificationEmail(env, normalizedEmail, code, purpose);
  return { email: normalizedEmail, expiresIn: CODE_TTL_SECONDS };
}

export async function verifyEmailCode(env, { email, code, purpose = 'login', userId = null }) {
  const normalizedEmail = normalizeEmail(email);
  const raw = await env.MAIYA_KV.get(codeKey(purpose, normalizedEmail, userId));
  const saved = raw ? JSON.parse(raw) : null;

  if (!saved || saved.code !== String(code || '').trim() || saved.expiresAt < Date.now()) {
    const error = new Error('验证码无效或已过期');
    error.status = 400;
    throw error;
  }

  await env.MAIYA_KV.delete(codeKey(purpose, normalizedEmail, userId));
  return saved;
}

export async function findOrCreateUser(env, email) {
  const normalizedEmail = normalizeEmail(email);
  const emailKey = userEmailKey(normalizedEmail);
  const existingId = await env.MAIYA_KV.get(emailKey);
  if (existingId) {
    return getUser(env, existingId);
  }

  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    username: normalizedEmail.split('@')[0] || '麦芽用户',
    avatarUrl: '',
    createdAt: now,
    updatedAt: now,
  };
  await saveUser(env, user);
  await env.MAIYA_KV.put(emailKey, user.id);
  return user;
}

export async function registerUserWithPassword(env, { email, password }) {
  const normalizedEmail = normalizeEmail(email);
  validatePasswordInput(normalizedEmail, password);

  const existingId = await env.MAIYA_KV.get(userEmailKey(normalizedEmail));
  if (existingId) {
    const error = new Error('这个邮箱已经注册，请直接登录');
    error.status = 409;
    throw error;
  }

  const now = new Date().toISOString();
  const passwordRecord = await hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    username: normalizedEmail.split('@')[0] || '麦芽用户',
    avatarUrl: '',
    password: passwordRecord,
    createdAt: now,
    updatedAt: now,
  };

  await saveUser(env, user);
  await env.MAIYA_KV.put(userEmailKey(normalizedEmail), user.id);
  return user;
}

export async function loginUserWithPassword(env, { email, password }) {
  const normalizedEmail = normalizeEmail(email);
  validatePasswordInput(normalizedEmail, password);

  const userId = await env.MAIYA_KV.get(userEmailKey(normalizedEmail));
  const user = userId ? await getUser(env, userId) : null;
  const valid = user?.password ? await verifyPassword(password, user.password) : false;

  if (!user || !valid) {
    const error = new Error('邮箱或密码不正确');
    error.status = 401;
    throw error;
  }

  return user;
}

export async function getUser(env, userId) {
  const raw = await env.MAIYA_KV.get(userKey(userId));
  return raw ? JSON.parse(raw) : null;
}

export async function saveUser(env, user) {
  await env.MAIYA_KV.put(userKey(user.id), JSON.stringify(user));
}

export async function createSession(env, userId) {
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const session = {
    token,
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
  await env.MAIYA_KV.put(sessionKey(token), JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
}

export async function requireUser(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    const error = new Error('请先登录');
    error.status = 401;
    throw error;
  }

  const raw = await env.MAIYA_KV.get(sessionKey(token));
  const session = raw ? JSON.parse(raw) : null;
  if (!session || session.expiresAt < Date.now()) {
    const error = new Error('登录已过期，请重新登录');
    error.status = 401;
    throw error;
  }

  const user = await getUser(env, session.userId);
  if (!user) {
    const error = new Error('用户不存在');
    error.status = 401;
    throw error;
  }

  return { user, token };
}

export async function updateUserEmail(env, user, newEmail) {
  const normalizedEmail = normalizeEmail(newEmail);
  const currentEmail = normalizeEmail(user.email);
  if (normalizedEmail === currentEmail) return user;

  const existingId = await env.MAIYA_KV.get(userEmailKey(normalizedEmail));
  if (existingId && existingId !== user.id) {
    const error = new Error('这个邮箱已经被其他账号使用');
    error.status = 409;
    throw error;
  }

  await env.MAIYA_KV.delete(userEmailKey(currentEmail));
  await env.MAIYA_KV.put(userEmailKey(normalizedEmail), user.id);
  const nextUser = { ...user, email: normalizedEmail, updatedAt: new Date().toISOString() };
  await saveUser(env, nextUser);
  return nextUser;
}

export async function getUserConversations(env, userId) {
  const raw = await env.MAIYA_KV.get(conversationsKey(userId));
  return raw ? JSON.parse(raw) : [];
}

export async function saveUserConversations(env, userId, conversations) {
  await env.MAIYA_KV.put(conversationsKey(userId), JSON.stringify(sanitizeConversations(conversations)));
}

export function buildConversationContext(messages = []) {
  return sanitizeMessageHistory(messages)
    .slice(-8)
    .map((message) => `${message.role === 'user' ? '用户' : 'AI'}：${message.content}`)
    .join('\n');
}

async function sendVerificationEmail(env, email, code, purpose) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    const error = new Error('还没有配置邮件服务。请在 Cloudflare 环境变量里配置 RESEND_API_KEY 和 EMAIL_FROM。');
    error.status = 503;
    throw error;
  }

  const title = purpose === 'email-change' ? '麦芽医疗 AI 更换邮箱验证码' : '麦芽医疗 AI 登录验证码';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email],
      subject: title,
      html: `<p>你的验证码是：</p><h2>${code}</h2><p>10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。</p>`,
      text: `你的验证码是：${code}。10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。`,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || data?.error?.message || '验证码邮件发送失败');
    error.status = 502;
    throw error;
  }
}

function sanitizeConversations(value) {
  const conversations = Array.isArray(value) ? value : [];
  return conversations.slice(0, 80).map((conversation) => ({
    id: String(conversation.id || crypto.randomUUID()),
    title: String(conversation.title || '新对话').slice(0, 80),
    createdAt: String(conversation.createdAt || new Date().toISOString()),
    updatedAt: String(conversation.updatedAt || new Date().toISOString()),
    messages: Array.isArray(conversation.messages)
      ? conversation.messages.slice(-200).map((message) => ({
          id: String(message.id || crypto.randomUUID()),
          role: message.role === 'user' ? 'user' : 'assistant',
          answer: String(message.answer || '').slice(0, 12000),
          sourceLabel: message.sourceLabel ? String(message.sourceLabel).slice(0, 80) : undefined,
          citations: Array.isArray(message.citations) ? message.citations.slice(0, 8) : [],
          createdAt: String(message.createdAt || new Date().toISOString()),
        }))
      : [],
  }));
}

function buildModelMessages(messages, question) {
  const history = sanitizeMessageHistory(messages).slice(-8);
  const last = history[history.length - 1];
  const shouldAppendQuestion = !last || last.role !== 'user' || last.content !== question;
  const finalHistory = shouldAppendQuestion ? [...history, { role: 'user', content: question }] : history;

  return finalHistory.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function sanitizeMessageHistory(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message.content || message.answer || '').trim().slice(0, 4000),
    }))
    .filter((message) => message.content);
}

function validatePasswordInput(email, password) {
  if (!isValidEmail(email)) {
    const error = new Error('请输入有效邮箱');
    error.status = 400;
    throw error;
  }
  if (String(password || '').length < 8) {
    const error = new Error('密码至少需要 8 位');
    error.status = 400;
    throw error;
  }
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;
  const hash = await pbkdf2(password, salt, iterations);
  return {
    algorithm: 'PBKDF2-SHA-256',
    iterations,
    salt: bytesToBase64(salt),
    hash: bytesToBase64(hash),
  };
}

async function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash) return false;
  const salt = base64ToBytes(record.salt);
  const expected = base64ToBytes(record.hash);
  const actual = await pbkdf2(password, salt, Number(record.iterations || 100000));
  return timingSafeEqual(actual, expected);
}

async function pbkdf2(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function selectProvider(env, provider) {
  if (provider === 'api' || provider === 'auto') {
    return env.AI_API_KEY ? 'api' : null;
  }
  return env.AI_API_KEY ? 'api' : null;
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function buildTerms(query) {
  const asciiWords = query.match(/[a-z0-9_.%-]+/g) || [];
  const cjkChars = query.match(/[\u4e00-\u9fa5]/g) || [];
  const longerCjk = [];

  for (let index = 0; index < cjkChars.length - 1; index += 1) {
    longerCjk.push(`${cjkChars[index]}${cjkChars[index + 1]}`);
  }

  return [...new Set([...asciiWords, ...longerCjk])].filter(Boolean);
}

function scoreText(text, query, terms) {
  let score = 0;
  if (query && text.includes(query)) score += 20;

  for (const term of terms) {
    if (term.length >= 2 && text.includes(term)) score += 3;
    else if (term.length === 1 && text.includes(term)) score += 1;
  }

  return score;
}

function buildExcerpt(item, query, terms) {
  const text = [item.content, item.title, (item.tags || []).join(' ')].filter(Boolean).join(' ');
  const normalizedText = normalize(text);
  const hit = [query, ...terms].find((term) => term && normalizedText.includes(term));

  if (!text) return '该资料只有文件或标题信息，暂未提取可检索正文。';
  if (!hit) return text.slice(0, 180);

  const index = normalizedText.indexOf(hit);
  const start = Math.max(0, index - 70);
  const end = Math.min(text.length, index + 170);
  return `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`;
}

function codeKey(purpose, email, userId) {
  return `email-code:${purpose}:${userId || 'anonymous'}:${email}`;
}

function userKey(userId) {
  return `user:${userId}`;
}

function userEmailKey(email) {
  return `user-email:${email}`;
}

function sessionKey(token) {
  return `session:${token}`;
}

function conversationsKey(userId) {
  return `conversations:${userId}`;
}
