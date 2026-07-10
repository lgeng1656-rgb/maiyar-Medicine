import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const uploadDir = path.join(rootDir, 'uploads');
const knowledgeFile = path.join(dataDir, 'knowledge.json');

const searchableExtensions = new Set(['.txt', '.md', '.json', '.csv']);

export async function getKnowledgeItems() {
  return readItems();
}

export async function getKnowledgeStats() {
  const items = await readItems();
  return {
    total: items.length,
    indexed: items.filter((item) => item.status === 'indexed').length,
    fileCount: items.filter((item) => item.file).length,
  };
}

export async function addKnowledgeItem({ title, content, tags, sourceName, file }) {
  await ensureStorage();

  const safeTitle = String(title || '').trim();
  if (!safeTitle) {
    const error = new Error('标题不能为空');
    error.status = 400;
    throw error;
  }

  const uploadedText = file ? await extractTextFromFile(file) : '';
  const item = {
    id: uuidv4(),
    title: safeTitle,
    content: [String(content || '').trim(), uploadedText].filter(Boolean).join('\n\n'),
    tags: parseTags(tags),
    sourceName: String(sourceName || '麦芽知识库').trim(),
    status: 'indexed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    file: file
      ? {
          originalName: file.originalname,
          storedName: file.filename,
          mimeType: file.mimetype,
          size: file.size,
          url: `/uploads/${file.filename}`,
        }
      : null,
  };

  const items = await readItems();
  items.unshift(item);
  await writeItems(items);
  return item;
}

export async function deleteKnowledgeItem(id) {
  const items = await readItems();
  const target = items.find((item) => item.id === id);
  const nextItems = items.filter((item) => item.id !== id);
  await writeItems(nextItems);

  if (target?.file?.storedName) {
    const filePath = path.join(uploadDir, target.file.storedName);
    try {
      await fs.unlink(filePath);
    } catch {
      // 文件可能已被手动删除，不影响知识库记录删除。
    }
  }
}

export async function searchKnowledge(question) {
  const items = await readItems();
  const query = normalize(question);
  const terms = buildTerms(query);
  const minScore = Number(process.env.KNOWLEDGE_MIN_SCORE || 3);

  return items
    .map((item) => {
      const searchable = normalize(
        [item.title, item.content, item.tags.join(' '), item.sourceName].join(' '),
      );
      const score = scoreText(searchable, query, terms);
      return {
        ...item,
        score,
        relevanceLabel: getRelevanceLabel(score),
        scoreDescription: getScoreDescription(score),
        excerpt: buildExcerpt(item, query, terms),
      };
    })
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export function getRelevanceLabel(score) {
  if (score >= 20) return '高';
  if (score >= 10) return '中';
  return '低';
}

export function getScoreDescription(score) {
  return `匹配分 ${score} 只表示问题和资料在标题、标签、正文里的关键词重合程度，不代表医学可信度或百分制得分。`;
}

async function readItems() {
  await ensureStorage();

  try {
    const raw = await fs.readFile(knowledgeFile, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeItems(items) {
  await ensureStorage();
  await fs.writeFile(knowledgeFile, JSON.stringify(items, null, 2), 'utf8');
}

async function ensureStorage() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(uploadDir, { recursive: true });
}

async function extractTextFromFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!searchableExtensions.has(ext)) {
    return '';
  }

  try {
    const fullPath = path.join(uploadDir, file.filename);
    return await fs.readFile(fullPath, 'utf8');
  } catch {
    return '';
  }
}

function parseTags(tags) {
  return String(tags || '')
    .split(/[，,\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function buildTerms(query) {
  const asciiWords = query.match(/[a-z0-9_.%-]+/g) || [];
  const cjkChars = query.match(/[\u4e00-\u9fa5]/g) || [];
  const longerCjk = [];

  for (let index = 0; index < cjkChars.length - 1; index += 1) {
    longerCjk.push(`${cjkChars[index]}${cjkChars[index + 1]}`);
  }

  return [...new Set([...asciiWords, ...longerCjk, ...cjkChars])].filter(
    (term) => term.length > 0,
  );
}

function scoreText(text, query, terms) {
  let score = 0;

  if (query && text.includes(query)) {
    score += 20;
  }

  for (const term of terms) {
    if (term.length >= 2 && text.includes(term)) {
      score += 3;
    } else if (term.length === 1 && text.includes(term)) {
      score += 1;
    }
  }

  return score;
}

function buildExcerpt(item, query, terms) {
  const text = [item.content, item.title, item.tags.join(' ')].filter(Boolean).join(' ');
  const normalizedText = normalize(text);
  const hit = [query, ...terms].find((term) => term && normalizedText.includes(term));

  if (!text) {
    return '该资料只有文件或标题信息，暂未提取可检索正文。';
  }

  if (!hit) {
    return text.slice(0, 180);
  }

  const index = normalizedText.indexOf(hit);
  const start = Math.max(0, index - 70);
  const end = Math.min(text.length, index + 170);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}
