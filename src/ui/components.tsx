import { PapIcon } from './icons';
import { Agent, ChatMessage, Connection, Conversation } from './types';
import type { TFunction } from './i18n';

export function Sidebar({ data, agentId, conversationId, mode, onAgent, onNewChat, onOpenConversation, onDeleteConversation, onMode, onPage, onThemeToggle, light, connectionLabel, t } : {
  data: any; agentId: string; conversationId: string; mode: string;
  onAgent: (id: string) => void; onNewChat: () => void; onOpenConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void; onMode: (m: 'solo' | 'team' | 'teamchat') => void; onPage: (p: 'chat' | 'settings') => void;
  onThemeToggle: () => void; light: boolean; connectionLabel: string; t: TFunction;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><Logo /></div>
        <div>
          <div className="brand-name">OpenHarness</div>
          <div className="brand-tagline">One Platform. Multiple AI Agents.</div>
        </div>
      </div>

      <div className="side-actions">
        <button className="btn btn-primary btn-block" onClick={onNewChat}>
          <PapIcon name="plus" size={15} /> {t('side.newChat')}
        </button>
      </div>

      <div className="mode-switch">
        <button className={mode === 'solo' ? 'active' : ''} onClick={() => onMode('solo')}>
          <PapIcon name="chat" size={14} /> {t('side.solo')}
        </button>
        <button className={mode === 'teamchat' ? 'active' : ''} onClick={() => onMode('teamchat')}>
          <PapIcon name="chat" size={14} /> {t('side.teamChat')}
        </button>
        <button className={mode === 'team' ? 'active' : ''} onClick={() => onMode('team')}>
          <PapIcon name="users" size={14} /> {t('side.team')}
        </button>
      </div>

      <div className="side-section">{t('side.agents')}</div>
      <div className="agent-list">
        {data.agents.map((a: Agent) => (
          <button
            key={a.id}
            className={`agent-row ${agentId === a.id && mode === 'solo' ? 'active' : ''}`}
            onClick={() => onAgent(a.id)}
          >
            <PapIcon name={a.icon} size={15} />
            <span className="name">{a.name}</span>
            {a.custom === 1 && <span className="badge-custom">{t('common.bespoke')}</span>}
          </button>
        ))}
      </div>

      <div className="side-section">{t('side.history')}</div>
      <div className="history">
        {data.conversations.length === 0 && <div className="history-empty">{t('side.noConversations')}</div>}
        {data.conversations.slice(0, 30).map((c: Conversation) => (
          <button
            key={c.id}
            className={`history-item ${conversationId === c.id && mode !== 'teamchat' ? 'active' : ''}`}
            onClick={() => onOpenConversation(c.id)}
            title={c.team_id ? t('side.teamChat') : t('side.historyTitle')}
            onContextMenu={(e) => { e.preventDefault(); onDeleteConversation(c.id); }}
          >
            <PapIcon name={c.team_id ? 'users' : 'chat'} size={12} />
            <span className="label">{c.title || t('side.newChat')}</span>
          </button>
        ))}
        {data.conversations.length > 30 && <div className="history-empty">+ {data.conversations.length - 30} {t('side.olderConversations')}</div>}
      </div>

      <div className="side-footer">
        <button className="agent-row" onClick={() => onPage('settings')}>
          <PapIcon name="settings" size={15} />
          <span className="name">{t('side.settings')}</span>
          <span className="topbar-pill" style={{ padding: '2px 8px', fontSize: 10 }}>
            <span className={`dot ${connectionLabel === t('side.noConnection') ? 'err' : 'ok'}`} />
            {connectionLabel}
          </span>
        </button>
        <button className="agent-row" onClick={onThemeToggle}>
          <PapIcon name="sparkles" size={15} />
          <span className="name">{light ? t('side.darkTheme') : t('side.lightTheme')}</span>
        </button>
      </div>
    </aside>
  );
}

export function Topbar({ agent, connection, page, mode, t }: { agent?: Agent; connection?: Connection; page: string; mode?: string; t: TFunction }) {
  const title = page === 'settings'
    ? t('top.settings')
    : page === 'team'
      ? t('top.team')
      : mode === 'teamchat'
        ? t('tchat.title')
        : agent?.name || 'OpenHarness';
  return (
    <header className="topbar">
      <div className="topbar-title">
        <span className="title">{title}</span>
      </div>
      <div className="topbar-meta">
        {page !== 'settings' && (
          <>
            <span className="topbar-pill">
              <PapIcon name={agent?.icon || 'sparkles'} size={12} />
              {agent?.name || '—'}
            </span>
            <span className="topbar-divider" />
            <span className="topbar-pill">
              <span className={`dot ${connection ? 'ok' : 'warn'}`} />
              {connection ? `${connection.name} · ${connection.model}` : t('top.noConnectionApi')}
            </span>
          </>
        )}
      </div>
    </header>
  );
}

export function ChatView({ agent, messages, streaming, busy, error, text, setText, onSend, onStop, connections, connectionId, onConnectionChange, hasConnections, scrollRef, t } : {
  agent?: Agent; messages: ChatMessage[]; streaming: string; busy: boolean; error: string;
  text: string; setText: (t: string) => void; onSend: () => void; onStop: () => void;
  connections: Connection[]; connectionId: string; onConnectionChange: (id: string) => void; hasConnections: boolean;
  scrollRef?: React.RefObject<HTMLElement>;
  t: TFunction;
}) {
  // The in-flight assistant answer is the streaming text itself, rendered as the
  // last bubble. No separate placeholder bubble and no extra streaming bubble:
  // a response can physically appear only once.
  const visible: ChatMessage[] = streaming
    ? [...messages.filter((m, i) => !(m.role === 'assistant' && m.content === '' && i === messages.length - 1)),
       { id: 'streaming', role: 'assistant', content: streaming }]
    : messages.filter((m) => !(m.role === 'assistant' && m.content === ''));
  const empty = !visible.length;
  return (
    <section className="chat-view" ref={scrollRef}>
      <div className="messages">
        {empty ? (
          <Welcome t={t} />
        ) : (
          <div className="message-row">
            {visible.map((m, i) => (
              <article key={m.id || `msg-${i}`} className={`message ${m.role === 'user' ? 'user' : 'assistant'}`}>
                <div className="avatar">{m.role === 'user' ? <PapIcon name="users" size={14} /> : <PapIcon name={agent?.icon || 'sparkles'} size={14} />}</div>
                <div className="message-body">
                  <div className="message-author">{m.role === 'user' ? t('chat.you') : agent?.name}</div>
                  {m.content ? (
                    <p className="message-text">{m.content}</p>
                  ) : busy && i === visible.length - 1 ? (
                    <div className="typing"><span /><span /><span /></div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="composer-wrap" style={{ paddingTop: 0 }}>
          <div className="banner"><PapIcon name="shield" size={13} /> {error}</div>
        </div>
      )}

      <div className="composer-wrap">
        {!hasConnections && (
          <div className="banner" style={{ marginBottom: 8 }}>
            <PapIcon name="settings" size={13} /> {t('chat.noConnectionBanner')}
          </div>
        )}
        <div className="composer">
          <textarea
            value={text}
            rows={1}
            placeholder={agent ? t('chat.placeholderAgent', { agent: agent.name }) : t('chat.placeholder')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          />
          {busy
            ? <button className="composer-send" title={t('chat.stop')} onClick={onStop}><PapIcon name="stop" size={15} /></button>
            : <button className="composer-send" disabled={!text.trim()} title={t('chat.send')} onClick={onSend}><PapIcon name="send" size={15} /></button>}
        </div>
        <div className="composer-hint">{t('chat.enterHint')}</div>
        {connections.length > 0 && (
          <div className="composer-hint" style={{ marginTop: 4 }}>
            {t('chat.connection')}{' '}
            <select className="select mini" value={connectionId} onChange={(e) => onConnectionChange(e.target.value)}>
              {connections.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.model}</option>)}
            </select>
          </div>
        )}
      </div>
    </section>
  );
}

function Welcome({ t }: { t: TFunction }) {
  return (
    <div className="welcome">
      <div className="welcome-mark"><Logo /></div>
      <h1>{t('chat.welcomeTitle')}</h1>
      <p>{t('chat.welcomeSub')}</p>
    </div>
  );
}

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5 4h6a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H9v6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

