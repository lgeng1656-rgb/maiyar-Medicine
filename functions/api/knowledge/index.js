import { getKnowledgeItems, json, saveKnowledgeItems } from '../_lib.js';

export async function onRequestGet({ env }) {
  const items = await getKnowledgeItems(env);
  return json({ items });
}

export async function onRequestPost({ request, env }) {
  try {
    const form = await request.formData();
    const title = String(form.get('title') || '').trim();

    if (!title) {
      return json({ error: '标题不能为空' }, { status: 400 });
    }

    const file = form.get('file');
    const mediaAnalysis = String(form.get('mediaAnalysis') || '').trim();
    let fileText = '';
    let fileMeta = buildFileMetaFromForm(form);

    if (file && typeof file === 'object' && 'name' in file && file.size > 0) {
      fileMeta = {
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
      };

      if (isTextFile(file.name, file.type)) {
        fileText = await file.text();
      }
    }

    const content = [
      String(form.get('content') || '').trim(),
      mediaAnalysis ? `图片/视频 AI 解析：\n${mediaAnalysis}` : '',
      fileText,
    ]
      .filter(Boolean)
      .join('\n\n');

    const item = {
      id: crypto.randomUUID(),
      title,
      content,
      tags: parseTags(form.get('tags')),
      sourceName: String(form.get('sourceName') || '麦芽知识库').trim(),
      status: 'indexed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      file: fileMeta,
    };

    const items = await getKnowledgeItems(env);
    items.unshift(item);
    await saveKnowledgeItems(env, items);
    return json({ item }, { status: 201 });
  } catch (error) {
    return json({ error: error.message || '上传失败' }, { status: 500 });
  }
}

function parseTags(tags) {
  return String(tags || '')
    .split(/[,，\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function buildFileMetaFromForm(form) {
  const originalName = String(form.get('fileName') || '').trim();
  if (!originalName) return null;

  return {
    originalName,
    mimeType: String(form.get('fileType') || '').trim(),
    size: Number(form.get('fileSize') || 0),
    stored: false,
  };
}

function isTextFile(name, type) {
  return (
    type.startsWith('text/') ||
    ['.txt', '.md', '.json', '.csv'].some((ext) => name.toLowerCase().endsWith(ext))
  );
}
