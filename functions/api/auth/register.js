import { createSession, json, registerUserWithPassword } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const user = await registerUserWithPassword(env, {
      email: body.email,
      password: body.password,
    });
    const token = await createSession(env, user.id);
    return json({ ok: true, token, user });
  } catch (error) {
    return json({ error: error.message || '注册失败' }, { status: error.status || 500 });
  }
}
