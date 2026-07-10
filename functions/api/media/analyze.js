import { callVisualModel, json } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const frames = Array.isArray(body.frames) ? body.frames : [];
    const mediaType = ['video', 'pdf'].includes(body.mediaType) ? body.mediaType : 'image';
    const result = await callVisualModel(env, {
      frames,
      mediaType,
      prompt: body.prompt,
    });

    return json({
      ok: true,
      mediaType,
      frameCount: frames.length,
      model: result.model,
      analysis: result.analysis,
    });
  } catch (error) {
    return json({ error: error.message || '媒体分析失败' }, { status: error.status || 500 });
  }
}
