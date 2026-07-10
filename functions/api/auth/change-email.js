import { json, loginUserWithPassword, requireUser, updateUserEmail } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  try {
    const { user } = await requireUser(request, env);
    const body = await request.json();
    await loginUserWithPassword(env, {
      email: user.email,
      password: body.password,
    });
    const nextUser = await updateUserEmail(env, user, body.email);
    return json({ ok: true, user: nextUser });
  } catch (error) {
    return json({ error: error.message || '邮箱更换失败' }, { status: error.status || 500 });
  }
}
