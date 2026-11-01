import { useEffect, useState } from 'react';
import { PapIcon } from './icons';
import { Team, Vme, WorkspaceListing, api } from './types';
import { parseFolderFlags } from '../../shared/workspace-flags';
import { ActivityBadge } from './TeamChatView';
import type { Activity } from './hooks';
import type { TFunction } from './i18n';

export function TeamView({ teams, agents, vmes, missionRunning, events, setEvents, missionDone, missionId, activities, t } : {
  teams: Team[]; agents: any[]; vmes?: Vme[]; missionRunning: boolean; events: any[]; setEvents: (fn: (prev: any[]) => any[]) => void; missionDone: string; missionId: string;
  activities?: Record<string, { agentId?: string; activity: Activity }>; t: TFunction;
}) {
  const [teamId, setTeamId] = useState('');
  const [task, setTask] = useState('');
  const [error, setError] = useState('');
  const [workspace, setWorkspace] = useState<WorkspaceListing[] | null>(null);
  const selectedTeam = teams.find(t => t.id === teamId) || teams[0];
  const roster: string[] = selectedTeam ? JSON.parse(selectedTeam.agent_ids) : [];
  const { folders, writable } = parseFolderFlags(
    selectedTeam?.folders ? (JSON.parse(selectedTeam.folders) as string[]) : []
  );
  // The machine assigned to the selected team (undefined when the team has none).
  const teamVme = (vmes || []).find((v) => v.id === selectedTeam?.virtual_machine);

  useEffect(() => {
    let cancelled = false;
    if (!selectedTeam) { setWorkspace(null); return; }
    api()('workspace:list', { teamId: selectedTeam.id })
      .then((list) => { if (!cancelled) setWorkspace(list); })
      .catch(() => { if (!cancelled) setWorkspace(null); });
    return () => { cancelled = true; };
  }, [selectedTeam?.id]);

  const start = async () => {
    if (!selectedTeam || !task.trim()) return;
    setError('');
    setEvents(() => []);
    try {
      await api()('mission:start', { teamId: selectedTeam.id, task: task.trim() });
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
  };

  const stop = async () => {
    if (!missionId) return;
    try { await api()('mission:stop', { id: missionId }); } catch (e) { setError(String(e)); }
  };

  const agentName = (id: string) => agents.find((a: any) => a.id === id)?.name ?? t('team.orchestrator');

  return (
    <section className="team-view">
      <div className="team-layout">
        <div className="team-panel">
          <div className="eyebrow">{t('team.eyebrow')}</div>
          <h1>{t('team.title')}</h1>
          <p className="lede">{t('team.lede')}</p>
          {teams.length === 0 ? (
            <p className="lede" style={{ color: 'var(--danger)' }}>{t('team.createFirst')}</p>
          ) : (
            <div className="team-form">
              <div>
                <span className="field-label">{t('team.label')}</span>
                <select className="field" value={selectedTeam?.id ?? ''} onChange={(e) => setTeamId(e.target.value)}>
                  {teams.map(t_ => <option key={t_.id} value={t_.id}>{t_.name}</option>)}
                </select>
                <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--text-3)' }}>
                  {t('team.order')} {roster.map(id => agentName(id)).join(' → ') || '—'}
                </div>
              </div>
              <div className="workspace-box">
                <div className="workspace-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <PapIcon name="layers" size={12} /> {t('team.foldersTitle')}
                </div>
                {folders.length === 0 ? (
                  <div className="workspace-list">{t('team.noFolders')}</div>
                ) : (
                  <div className="workspace-list">
                    {(workspace ?? []).map((l) => (
                      <div key={l.folder}>
                        <span className="f">
                          {writable.has(l.folder) ? `[${t('set.writableOn')}] ` : ''}{l.folder}
                        </span>
                        {l.entries.map((e) => e.name).join(' · ') || t('team.emptyFolder')}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="workspace-box">
                <div className="workspace-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <PapIcon name="monitor" size={12} /> {t('team.vmTitle')}
                </div>
                {!teamVme ? (
                  <div className="workspace-list">{t('team.noVme')}</div>
                ) : (
                  <div className="workspace-list">
                    <div>
                      <span className="f">{teamVme.name} · {t('team.vmReady')}</span>
                      <span title={teamVme.path}>{teamVme.path.length > 42 ? `…${teamVme.path.slice(-40)}` : teamVme.path}</span>
                    </div>
                    {teamVme.pages.length > 0 && (
                      <div>{t('set.vmePages').split(' (')[0]} : {teamVme.pages.map((p) => p.label).join(' · ')}</div>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => void api()('vme:open', { id: teamVme.id })}>
                        <PapIcon name="monitor" size={13} /> {t('team.vmOpen')}
                      </button>
                      {teamVme.pages.length > 0 && (
                        <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => void api()('vme:open', { id: teamVme.id, page: 0 })}>
                          <PapIcon name="globe" size={13} /> {t('team.vmWeb')}
                        </button>
                      )}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--text-3)' }}>{t('team.vmHint')}</div>
                  </div>
                )}
              </div>
              <div>
                <span className="field-label">{t('team.mission')}</span>
                <textarea
                  className="field"
                  rows={5}
                  value={task}
                  placeholder={t('team.missionPlaceholder')}
                  onChange={(e) => setTask(e.target.value)}
                />
              </div>
              <div className="team-actions">
                {missionRunning ? (
                  <>
                    <span className="team-status"><span className="dot" /> {t('team.running')}</span>
                    {activities && missionId && activities[missionId] && (
                      <ActivityBadge
                        activity={activities[missionId].activity}
                        agent={agents.find((a: any) => a.id === activities[missionId].agentId)}
                        t={t}
                      />
                    )}
                    <button className="btn btn-ghost" onClick={stop}>{t('team.stop')}</button>
                  </>
                ) : (
                  <button className="btn btn-primary" disabled={!task.trim()} onClick={start}>{t('team.start')}</button>
                )}
              </div>
              {error && <div className="notice error">{error}</div>}
              {missionDone && !missionRunning && <div className="notice">{t('team.done', { status: missionDone })}</div>}
            </div>
          )}
        </div>

        <div className="timeline">
          <h2>{t('team.activity')}</h2>
          {events.length === 0 ? (
            <div className="timeline-empty">{t('team.timelineEmpty')}</div>
          ) : (
            events.map((ev, i) => (
              <article className="timeline-item" key={i}>
                <div className="who">
                  <span>{agentName(ev.agentId)}</span>
                  <span className="at">{ev.created_at ? new Date(ev.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                </div>
                <p className="text">{ev.content}</p>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
