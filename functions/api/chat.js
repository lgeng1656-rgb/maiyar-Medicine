import {
  buildKnowledgeAnswer,
  callExternalModel,
  getKnowledgeItems,
  json,
  searchKnowledge,
} from './_lib.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const question = String(body.question || '').trim();
    const provider = body.provider || 'auto';

    if (!question) {
      return json({ error: '问题不能为空' }, { status: 400 });
    }

    const items = await getKnowledgeItems(env);
    const matches = searchKnowledge(items, question, Number(env.KNOWLEDGE_MIN_SCORE || 3));

    if (matches.length > 0) {
      return json({
        answer: buildKnowledgeAnswer(question, matches),
        sourceType: 'knowledge',
        sourceLabel: '来自麦芽知识库',
        provider: 'maiya-knowledge',
        citations: matches.map((match) => ({
          id: match.id,
          title: match.title,
          score: match.score,
          tags: match.tags,
          sourceName: match.sourceName,
          excerpt: match.excerpt,
        })),
      });
    }

    const modelResult = await callExternalModel(env, { question, provider });
    return json({
      answer: modelResult.answer,
      sourceType: 'external-ai',
      sourceLabel: `来自 ${modelResult.label}`,
      provider: modelResult.provider,
      citations: [],
    });
  } catch (error) {
    return json({ error: error.message || '服务器内部错误' }, { status: 500 });
  }
}
