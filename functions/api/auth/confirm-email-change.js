import { json, requireUser, updateUserEmail, verifyEmailCode } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  try {
    const { user } = await requireUser(request, env);
    const body = await request.json();
    const verified = await verifyEmailCode(env, {
      email: body.email,
      code: body.code,
      purpose: 'email-change',
      userId: user.id,
    });
    const nextUser = await updateUserEmail(env, user, verified.email);
    return json({ ok: true, user: nextUser });
  } catch (error) {
    return json({ error: error.message || '邮箱更换失败' }, { status: error.status || 500 });
  }
}
