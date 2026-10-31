import { useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar, Topbar, ChatView } from './components';
import { SettingsPage } from './Settings';
import { TeamView } from './TeamView';
import { useAppData, useLang, useRealtime, useTheme, type Page } from './hooks';
import { api, type Agent, type ChatMessage, type Connection } from './types';

export default function App() {
  const { data, loadError, refresh } = useAppData();
  const { light, toggle } = useTheme();
  const { lang, setLang, t } = useLang(data);
  const [page, setPage] = useState<Page>('chat');
  const [mode, setMode] = useState<'solo' | 'team'>('solo');
  const [agentId, setAgentId] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  // Latest active ids in refs so event handlers never read stale closures.
  const activeConversation = useRef('');
  const streamingRef = useRef('');
  activeConversation.current = conversationId;
  const appendStream = (delta: string) => {
    streamingRef.current += delta;
    setStreaming(streamingRef.current);
  };
  const resetStream = () => { streamingRef.current = ''; setStreaming(''); };

  const currentAgent: Agent | undefined = useMemo(
    () => data.agents.find((a: Agent) => a.id === agentId) ?? data.agents[0],
    [data.agents, agentId]
  );
  const currentConnection: Connection | undefined = useMemo(
    () => data.connections.find((c: Connection) => c.id === connectionId) ?? data.connections[0],
    [data.connections, connectionId]
  );

  const realtime = useRealtime(
    (d) => { if (d.streamId === activeConversation.current) appendStream(d.delta); },
    (e) => { if (e.id === activeConversation.current) { setBusy(false); setError(e.error); resetStream(); } }
  );

  useEffect(() => {
    if (!agentId && data.agents.length) setAgentId(data.agents[0].id);
  }, [data.agents, agentId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  useEffect(() => {
    if (page !== 'chat') return;
    if (mode === 'team') { setError(''); return; }
    if (!conversationId && messages.length) { setMessages([]); setStreaming(''); }
  }, [page, mode, conversationId, messages.length]);

  const openConversation = async (id: string) => {
    setPage('chat'); setMode('solo');
    setConversationId(id); resetStream(); setError('');
    const conv = data.conversations.find((c: any) => c.id === id);
    if (conv) setAgentId(conv.agent_id);
    setMessages(await api()('conversation:messages', { id }));
  };

  const newChat = async () => {
    if (!currentAgent) return;
    setMode('solo'); setPage('chat');
    setConversationId(''); setMessages([]); resetStream(); setError('');
    setAgentId(currentAgent.id);
  };

  const send = async () => {
    const content = text.trim();
    if (!content || busy || !currentAgent) return;
    setError('');
    let convId = conversationId;
    if (!convId) {
      try {
        const r = await api()('conversation:create', { agentId: currentAgent.id, connectionId: currentConnection?.id ?? null });
        convId = r.id;
        setConversationId(convId);
        activeConversation.current = convId;
      } catch (e) { setError(String(e instanceof Error ? e.message : e)); return; }
    }
    setText('');
    setMessages(m => [...m, { id: 'local', role: 'user', content }, { id: 'local', role: 'assistant', content: '' }]);
    resetStream(); setBusy(true);
    try {
      await api()('chat:send', { conversationId: convId, agentId: currentAgent.id, content });
      setMessages(await api()('conversation:messages', { id: convId }));
      resetStream();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      resetStream();
    } finally { setBusy(false); }
  };

  const stop = async () => {
    const id = conversationId;
    if (!id) return;
    try { await api()('chat:stop', { id }); } catch { /* aborted */ }
  };

  const deleteConversation = async (id: string) => {
    await api()('conversation:delete', { id });
    if (conversationId === id) { setConversationId(''); setMessages([]); }
    await refresh();
  };

  const connectionLabel = data.connections.length
    ? `${data.connections.length} ${data.connections.length > 1 ? t('side.connections') : t('side.connection')}`
    : t('side.noConnection');

  return (
    <div className={`app ${light ? 'light' : ''}`}>
      <Sidebar
        data={data}
        agentId={agentId}
        conversationId={conversationId}
        mode={mode}
        connectionLabel={connectionLabel}
        light={light}
        t={t}
        onAgent={(id) => { setAgentId(id); setMode('solo'); setPage('chat'); setConversationId(''); setMessages([]); resetStream(); setError(''); }}
        onNewChat={newChat}
        onOpenConversation={openConversation}
        onDeleteConversation={deleteConversation}
        onMode={(m) => { setMode(m); setPage(m === 'team' ? 'team' : 'chat'); }}
        onPage={(p) => setPage(p)}
        onThemeToggle={toggle}
      />

      <main className="main">
        <Topbar agent={currentAgent} connection={currentConnection} page={page} t={t} />

        {loadError && (
          <div style={{ padding: 20 }}>
            <div className="notice error">{t('chat.loadError', { error: loadError })}</div>
          </div>
        )}

        {page === 'settings' && (
          <SettingsPage data={data} refresh={refresh} notice={notice} setNotice={setNotice} lang={lang} onLangChange={setLang} t={t} />
        )}

        {page === 'team' && (
          <TeamView
            teams={data.teams}
            agents={data.agents}
            missionRunning={realtime.missionRunning}
            events={realtime.events}
            setEvents={realtime.setEvents}
            missionDone={realtime.missionDone}
            missionId={realtime.missionId}
            t={t}
          />
        )}

        {page === 'chat' && mode === 'solo' && (
          <div className="chat-outer" ref={scrollRef} style={{ display: 'contents' }}>
            <ChatView
              agent={currentAgent}
              messages={messages}
              streaming={streaming}
              busy={busy}
              error={error}
              text={text}
              setText={setText}
              onSend={send}
              onStop={stop}
              connections={data.connections}
              connectionId={currentConnection?.id ?? ''}
              onConnectionChange={setConnectionId}
              hasConnections={data.connections.length > 0}
              t={t}
            />
          </div>
        )}
      </main>
    </div>
  );
}
