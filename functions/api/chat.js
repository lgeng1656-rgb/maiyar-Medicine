import {
  buildConversationContext,
  buildKnowledgeAnswer,
  callExternalModel,
  getKnowledgeItems,
  json,
  searchKnowledge,
  summarizeKnowledgeAnswer,
} from './_lib.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const question = String(body.question || '').trim();
    const provider = body.provider || 'auto';
    const messages = Array.isArray(body.messages) ? body.messages : [];

    if (!question) {
      return json({ error: '问题不能为空' }, { status: 400 });
    }

    const conversationContext = buildConversationContext(messages);
    const searchQuestion = [conversationContext, question].filter(Boolean).join('\n');
    const items = await getKnowledgeItems(env);
    const configuredMinScore = Number(env.KNOWLEDGE_MIN_SCORE || 10);
    const minScore = Number.isFinite(configuredMinScore) ? Math.max(configuredMinScore, 10) : 10;
    const matches = searchKnowledge(items, searchQuestion, minScore);

    if (matches.length > 0) {
      let answer;
      try {
        answer = await summarizeKnowledgeAnswer(env, {
          question,
          matches,
          conversationContext,
        });
      } catch {
        answer = buildKnowledgeAnswer(question, matches);
      }

      return json({
        answer,
        sourceType: 'knowledge',
        sourceLabel: '来自麦芽知识库',
        provider: 'maiya-knowledge',
        citations: matches.map((match) => ({
          id: match.id,
          title: match.title,
          score: match.score,
          relevanceLabel: match.relevanceLabel,
          scoreDescription: match.scoreDescription,
          tags: match.tags,
          sourceName: match.sourceName,
          excerpt: match.excerpt,
        })),
      });
    }

    const modelResult = await callExternalModel(env, { question, provider, messages });
    return json({
      answer: modelResult.answer,
      sourceType: 'external-ai',
      sourceLabel: `来自 ${modelResult.label}`,
      provider: modelResult.provider,
      citations: [],
    });
  } catch (error) {
    return json({ error: error.message || '服务器内部错误' }, { status: error.status || 500 });
  }
}
