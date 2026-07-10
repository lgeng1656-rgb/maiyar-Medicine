import { getUserConversations, json, requireUser, saveUserConversations } from './_lib.js';

export async function onRequestGet({ request, env }) {
  try {
    const { user } = await requireUser(request, env);
    const conversations = await getUserConversations(env, user.id);
    return json({ conversations });
  } catch (error) {
    return json({ error: error.message || '读取历史对话失败' }, { status: error.status || 500 });
  }
}

export async function onRequestPut({ request, env }) {
  try {
    const { user } = await requireUser(request, env);
    const body = await request.json();
    await saveUserConversations(env, user.id, body.conversations || []);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error.message || '保存历史对话失败' }, { status: error.status || 500 });
  }
}
