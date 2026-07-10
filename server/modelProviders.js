const providerLabels = {
  api: process.env.AI_PROVIDER_LABEL || 'API 模型',
  deepseek: 'DeepSeek',
  qwen: '千问',
};

export function getProviderStatus() {
  return {
    api: Boolean(process.env.AI_API_KEY),
    deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
    qwen: Boolean(process.env.DASHSCOPE_API_KEY && process.env.QWEN_BASE_URL),
  };
}

export async function callExternalModel({ question, provider }) {
  const selectedProvider = selectProvider(provider);

  if (!selectedProvider) {
    return {
      provider: 'not-configured',
      label: '本地演示模式',
      answer: [
        '当前知识库没有命中，同时后端还没有配置可用 API Key。',
        '',
        '请在 `.env` 中填写 `AI_API_KEY`，或配置 `DEEPSEEK_API_KEY` / `DASHSCOPE_API_KEY`，然后重启后端。',
        '',
        '医疗提醒：没有真实模型时，这里不会生成医学建议。',
      ].join('\n'),
    };
  }

  if (selectedProvider === 'api') {
    return callOpenAICompatible({
      provider: 'api',
      label: providerLabels.api,
      baseUrl: process.env.AI_BASE_URL || 'https://api.siliconflow.cn/v1',
      apiKey: process.env.AI_API_KEY,
      model: process.env.AI_MODEL || 'deepseek-ai/DeepSeek-V4-Flash',
      question,
    });
  }

  if (selectedProvider === 'deepseek') {
    return callOpenAICompatible({
      provider: 'deepseek',
      label: providerLabels.deepseek,
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      question,
    });
  }

  return callOpenAICompatible({
    provider: 'qwen',
    label: providerLabels.qwen,
    baseUrl: process.env.QWEN_BASE_URL,
    apiKey: process.env.DASHSCOPE_API_KEY,
    model: process.env.QWEN_MODEL || 'qwen-plus',
    question,
  });
}

export async function summarizeKnowledgeAnswer({ question, matches, fallbackAnswer }) {
  const selectedProvider = selectProvider('api');
  if (!selectedProvider) {
    return fallbackAnswer;
  }

  const context = matches
    .slice(0, 5)
    .map((match, index) => {
      return [
        `资料 ${index + 1}`,
        `标题：${match.title}`,
        `相关度：${match.relevanceLabel}（匹配分 ${match.score}）`,
        `内容：${match.excerpt}`,
      ].join('\n');
    })
    .join('\n\n');

  const endpoint = `${(process.env.AI_BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/$/, '')}/chat/completions`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || 'deepseek-ai/DeepSeek-V4-Flash',
      messages: [
        {
          role: 'system',
          content:
            '你是麦芽医疗 AI 的知识库总结助手。必须只根据用户提供的“麦芽知识库资料”回答，不要编造资料外内容。回答用中文，先给直接结论，再用要点总结。若资料不足，要明确说资料不足。最后保留医疗学习免责声明。',
        },
        {
          role: 'user',
          content: [
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

  return data?.choices?.[0]?.message?.content || fallbackAnswer;
}

function selectProvider(provider) {
  const status = getProviderStatus();

  if (provider === 'api') return status.api ? 'api' : null;
  if (provider === 'deepseek') return status.deepseek ? 'deepseek' : null;
  if (provider === 'qwen') return status.qwen ? 'qwen' : null;

  if (status.api) return 'api';
  if (status.deepseek) return 'deepseek';
  if (status.qwen) return 'qwen';

  return null;
}

async function callOpenAICompatible({ provider, label, baseUrl, apiKey, model, question }) {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
        {
          role: 'user',
          content: question,
        },
      ],
      stream: false,
      temperature: 0.3,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error?.message || data?.message || `${label} API 调用失败`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return {
    provider,
    label,
    answer:
      data?.choices?.[0]?.message?.content ||
      '模型已返回结果，但响应里没有可显示的文本内容。',
  };
}
