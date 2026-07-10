import { getKnowledgeItems, json, saveKnowledgeItems } from '../_lib.js';

export async function onRequestDelete({ env, params }) {
  const items = await getKnowledgeItems(env);
  const nextItems = items.filter((item) => item.id !== params.id);
  await saveKnowledgeItems(env, nextItems);
  return json({ ok: true });
}
