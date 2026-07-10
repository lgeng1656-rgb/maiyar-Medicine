import { createSession, findOrCreateUser, json, verifyEmailCode } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const verified = await verifyEmailCode(env, {
      email: body.email,
      code: body.code,
      purpose: 'login',
    });
    const user = await findOrCreateUser(env, verified.email);
    const token = await createSession(env, user.id);
    return json({ ok: true, token, user });
  } catch (error) {
    return json({ error: error.message || '登录失败' }, { status: error.status || 500 });
  }
}
