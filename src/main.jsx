import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const STORAGE_KEY = 'maiya-medical-ai-conversations';
const TOKEN_KEY = 'maiya-medical-ai-token';

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
  const [activeId, setActiveId] = useState(() => loadConversations()[0]?.id || null);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');
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

  useEffect(() => {
    if (!token) return;
    loadCurrentUser(token);
  }, [token]);

  async function loadCurrentUser(currentToken) {
    try {
      const me = await apiFetch('/api/me', { token: currentToken });
      setUser(me.user);
      const history = await apiFetch('/api/conversations', { token: currentToken });
      const remoteConversations = history.conversations || [];
      if (remoteConversations.length > 0) {
        setConversations(remoteConversations);
        setActiveId(remoteConversations[0]?.id || null);
      } else if (conversations.length > 0) {
        await saveCloudConversations(conversations, currentToken);
      }
      setSyncNotice('历史已同步');
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setToken('');
      setUser(null);
      setSyncNotice('登录已过期');
    }
  }

  function persistConversations(nextConversations) {
    setConversations(nextConversations);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextConversations));
    if (token) {
      saveCloudConversations(nextConversations, token).catch(() => setSyncNotice('历史同步失败'));
    }
  }

  function createNewChat() {
    const conversation = createConversation();
    const next = [conversation, ...conversations];
    persistConversations(next);
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

    const withUserMessage = upsertConversation(conversations, {
      ...currentConversation,
      title:
        currentConversation.title === '新对话'
          ? buildTitle(trimmed)
          : currentConversation.title,
      updatedAt: new Date().toISOString(),
      messages: [...currentConversation.messages, userMessage],
    });

    setQuestion('');
    setLoading(true);
    setActiveId(currentConversation.id);
    persistConversations(withUserMessage);

    try {
      const data = await apiFetch('/api/chat', {
        method: 'POST',
        body: {
          question: trimmed,
          provider,
          messages: buildRecentMessages(withUserMessage, currentConversation.id),
        },
      });
      const assistantMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        answer: data.answer,
        sourceLabel: data.sourceLabel,
        citations: data.citations || [],
        createdAt: new Date().toISOString(),
      };
      const next = appendMessage(withUserMessage, currentConversation.id, assistantMessage);
      persistConversations(next);
    } catch (error) {
      const next = appendMessage(withUserMessage, currentConversation.id, {
        id: crypto.randomUUID(),
        role: 'assistant',
        sourceLabel: '系统错误',
        answer: error.message,
        citations: [],
        createdAt: new Date().toISOString(),
      });
      persistConversations(next);
    } finally {
      setLoading(false);
    }
  }

  function deleteConversation(conversationId) {
    const next = conversations.filter((conversation) => conversation.id !== conversationId);
    if (activeId === conversationId) setActiveId(next[0]?.id || null);
    persistConversations(next);
  }

  function handleLoggedIn(nextToken, nextUser, remoteConversations) {
    localStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
    setUser(nextUser);
    setAuthOpen(false);

    if (remoteConversations?.length) {
      setConversations(remoteConversations);
      setActiveId(remoteConversations[0]?.id || null);
    } else if (conversations.length > 0) {
      saveCloudConversations(conversations, nextToken).catch(() => setSyncNotice('历史同步失败'));
    }
    setSyncNotice('已登录并同步');
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setUser(null);
    setSyncNotice('已退出登录，本设备仍保留本地历史');
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
            {syncNotice && <span>{syncNotice}</span>}
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
          <Avatar user={user} />
          <div className="account-copy">
            <strong>{user?.username || '未登录用户'}</strong>
            <span>{user?.email || '登录后可跨设备同步'}</span>
          </div>
          <div className="account-actions">
            {user ? (
              <>
                <button type="button" onClick={() => setSettingsOpen(true)}>
                  设置
                </button>
                <button type="button" onClick={logout}>
                  退出
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setAuthOpen(true)}>
                邮箱登录
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className="chat-surface">
        <header className="chat-topbar">
          <span>{activeConversation?.title || '麦芽医疗 AI'}</span>
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
              <p>先查麦芽知识库；如果没有足够相关资料，再调用已配置的 AI API。</p>
            </div>
          )}

          {activeConversation?.messages.map((message) => (
            <MessageBubble key={message.id} message={message} user={user} />
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

      {authOpen && (
        <AuthDialog
          onClose={() => setAuthOpen(false)}
          onLoggedIn={handleLoggedIn}
        />
      )}
      {settingsOpen && user && (
        <SettingsDialog
          token={token}
          user={user}
          onClose={() => setSettingsOpen(false)}
          onUserChange={setUser}
        />
      )}
    </div>
  );
}

function AuthDialog({ onClose, onLoggedIn }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('email');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function requestCode(event) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      await apiFetch('/api/auth/request-code', {
        method: 'POST',
        body: { email },
      });
      setStep('code');
      setNotice('验证码已发送，请查看邮箱。');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const login = await apiFetch('/api/auth/verify', {
        method: 'POST',
        body: { email, code },
      });
      const history = await apiFetch('/api/conversations', { token: login.token });
      onLoggedIn(login.token, login.user, history.conversations || []);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="邮箱验证码登录" onClose={onClose}>
      <form className="modal-form" onSubmit={step === 'email' ? requestCode : verifyCode}>
        <label>
          邮箱
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            type="email"
            required
            disabled={step === 'code'}
          />
        </label>
        {step === 'code' && (
          <label>
            验证码
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="6 位数字"
              inputMode="numeric"
              required
            />
          </label>
        )}
        {notice && <p className="notice">{notice}</p>}
        <button type="submit" disabled={busy}>
          {busy ? '处理中...' : step === 'email' ? '发送验证码' : '登录'}
        </button>
      </form>
    </Modal>
  );
}

function SettingsDialog({ token, user, onClose, onUserChange }) {
  const [username, setUsername] = useState(user.username || '');
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || '');
  const [newEmail, setNewEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveProfile(event) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const data = await apiFetch('/api/me', {
        method: 'PATCH',
        token,
        body: { username, avatarUrl },
      });
      onUserChange(data.user);
      setNotice('用户资料已保存。');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function requestEmailChange() {
    setBusy(true);
    setNotice('');
    try {
      await apiFetch('/api/auth/request-email-change', {
        method: 'POST',
        token,
        body: { email: newEmail },
      });
      setNotice('新邮箱验证码已发送。');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmEmailChange() {
    setBusy(true);
    setNotice('');
    try {
      const data = await apiFetch('/api/auth/confirm-email-change', {
        method: 'POST',
        token,
        body: { email: newEmail, code: emailCode },
      });
      onUserChange(data.user);
      setNewEmail('');
      setEmailCode('');
      setNotice('邮箱已更换。');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="用户设置" onClose={onClose}>
      <form className="modal-form" onSubmit={saveProfile}>
        <label>
          用户名
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          头像图片链接
          <input
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
            placeholder="https://..."
          />
        </label>
        <button type="submit" disabled={busy}>
          保存资料
        </button>
      </form>

      <div className="settings-divider" />

      <div className="modal-form">
        <label>
          更换邮箱
          <input
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            placeholder="new@example.com"
            type="email"
          />
        </label>
        <div className="inline-actions">
          <button type="button" onClick={requestEmailChange} disabled={busy || !newEmail.trim()}>
            发送验证码
          </button>
        </div>
        <label>
          新邮箱验证码
          <input
            value={emailCode}
            onChange={(event) => setEmailCode(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <button type="button" onClick={confirmEmailChange} disabled={busy || !emailCode.trim()}>
          确认更换邮箱
        </button>
      </div>

      {notice && <p className="notice">{notice}</p>}
    </Modal>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop">
      <section className="modal-card">
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        {children}
      </section>
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
  const [analyzingMedia, setAnalyzingMedia] = useState(false);
  const [mediaAnalysis, setMediaAnalysis] = useState('');
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
      let nextMediaAnalysis = mediaAnalysis;
      if (file && isVisualMedia(file) && !nextMediaAnalysis) {
        setAnalyzingMedia(true);
        setNotice('正在用千问读取图片/视频帧...');
        nextMediaAnalysis = await analyzeMediaFile(file);
        setMediaAnalysis(nextMediaAnalysis);
      }

      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.append(key, value));
      if (nextMediaAnalysis) body.append('mediaAnalysis', nextMediaAnalysis);
      if (file) {
        body.append('fileName', file.name);
        body.append('fileType', file.type);
        body.append('fileSize', String(file.size));
      }

      if (file && !isVisualMedia(file)) {
        body.append('file', file);
      }

      const response = await fetch(`${API_BASE}/api/knowledge`, {
        method: 'POST',
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '上传失败');

      setForm({ title: '', tags: '', sourceName: '麦芽知识库', content: '' });
      setFile(null);
      setMediaAnalysis('');
      setNotice('上传并索引完成');
      await loadKnowledge();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAnalyzingMedia(false);
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
                placeholder="例如：中国 2 型糖尿病防治指南"
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
              <input
                type="file"
                onChange={(event) => {
                  setFile(event.target.files?.[0] || null);
                  setMediaAnalysis('');
                }}
              />
              <strong>{file ? file.name : '选择文件或拖拽上传'}</strong>
              <span>
                图片会调用千问读取画面文字；视频会抽取关键帧分析，不再整段上传，适合 20MB 以上视频。
              </span>
            </label>

            {mediaAnalysis && (
              <div className="analysis-preview">
                <strong>图片/视频 AI 解析</strong>
                <p>{mediaAnalysis}</p>
              </div>
            )}

            <button type="submit" disabled={saving}>
              {analyzingMedia ? '正在解析媒体...' : saving ? '上传中...' : '上传并解析'}
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

function MessageBubble({ message, user }) {
  const isUser = message.role === 'user';

  return (
    <article className={isUser ? 'chat-message user' : 'chat-message assistant'}>
      {!isUser && <div className="message-avatar">麦</div>}
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
      {isUser && <Avatar user={user} />}
    </article>
  );
}

function Avatar({ user }) {
  if (user?.avatarUrl) {
    return <img className="avatar image-avatar" src={user.avatarUrl} alt={user.username || '头像'} />;
  }
  return <div className="avatar">{(user?.username || '你').slice(0, 1)}</div>;
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

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body:
      options.body && !(options.body instanceof FormData)
        ? JSON.stringify(options.body)
        : options.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

function buildRecentMessages(conversations, conversationId) {
  const conversation = conversations.find((item) => item.id === conversationId);
  return (conversation?.messages || []).slice(-8).map((message) => ({
    role: message.role,
    content: message.answer,
  }));
}

function isVisualMedia(file) {
  return file?.type?.startsWith('image/') || file?.type?.startsWith('video/');
}

async function analyzeMediaFile(file) {
  const frames = file.type.startsWith('video/')
    ? await captureVideoFrames(file)
    : [await captureImageFrame(file)];

  const data = await apiFetch('/api/media/analyze', {
    method: 'POST',
    body: {
      mediaType: file.type.startsWith('video/') ? 'video' : 'image',
      frames,
    },
  });

  return data.analysis;
}

function captureImageFrame(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(drawToDataUrl(image));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('图片读取失败'));
    };
    image.src = objectUrl;
  });
}

function captureVideoFrames(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    const frames = [];
    let targets = [];
    let index = 0;

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
      const count = Math.min(6, Math.max(3, Math.floor(duration / 20) + 1));
      targets = Array.from({ length: count }, (_, targetIndex) => {
        return Math.min(duration - 0.2, Math.max(0.2, (duration * (targetIndex + 1)) / (count + 1)));
      });
      video.currentTime = targets[index];
    };

    video.onseeked = () => {
      frames.push(drawToDataUrl(video));
      index += 1;
      if (index >= targets.length) {
        URL.revokeObjectURL(objectUrl);
        resolve(frames);
      } else {
        video.currentTime = targets[index];
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('视频帧读取失败'));
    };

    video.src = objectUrl;
  });
}

function drawToDataUrl(source) {
  const maxWidth = 960;
  const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
  const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.min(1, maxWidth / sourceWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  const context = canvas.getContext('2d');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

async function saveCloudConversations(conversations, token) {
  await apiFetch('/api/conversations', {
    method: 'PUT',
    token,
    body: { conversations },
  });
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

function upsertConversation(conversations, nextConversation) {
  const exists = conversations.some((conversation) => conversation.id === nextConversation.id);
  const next = exists
    ? conversations.map((conversation) =>
        conversation.id === nextConversation.id ? nextConversation : conversation,
      )
    : [nextConversation, ...conversations];
  return next.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function appendMessage(conversations, conversationId, message) {
  return conversations.map((conversation) =>
    conversation.id === conversationId
      ? {
          ...conversation,
          updatedAt: new Date().toISOString(),
          messages: [...conversation.messages, message],
        }
      : conversation,
  );
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
