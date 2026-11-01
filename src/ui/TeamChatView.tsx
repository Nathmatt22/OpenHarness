import { useEffect, useRef, useState } from 'react';
import { PapIcon } from './icons';
import { Agent, ChatMessage, Conversation, Team, Vme, api } from './types';
import { parseFolderFlags } from '../../shared/workspace-flags';
import type { Activity } from './hooks';
import type { TFunction } from './i18n';

/** One live activity badge: pulsing dot + localized label. */
export function ActivityBadge({ activity, agent, t } : { activity: Activity; agent?: Agent; t: TFunction }) {
  return (
    <span className={`activity-badge ${activity}`}>
      <span className="pulse" />
      {agent && <PapIcon name={agent.icon || 'sparkles'} size={11} />}
      <span className="label">
        {t(`act.${activity}`, { agent: agent?.name ?? '' })}
      </span>
    </span>
  );
}

/**
 * Live team conversation: one shared thread where every roster agent answers
 * in turn. Persisted messages carry `agent_id`, so each bubble is attributed;
 * in-flight answers stream in like solo chat (the App-level chat:delta
 * subscription feeds the streaming text for the active conversation).
 */
export function TeamChatView({ teams, agents, vmes, teamConversations, activeId, onActive, onStarted, onSend, onStop, streaming, streamingAgent, busy, activity, error, onClearError, t } : {
  teams: Team[]; agents: Agent[]; vmes?: Vme[]; teamConversations: Conversation[];
  activeId: string; onActive: (id: string) => void; onStarted: () => void;
  onSend: (convId: string, content: string, mention: string | null) => Promise<void>;
  onStop: () => void;
  streaming: string; streamingAgent?: string; busy: boolean;
  activity?: { agentId?: string; activity: Activity };
  error: string; onClearError: () => void; t: TFunction;
}) {
  const [teamId, setTeamId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [mention, setMention] = useState('');
  const [localError, setLocalError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedTeam = teams.find((t_) => t_.id === teamId) || teams[0];
  const roster: string[] = selectedTeam ? JSON.parse(selectedTeam.agent_ids) : [];
  const rosterAgents = roster
    .map((id) => agents.find((a: Agent) => a.id === id))
    .filter(Boolean) as Agent[];
  const { folders, writable } = parseFolderFlags(
    selectedTeam?.folders ? (JSON.parse(selectedTeam.folders) as string[]) : []
  );
  const agentBy = (id?: string | null) => agents.find((a: Agent) => a.id === id);
  const speaker = (m: ChatMessage) =>
    m.role === 'user' ? t('chat.you') : agentBy(m.agent_id)?.name || t('team.orchestrator');

  useEffect(() => {
    let cancelled = false;
    if (!activeId) { setMessages([]); return; }
    api()('teamchat:messages', { id: activeId })
      .then((rows: ChatMessage[]) => { if (!cancelled) setMessages(rows); })
      .catch(() => { if (!cancelled) setMessages([]); });
    return () => { cancelled = true; };
  }, [activeId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const send = async () => {
    const content = text.trim();
    if (!content || busy || !selectedTeam) return;
    setLocalError('');
    onClearError();
    let convId = activeId;
    try {
      if (!convId) {
        const created = await api()('teamchat:create', { teamId: selectedTeam.id });
        convId = created.id;
        onActive(convId);
        onStarted();
      }
      setText('');
      setMessages((prev) => [...prev, { id: 'local', role: 'user', content }]);
      await onSend(convId, content, mention || null);
      setMessages(await api()('teamchat:messages', { id: convId }));
    } catch (e) {
      setLocalError(String(e instanceof Error ? e.message : e));
      if (convId) setMessages(await api()('teamchat:messages', { id: convId }).catch(() => []));
    }
  };

  const stop = () => onStop();

  // Internal tool-result rounds are persisted as user messages; they are
  // plumbing for the agents, not user speech, so they stay out of the thread.
  const visible = messages.filter((m) => m.role !== 'user' || !m.content.startsWith('Résultats des actions demandées'));
  const showStream = busy && activeId && streaming;

  return (
    <section className="team-chat-view">
      <div className="team-chat-layout">
        <div className="team-chat-side">
          <div className="eyebrow">{t('tchat.title').toUpperCase()}</div>
          <h1>{t('tchat.title')}</h1>
          <p className="lede">{t('tchat.lede')}</p>
          {teams.length === 0 ? (
            <p className="lede" style={{ color: 'var(--danger)' }}>{t('tchat.noTeams')}</p>
          ) : (
            <>
              <div>
                <span className="field-label">{t('team.label')}</span>
                <select
                  className="field"
                  value={selectedTeam?.id ?? ''}
                  onChange={(e) => { setTeamId(e.target.value); setMention(''); onActive(''); }}
                >
                  {teams.map((t_) => <option key={t_.id} value={t_.id}>{t_.name}</option>)}
                </select>
                <div className="tchat-roster">
                  {rosterAgents.map((a) => (
                    <span className="tchat-agent-chip" key={a.id}>
                      <PapIcon name={a.icon || 'sparkles'} size={12} /> {a.name}
                    </span>
                  ))}
                </div>
              </div>
              {folders.length > 0 && (
                <div className="workspace-box">
                  <div className="workspace-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <PapIcon name="layers" size={12} /> {t('team.foldersTitle')}
                  </div>
                  <div className="workspace-list">
                    {folders.map((f) => (
                      <div key={f}>
                        <span className="f">{writable.has(f) ? `[${t('set.writableOn')}] ` : ''}{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {selectedTeam?.virtual_machine && (
                <div className="workspace-box">
                  <div className="workspace-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <PapIcon name="monitor" size={12} /> {t('team.vmTitle')}
                  </div>
                  <div className="workspace-list">
                    <div>
                      <span className="f">
                        {(vmes || []).find((v) => v.id === selectedTeam.virtual_machine)?.name || '…'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '5px 10px', fontSize: 12 }}
                        onClick={() => { const id = selectedTeam.virtual_machine; if (id) api()('vme:open', { id }).catch((e) => setLocalError(String(e instanceof Error ? e.message : e))); }}
                      >
                        <PapIcon name="monitor" size={13} /> {t('team.vmOpen')}
                      </button>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--text-3)' }}>{t('team.vmHint')}</div>
                  </div>
                </div>
              )}
              <p className="tchat-tool-hint">{t('tchat.toolHint')}</p>
              {teamConversations.length > 0 && (
                <div className="tchat-threads">
                  <div className="field-label">{t('side.history')}</div>
                  {teamConversations.slice(0, 12).map((c) => (
                    <button
                      key={c.id}
                      className={`tchat-thread ${activeId === c.id ? 'active' : ''}`}
                      onClick={() => onActive(c.id)}
                    >
                      <PapIcon name="users" size={12} />
                      <span className="label">{c.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="team-chat-main">
          <div className="messages" ref={scrollRef}>
            {visible.length === 0 && !showStream ? (
              <div className="welcome">
                <h1>{t('tchat.title')}</h1>
                <p>{t('tchat.lede')}</p>
              </div>
            ) : (
              <>
                {visible.map((m, i) => (
                  <article key={m.id || `tm-${i}`} className={`message ${m.role === 'user' ? 'user' : 'assistant'}`}>
                    <div className="avatar">
                      {m.role === 'user'
                        ? <PapIcon name="users" size={14} />
                        : <PapIcon name={agentBy(m.agent_id)?.icon || 'sparkles'} size={14} />}
                    </div>
                    <div className="message-body">
                      <div className="message-author">{speaker(m)}</div>
                      <p className="message-text">{m.content}</p>
                    </div>
                  </article>
                ))}
                {showStream && (
                  <article className="message assistant">
                    <div className="avatar"><PapIcon name={agentBy(streamingAgent)?.icon || 'sparkles'} size={14} /></div>
                    <div className="message-body">
                      <div className="message-author">
                        {agentBy(streamingAgent)?.name || t('team.orchestrator')}
                        {activity && <ActivityBadge activity={activity.activity} agent={agentBy(activity.agentId)} t={t} />}
                      </div>
                      <p className="message-text">{streaming}</p>
                    </div>
                  </article>
                )}
                {busy && !showStream && activity && (
                  <div className="activity-strip">
                    <ActivityBadge activity={activity.activity} agent={agentBy(activity.agentId)} t={t} />
                  </div>
                )}
                {busy && !showStream && !activity && (
                  <div className="activity-strip"><span className="activity-badge queued"><span className="pulse" /><span className="label">{t('act.waiting')}</span></span></div>
                )}
              </>
            )}
          </div>

          {(localError || error) && (
            <div className="composer-wrap" style={{ paddingTop: 0 }}>
              <div className="banner"><PapIcon name="shield" size={13} /> {localError || error}</div>
            </div>
          )}

          <div className="composer-wrap">
            {teams.length > 0 && (
              <>
                <div className="composer">
                  <textarea
                    value={text}
                    rows={1}
                    placeholder={t('tchat.placeholder')}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  />
                  {busy
                    ? <button className="composer-send" title={t('chat.stop')} onClick={stop}><PapIcon name="stop" size={15} /></button>
                    : <button className="composer-send" disabled={!text.trim()} title={t('chat.send')} onClick={() => void send()}><PapIcon name="send" size={15} /></button>}
                </div>
                <div className="composer-hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{t('tchat.mention')} :</span>
                  <select className="select mini" value={mention} onChange={(e) => setMention(e.target.value)}>
                    <option value="">{t('tchat.everyone')}</option>
                    {rosterAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <span style={{ marginLeft: 'auto' }}>{t('chat.enterHint')}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
