import { json, requireUser, saveUser } from './_lib.js';

export async function onRequestGet({ request, env }) {
  try {
    const { user } = await requireUser(request, env);
    return json({ user });
  } catch (error) {
    return json({ error: error.message || '请先登录' }, { status: error.status || 500 });
  }
}

export async function onRequestPatch({ request, env }) {
  try {
    const { user } = await requireUser(request, env);
    const body = await request.json();
    const nextUser = {
      ...user,
      username: String(body.username || user.username || '').trim().slice(0, 40) || user.username,
      avatarUrl: String(body.avatarUrl || '').trim().slice(0, 500),
      updatedAt: new Date().toISOString(),
    };
    await saveUser(env, nextUser);
    return json({ ok: true, user: nextUser });
  } catch (error) {
    return json({ error: error.message || '用户设置保存失败' }, { status: error.status || 500 });
  }
}
