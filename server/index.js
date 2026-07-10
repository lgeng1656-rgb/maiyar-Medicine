import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addKnowledgeItem,
  deleteKnowledgeItem,
  getKnowledgeItems,
  getKnowledgeStats,
  searchKnowledge,
} from './knowledgeStore.js';
import { callExternalModel, getProviderStatus, summarizeKnowledgeAnswer } from './modelProviders.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const uploadDir = path.join(rootDir, 'uploads');

const app = express();
const port = Number(process.env.PORT || 8787);

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 200 * 1024 * 1024,
  },
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(uploadDir));

app.get('/api/health', async (req, res, next) => {
  try {
  res.json({
    ok: true,
    app: 'maiya-medical-ai',
    providers: getProviderStatus(),
    knowledge: await getKnowledgeStats(),
  });
  } catch (error) {
    next(error);
  }
});

app.get('/api/knowledge', async (req, res, next) => {
  try {
    res.json({ items: await getKnowledgeItems() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/knowledge', upload.single('file'), async (req, res, next) => {
  try {
    const item = await addKnowledgeItem({
      title: req.body.title,
      content: req.body.content,
      tags: req.body.tags,
      sourceName: req.body.sourceName,
      file: req.file,
    });

    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/knowledge/:id', async (req, res, next) => {
  try {
    await deleteKnowledgeItem(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/chat', async (req, res, next) => {
  try {
    const question = String(req.body.question || '').trim();
    const provider = req.body.provider || 'auto';

    if (!question) {
      res.status(400).json({ error: '问题不能为空' });
      return;
    }

    const matches = await searchKnowledge(question);
    if (matches.length > 0) {
      const fallbackAnswer = buildKnowledgeAnswer(question, matches);
      let answer = fallbackAnswer;
      try {
        answer = await summarizeKnowledgeAnswer({ question, matches, fallbackAnswer });
      } catch {
        answer = fallbackAnswer;
      }

      res.json({
        answer,
        sourceType: 'knowledge',
        sourceLabel: '来自麦芽知识库',
        provider: 'maiya-knowledge',
        citations: matches.map((match) => ({
          id: match.id,
          title: match.title,
          score: match.score,
          relevanceLabel: match.relevanceLabel,
          scoreDescription: match.scoreDescription,
          tags: match.tags,
          sourceName: match.sourceName,
          excerpt: match.excerpt,
        })),
      });
      return;
    }

    const modelResult = await callExternalModel({
      question,
      provider,
    });

    res.json({
      answer: modelResult.answer,
      sourceType: 'external-ai',
      sourceLabel: `来自 ${modelResult.label}`,
      provider: modelResult.provider,
      citations: [],
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.status || 500).json({
    error: error.message || '服务器内部错误',
  });
});

app.listen(port, () => {
  console.log(`Maiya Medical AI API running at http://localhost:${port}`);
});

function buildKnowledgeAnswer(question, matches) {
  const snippets = matches
    .slice(0, 3)
    .map((match, index) => {
      return `${index + 1}. 《${match.title}》：${match.excerpt}`;
    })
    .join('\n');

  return [
    `根据麦芽知识库中与“${question}”相关的资料，优先整理如下：`,
    '',
    snippets,
    '',
    '医疗提醒：以上内容只用于医学知识学习和辅助参考，不能替代医生面诊、诊断或治疗方案。涉及用药、检查、手术或急症，请以正规医疗机构医生意见为准。',
  ].join('\n');
}
