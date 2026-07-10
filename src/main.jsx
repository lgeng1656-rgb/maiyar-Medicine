import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const STORAGE_KEY = 'maiya-medical-ai-conversations';

function App() {
  const path = window.location.pathname;
  if (path.startsWith('/admin')) return <AdminPage />;
  if (path.startsWith('/Web')) return <ChatPage />;
  return <EntryPage />;
}

function EntryPage() {
  return (
    <div className="entry-page">
      <div className="entry-card">
        <div className="app-logo">
          <div className="logo-mark">麦</div>
          <div>
            <strong>麦芽医疗 AI</strong>
            <span>请选择入口</span>
          </div>
        </div>
        <div className="entry-actions">
          <a href="/Web/">进入前端用户网站</a>
          <a href="/admin/">进入后台知识库网站</a>
        </div>
      </div>
    </div>
  );
}

function ChatPage() {
  const [question, setQuestion] = useState('');
  const [provider, setProvider] = useState('auto');
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [conversations, setConversations] = useState(() => loadConversations());
  const [activeId, setActiveId] = useState(() => conversations[0]?.id || null);
  const messagesEndRef = useRef(null);

  const activeConversation = useMemo(() => {
    return conversations.find((item) => item.id === activeId) || null;
  }, [activeId, conversations]);

  const filteredConversations = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return conversations;
    return conversations.filter((item) => item.title.toLowerCase().includes(keyword));
  }, [conversations, searchText]);

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeConversation?.messages, loading]);

  function createNewChat() {
    const conversation = createConversation();
    setConversations((current) => [conversation, ...current]);
    setActiveId(conversation.id);
    setQuestion('');
  }

  async function sendQuestion(event) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const currentConversation = activeConversation || createConversation(trimmed);
    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      answer: trimmed,
      createdAt: new Date().toISOString(),
    };

    setQuestion('');
    setLoading(true);
    upsertConversation(currentConversation.id, {
      ...currentConversation,
      title: currentConversation.title === '新对话' ? buildTitle(trimmed) : currentConversation.title,
      updatedAt: new Date().toISOString(),
      messages: [...currentConversation.messages, userMessage],
    });
    setActiveId(currentConversation.id);

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed, provider }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '请求失败');

      const assistantMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        answer: data.answer,
        sourceLabel: data.sourceLabel,
        citations: data.citations || [],
        createdAt: new Date().toISOString(),
      };
      appendMessage(currentConversation.id, assistantMessage);
    } catch (error) {
      appendMessage(currentConversation.id, {
        id: crypto.randomUUID(),
        role: 'assistant',
        sourceLabel: '系统错误',
        answer: error.message,
        citations: [],
        createdAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }

  function appendMessage(conversationId, message) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              updatedAt: new Date().toISOString(),
              messages: [...conversation.messages, message],
            }
          : conversation,
      ),
    );
  }

  function upsertConversation(conversationId, nextConversation) {
    setConversations((current) => {
      const exists = current.some((conversation) => conversation.id === conversationId);
      const next = exists
        ? current.map((conversation) =>
            conversation.id === conversationId ? nextConversation : conversation,
          )
        : [nextConversation, ...current];

      return next.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    });
  }

  function deleteConversation(conversationId) {
    setConversations((current) => {
      const next = current.filter((conversation) => conversation.id !== conversationId);
      if (activeId === conversationId) setActiveId(next[0]?.id || null);
      return next;
    });
  }

  const hasMessages = Boolean(activeConversation?.messages.length);

  return (
    <div className="chatgpt-shell">
      <aside className="chat-sidebar">
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <strong>麦芽医疗 AI</strong>
            <button type="button" aria-label="折叠侧边栏">
              <Icon name="panel" />
            </button>
          </div>

          <button className="sidebar-action active" type="button" onClick={createNewChat}>
            <Icon name="edit" />
            新聊天
          </button>

          <label className="sidebar-search">
            <Icon name="search" />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="搜索聊天"
            />
          </label>

          <a className="sidebar-action" href="/admin/">
            <Icon name="folder" />
            知识库后台
          </a>

          <div className="sidebar-status">
            <span>知识库 {health?.knowledge?.total ?? '-'} 条</span>
            <span>API {providerStatusText(health)}</span>
          </div>
        </div>

        <div className="history-block">
          <h2>最近</h2>
          <div className="history-list">
            {filteredConversations.map((conversation) => (
              <button
                key={conversation.id}
                className={conversation.id === activeId ? 'history-item selected' : 'history-item'}
                type="button"
                onClick={() => setActiveId(conversation.id)}
              >
                <span>{conversation.title}</span>
                <small>{formatDate(conversation.updatedAt)}</small>
              </button>
            ))}
            {filteredConversations.length === 0 && (
              <p className="empty-history">还没有历史对话。</p>
            )}
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="avatar">麦</div>
          <div>
            <strong>GG</strong>
            <span>医疗知识库助手</span>
          </div>
        </div>
      </aside>

      <main className="chat-surface">
        <header className="chat-topbar">
          <span>麦芽医疗 AI</span>
          {activeConversation && (
            <button type="button" onClick={() => deleteConversation(activeConversation.id)}>
              删除当前对话
            </button>
          )}
        </header>

        <section className={hasMessages ? 'chat-thread' : 'chat-thread empty-state'}>
          {!hasMessages && (
            <div className="ready-state">
              <h1>准备好了，随时开始</h1>
              <p>先查麦芽知识库；如果没有命中，再调用已配置的 API。</p>
            </div>
          )}

          {activeConversation?.messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {loading && <div className="loading-line">正在检索知识库并生成回答...</div>}
          <div ref={messagesEndRef} />
        </section>

        <form className="gpt-composer" onSubmit={sendQuestion}>
          <button className="round-tool" type="button" title="上传入口在后台知识库">
            +
          </button>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendQuestion(event);
              }
            }}
            placeholder="有问题，尽管问"
            rows={1}
          />
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="auto">均衡</option>
            <option value="api">API</option>
            <option value="deepseek">DeepSeek</option>
            <option value="qwen">千问</option>
          </select>
          <button className="send-button" type="submit" disabled={loading || !question.trim()}>
            ↑
          </button>
        </form>

        <p className="medical-disclaimer">
          医疗内容仅供学习和辅助参考，不能替代医生面诊、诊断或治疗。
        </p>
      </main>
    </div>
  );
}

function AdminPage() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({
    title: '',
    tags: '',
    sourceName: '麦芽知识库',
    content: '',
  });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    loadKnowledge();
  }, []);

  async function loadKnowledge() {
    const response = await fetch(`${API_BASE}/api/knowledge`);
    const data = await response.json();
    setItems(data.items || []);
  }

  async function submitKnowledge(event) {
    event.preventDefault();
    setSaving(true);
    setNotice('');

    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.append(key, value));
      if (file) body.append('file', file);

      const response = await fetch(`${API_BASE}/api/knowledge`, {
        method: 'POST',
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '上传失败');

      setForm({ title: '', tags: '', sourceName: '麦芽知识库', content: '' });
      setFile(null);
      setNotice('上传并索引完成');
      await loadKnowledge();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(id) {
    const response = await fetch(`${API_BASE}/api/knowledge/${id}`, {
      method: 'DELETE',
    });
    if (response.ok) await loadKnowledge();
  }

  return (
    <div className="admin-layout">
      <aside className="admin-nav">
        <div className="app-logo compact">
          <div className="logo-mark">麦</div>
          <strong>知识库管理</strong>
        </div>
        <a href="/Web/">返回前端网站</a>
        <span>上传与管理</span>
      </aside>

      <main className="admin-main">
        <header className="admin-header">
          <div>
            <h1>上传麦芽知识库资料</h1>
            <p>支持文档、图片、视频等资料。当前版本会保存文件，并检索标题、标签和文字内容。</p>
          </div>
        </header>

        <section className="admin-grid">
          <form className="upload-panel" onSubmit={submitKnowledge}>
            <label>
              标题 *
              <input
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="例如：中国2型糖尿病防治指南"
                required
              />
            </label>

            <label>
              标签
              <input
                value={form.tags}
                onChange={(event) => setForm({ ...form, tags: event.target.value })}
                placeholder="糖尿病, 用药, 指南"
              />
            </label>

            <label>
              所属知识库
              <input
                value={form.sourceName}
                onChange={(event) => setForm({ ...form, sourceName: event.target.value })}
              />
            </label>

            <label>
              可检索文字内容
              <textarea
                value={form.content}
                onChange={(event) => setForm({ ...form, content: event.target.value })}
                placeholder="把核心文字、视频转写、图片说明或摘要粘贴到这里，问答时会优先检索这些内容。"
                rows={8}
              />
            </label>

            <label className="dropzone">
              <input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} />
              <strong>{file ? file.name : '选择文件或拖拽上传'}</strong>
              <span>支持 PDF、DOCX、TXT、MD、JPG、PNG、MP4 等，单文件最大 200MB。</span>
            </label>

            <button type="submit" disabled={saving}>
              {saving ? '上传中...' : '上传并解析'}
            </button>
            {notice && <p className="notice">{notice}</p>}
          </form>

          <section className="table-panel">
            <div className="table-title">
              <h2>已上传资料</h2>
              <span>共 {items.length} 条</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>标题</th>
                    <th>标签</th>
                    <th>文件</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.title}</strong>
                        <small>{new Date(item.createdAt).toLocaleString()}</small>
                      </td>
                      <td>{item.tags.join('、') || '-'}</td>
                      <td>{item.file?.originalName || '纯文本'}</td>
                      <td>
                        <span className="pill">已索引</span>
                      </td>
                      <td>
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => removeItem(item.id)}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan="5" className="empty-cell">
                        还没有上传资料。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === 'user';

  return (
    <article className={isUser ? 'chat-message user' : 'chat-message assistant'}>
      <div className="message-avatar">{isUser ? '你' : '麦'}</div>
      <div className="message-content">
        {!isUser && <span className="source-badge">{message.sourceLabel}</span>}
        <p>{message.answer}</p>
        {!isUser && message.citations?.length > 0 && (
          <>
            <div className="citations">
              {message.citations.map((citation) => (
                <span key={citation.id} title={citation.scoreDescription}>
                  《{citation.title}》 相关度 {citation.relevanceLabel || '中'} · 匹配分{' '}
                  {citation.score}
                </span>
              ))}
            </div>
            <p className="score-note">
              匹配分只表示问题和资料的关键词重合程度，不代表医学可信度或百分制得分。
            </p>
          </>
        )}
      </div>
    </article>
  );
}

function Icon({ name }) {
  const icons = {
    edit: 'M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z M13 6l5 5',
    search: 'M10.5 18a7.5 7.5 0 1 1 5.3-2.2L21 21',
    folder: 'M3 6h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z',
    panel: 'M4 5h16v14H4V5Z M9 5v14',
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d={icons[name]} />
    </svg>
  );
}

function loadConversations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createConversation(firstQuestion = '') {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: firstQuestion ? buildTitle(firstQuestion) : '新对话',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function buildTitle(question) {
  return question.length > 18 ? `${question.slice(0, 18)}...` : question;
}

function formatDate(value) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return '今天';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function providerStatusText(health) {
  if (!health) return '-';
  if (health.providers?.api || health.providers?.deepseek || health.providers?.qwen) return '已配置';
  return '未配置';
}

createRoot(document.getElementById('root')).render(<App />);
