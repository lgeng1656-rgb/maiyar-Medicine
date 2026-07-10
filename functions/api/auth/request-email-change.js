import { json, requestEmailCode, requireUser } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  try {
    const { user } = await requireUser(request, env);
    const body = await request.json();
    const result = await requestEmailCode(env, {
      email: body.email,
      purpose: 'email-change',
      userId: user.id,
    });
    return json({ ok: true, ...result });
  } catch (error) {
    return json({ error: error.message || '验证码发送失败' }, { status: error.status || 500 });
  }
}
