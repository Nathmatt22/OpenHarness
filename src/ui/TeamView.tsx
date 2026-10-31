import { useEffect, useState } from 'react';
import { PapIcon } from './icons';
import { Team, WorkspaceListing, api } from './types';
import { parseFolderFlags } from '../../shared/workspace-flags';
import type { TFunction } from './i18n';

export function TeamView({ teams, agents, missionRunning, events, setEvents, missionDone, missionId, t } : {
  teams: Team[]; agents: any[]; missionRunning: boolean; events: any[]; setEvents: (fn: (prev: any[]) => any[]) => void; missionDone: string; missionId: string; t: TFunction;
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
