import { getKnowledgeItems, getKnowledgeStats, json } from './_lib.js';

export async function onRequestGet({ env }) {
  const items = await getKnowledgeItems(env);
  return json({
    ok: true,
    app: 'maiya-medical-ai',
    providers: {
      api: Boolean(env.AI_API_KEY),
      deepseek: false,
      qwen: false,
    },
    knowledge: getKnowledgeStats(items),
  });
}
