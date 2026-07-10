const KNOWLEDGE_KEY = 'knowledge-items';

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init.headers || {}),
    },
  });
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

export function searchKnowledge(items, question, minScore = 3) {
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
        excerpt: buildExcerpt(item, query, terms),
      };
    })
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export async function callExternalModel(env, { question, provider }) {
  const selectedProvider = selectProvider(env, provider);

  if (!selectedProvider) {
    return {
      provider: 'not-configured',
      label: '本地演示模式',
      answer: '当前知识库没有命中，同时 Cloudflare 还没有配置可用 API Key。',
    };
  }

  const baseUrl = env.AI_BASE_URL || 'https://api.deepseek.com';
  const model = env.AI_MODEL || 'deepseek-chat';
  const label = env.AI_PROVIDER_LABEL || 'API 模型';
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
            '你是一个严谨的医疗知识助手。回答必须使用中文，不能替代医生诊断。遇到急症、用药剂量、诊断结论时，要提醒用户咨询正规医疗机构。',
        },
        { role: 'user', content: question },
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
    answer:
      data?.choices?.[0]?.message?.content ||
      '模型已返回结果，但响应里没有可显示的文本内容。',
  };
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

  return [...new Set([...asciiWords, ...longerCjk, ...cjkChars])].filter(Boolean);
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
