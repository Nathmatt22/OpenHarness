import { useRef, useState } from 'react';
import { PapIcon } from './icons';
import { Agent, Connection, Endpoints, Vme, api } from './types';
import { parseFolderFlags, encodeFolderFlags } from '../../shared/workspace-flags';
import type { Lang, TFunction } from './i18n';

export function SettingsPage({ data, refresh, notice, setNotice, lang, onLangChange, t }: {
  data: any; refresh: () => Promise<void>; notice: string; setNotice: (n: string) => void;
  lang: Lang; onLangChange: (l: Lang) => void; t: TFunction;
}) {
  const [testing, setTesting] = useState('');
  const [testResult, setTestResult] = useState<Record<string, 'ok' | 'err'>>({});
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [teamFolders, setTeamFolders] = useState<string[]>([]);
  const [teamAllowRun, setTeamAllowRun] = useState(false);
  const [teamVme, setTeamVme] = useState('');
  const [teamVmRun, setTeamVmRun] = useState(false);
  const endpoints: Endpoints | undefined = data.endpoints;
  const connectionFormRef = useRef<HTMLFormElement>(null);
  const teamFormRef = useRef<HTMLFormElement>(null);
  const agentFormRef = useRef<HTMLFormElement>(null);
  const vmeFormRef = useRef<HTMLFormElement>(null);
  const noticeType = notice.startsWith('✓') ? '' : 'error';

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const payload = {
      name: String(f.get('name') || ''), type: String(f.get('type') || ''),
      baseUrl: String(f.get('baseUrl') || ''), apiKey: String(f.get('apiKey') || ''),
      model: String(f.get('model') || '')
    };
    try {
      await api()('connection:save', payload);
      connectionFormRef.current?.reset();
      await refresh();
      setNotice(t('set.savedConnection'));
    } catch (err) { setNotice(String(err instanceof Error ? err.message : err)); }
  };

  const test = async (payload: any, key: string) => {
    setTesting(key); setNotice('');
    try {
      await api()('connection:test', payload);
      setTestResult((prev) => ({ ...prev, [key]: 'ok' }));
    } catch (err) {
      setTestResult((prev) => ({ ...prev, [key]: 'err' }));
      setNotice(String(err instanceof Error ? err.message : err));
    } finally { setTesting(''); }
  };

  const createTeam = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const agentIds = data.agents.filter((a: Agent) => (f.getAll('agents') as string[]).includes(a.id)).map((a: Agent) => a.id);
    try {
      await api()('team:save', {
        name: String(f.get('name') || ''), agentIds, folders: teamFolders, allowRun: teamAllowRun,
        virtualMachineId: teamVme || undefined, vmAllowRun: teamVmRun
      });
      teamFormRef.current?.reset();
      setTeamFolders([]);
      setTeamAllowRun(false);
      setTeamVme('');
      setTeamVmRun(false);
      await refresh();
      setNotice(t('set.savedTeam'));
    } catch (err) { setNotice(String(err instanceof Error ? err.message : err)); }
  };

  /** Create a virtual environment from the settings form. */
  const createVme = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const pages = String(f.get('pages') || '').split('\n').map((l) => l.trim()).filter(Boolean);
    try {
      await api()('vme:create', { name: String(f.get('name') || ''), pages });
      vmeFormRef.current?.reset();
      await refresh();
      setNotice(t('set.savedVme'));
    } catch (err) { setNotice(String(err instanceof Error ? err.message : err)); }
  };

  /** Rebind a team's virtual environment (settings list, one click). */
  const setTeamVmeAssignment = async (teamId: string, virtualMachineId: string | null) => {
    try {
      const team = data.teams.find((t_: any) => t_.id === teamId);
      if (!team) return;
      await api()('team:save', {
        id: team.id, name: team.name,
        agentIds: JSON.parse(team.agent_ids) as string[],
        folders: encodeFolderFlags(decodeFolders(team.folders), decodeWritable(team.folders)),
        allowRun: team.allow_run === 1,
        virtualMachineId: virtualMachineId || undefined,
        vmAllowRun: team.vm_allow_run === 1
      });
      await refresh();
    } catch (err) { setNotice(String(err instanceof Error ? err.message : err)); }
  };

  const toggleTeamVmRun = async (teamId: string) => {
    try {
      const team = data.teams.find((t_: any) => t_.id === teamId);
      if (!team) return;
      await api()('team:save', {
        id: team.id, name: team.name,
        agentIds: JSON.parse(team.agent_ids) as string[],
        folders: encodeFolderFlags(decodeFolders(team.folders), decodeWritable(team.folders)),
        allowRun: team.allow_run === 1,
        virtualMachineId: team.virtual_machine || undefined,
        vmAllowRun: team.vm_allow_run !== 1
      });
      await refresh();
    } catch (err) { setNotice(String(err instanceof Error ? err.message : err)); }
  };

  const openVme = async (id: string, page?: number) => {
    try { await api()('vme:open', { id, page }); }
    catch (err) { setNotice(String(err instanceof Error ? err.message : err)); }
  };

  const pickTeamFolder = async () => {
    try {
      const folder = await api()('team:pickFolder');
      if (folder) setTeamFolders((prev) => (prev.includes(folder) ? prev : [...prev, folder]));
    } catch (err) { setNotice(String(err instanceof Error ? err.message : err)); }
  };

  const decodeFolders = (raw: string | null | undefined): string[] =>
    parseFolderFlags(raw ? (JSON.parse(raw) as string[]) : []).folders;

  const decodeWritable = (raw: string | null | undefined): Set<string> => {
    const { writable } = parseFolderFlags(raw ? (JSON.parse(raw) as string[]) : []);
    return writable;
  };

  const saveTeamFolders = async (teamId: string, folders: string[], writable: Set<string>) => {
    const team = data.teams.find((t: any) => t.id === teamId);
    if (!team) return;
    // Capability is stored in the entry itself: `path [WRITABLE]` grants write
    // access during missions; plain entries stay read-only.
    const stored = encodeFolderFlags(folders, writable);
    await api()('team:save', {
      id: team.id, name: team.name,
      agentIds: JSON.parse(team.agent_ids) as string[], folders: stored,
      allowRun: team.allow_run === 1,
      virtualMachineId: team.virtual_machine || undefined,
      vmAllowRun: team.vm_allow_run === 1
    });
    await refresh();
  };

  const assignFolderToTeam = async (teamId: string) => {
    try {
      const folder = await api()('team:pickFolder');
      if (!folder) return;
      const folders: string[] = decodeFolders(data.teams.find((t: any) => t.id === teamId)?.folders);
      if (!folders.includes(folder)) folders.push(folder);
      await saveTeamFolders(teamId, folders, decodeWritable(data.teams.find((t: any) => t.id === teamId)?.folders));
      setNotice(t('set.savedFolder'));
    } catch (err) { setNotice(String(err instanceof Error ? err.message : err)); }
  };

  const removeFolderFromTeam = async (teamId: string, folder: string) => {
    try {
      const team = data.teams.find((t: any) => t.id === teamId);
      if (!team) return;
      const writable = decodeWritable(team.folders);
      const folders = decodeFolders(team.folders).filter((f: string) => f !== folder);
      writable.delete(folder);
      await saveTeamFolders(teamId, folders, writable);
    } catch (err) { setNotice(String(err instanceof Error ? err.message : err)); }
  };

  const toggleFolderWritable = async (teamId: string, folder: string) => {
    try {
      const team = data.teams.find((t: any) => t.id === teamId);
      if (!team) return;
      const folders = decodeFolders(team.folders);
      const writable = decodeWritable(team.folders);
      if (writable.has(folder)) writable.delete(folder); else writable.add(folder);
      await saveTeamFolders(teamId, folders, writable);
    } catch (err) { setNotice(String(err instanceof Error ? err.message : err)); }
  };

  const toggleTeamRun = async (teamId: string) => {
    try {
      const team = data.teams.find((t: any) => t.id === teamId);
      if (!team) return;
      await api()('team:save', {
        id: team.id, name: team.name,
        agentIds: JSON.parse(team.agent_ids) as string[],
        folders: encodeFolderFlags(decodeFolders(team.folders), decodeWritable(team.folders)),
        allowRun: team.allow_run !== 1,
        virtualMachineId: team.virtual_machine || undefined,
        vmAllowRun: team.vm_allow_run === 1
      });
      await refresh();
    } catch (err) { setNotice(String(err instanceof Error ? err.message : err)); }
  };

  return (
    <section className="settings-page">
      <div className="settings-inner">
        <div className="settings-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1>{t('set.title')}</h1>
            <p className="settings-lede">{t('set.lede')}</p>
          </div>
          <div className="lang-picker" title={t('set.languageSub')}>
            <span className="field-label">{t('set.language')}</span>
            <select
              className="select mini"
              value={lang}
              onChange={(e) => onLangChange(e.target.value === 'en' ? 'en' : 'fr')}
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
            <span className="card-sub" style={{ fontSize: 10.5 }}>{t('set.languageInstall')}</span>
          </div>
        </div>
        {notice && (
          <div className={`notice ${noticeType}`} style={{ marginBottom: 18 }}>{notice}</div>
        )}

        <div className="settings-grid">
          <section className="card">
            <h2>{t('set.connections')}</h2>
            <p className="card-sub">{t('set.connectionsSub')}</p>
            <form className="form" ref={connectionFormRef} onSubmit={save}>
              <label>{t('set.name')}
                <input className="field" name="name" placeholder="Ma clé Anthropic" required />
              </label>
              <label>{t('set.providerType')}
                <select className="field" name="type" defaultValue="claude">
                  <option value="claude">Claude (Anthropic)</option>
                  <option value="openai">ChatGPT / OpenAI</option>
                  <option value="custom">{t('set.custom')}</option>
                </select>
              </label>
              <div className="endpoint-hint">
                Endpoint Claude : <code>{endpoints?.claude ?? 'https://api.anthropic.com/v1/messages'}</code><br />
                Endpoint OpenAI : <code>{endpoints?.openai ?? 'https://api.openai.com/v1/chat/completions'}</code><br />
                {t('set.customUrlHint')} <code>http://localhost:11434/v1</code>).
              </div>
              <label>{t('set.baseUrl')} <span style={{ color: 'var(--text-3)' }}>{t('set.baseUrlHint')}</span>
                <input className="field" name="baseUrl" placeholder="http://localhost:11434/v1" />
              </label>
              <div className="form-row">
                <label>{t('set.modelId')}
                  <input className="field" name="model" placeholder="claude-3-5-sonnet-latest" required />
                </label>
                <label>{t('set.apiKey')}
                  <input className="field" name="apiKey" type="password" autoComplete="new-password" placeholder={t('set.apiKeyPlaceholder')} />
                </label>
              </div>
              <div className="form-actions">
                <button className="btn btn-primary">{t('set.saveConnection')}</button>
              </div>
            </form>

            <div className="connection-list">
              {data.connections.map((c: Connection) => (
                <div className="connection-row" key={c.id}>
                  <div className="meta">
                    <div className="name">{c.name} <span className="status-chip">{c.type}</span></div>
                    <div className="sub">{c.model}{c.base_url ? ` · ${c.base_url}` : ''}</div>
                  </div>
                  <button
                    className="text-btn"
                    disabled={testing === c.id}
                    onClick={() => test({ id: c.id }, c.id)}
                  >
                    {testing === c.id ? t('set.testing') : (testResult[c.id] === 'ok' ? t('set.testOk') : testResult[c.id] === 'err' ? t('set.testFail') : t('set.test'))}
                  </button>
                  <button className="text-btn danger" onClick={async () => { await api()('connection:delete', { id: c.id }); await refresh(); }}>{t('set.delete')}</button>
                </div>
              ))}
            </div>
            <p className="card-sub" style={{ marginTop: 14 }}>
              {t('set.openaiNote')}
            </p>
          </section>

          <section style={{ display: 'grid', gap: 18 }}>
            <div className="card">
              <h2>{t('set.teams')}</h2>
              <p className="card-sub">{t('set.teamsSub')}</p>
              <form className="form" ref={teamFormRef} onSubmit={createTeam}>
                <label>{t('set.teamName')}
                  <input className="field" name="name" required placeholder={t('set.teamNamePlaceholder')} />
                </label>
                <div>
                  <span className="field-label">{t('set.participants')}</span>
                  <div className="check-list">
                    {data.agents.map((a: Agent) => (
                      <label className="check-item" key={a.id}>
                        <input type="checkbox" name="agents" value={a.id} /> {a.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="field-label">{t('set.folders')}</span>
                  <div className="form-actions">
                    <button type="button" className="btn btn-ghost" onClick={pickTeamFolder}>
                      <PapIcon name="layers" size={14} /> {t('set.assignFolder')}
                    </button>
                  </div>
                  {teamFolders.length > 0 && (
                    <div className="folder-chips" style={{ marginTop: 8 }}>
                      {teamFolders.map((f) => (
                        <span className="folder-chip" key={f}>
                          <PapIcon name="layers" size={12} />
                          <span className="label">{f}</span>
                          <button type="button" className="chip-remove" onClick={() => {
                            setTeamFolders((prev) => prev.filter((x) => x !== f));
                          }}>×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <label className="check-item" style={{ marginTop: 8, display: 'flex' }}>
                    <input
                      type="checkbox"
                      checked={teamAllowRun}
                      onChange={(e) => setTeamAllowRun(e.target.checked)}
                    />
                    {t('set.allowRun')}
                  </label>
                  <span className="card-sub" style={{ fontSize: 10.5, display: 'block', marginTop: 4 }}>
                    {t('set.allowRunSub')}
                  </span>
                </div>
                {(data.vmes || []).length > 0 && (
                  <div>
                    <span className="field-label">{t('set.vmeTeam')}</span>
                    <select
                      className="field"
                      value={teamVme}
                      onChange={(e) => setTeamVme(e.target.value)}
                    >
                      <option value="">{t('set.vmeTeamNone')}</option>
                      {(data.vmes as Vme[]).filter((v) => !v.teamId).map((v) => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                    {teamVme && (
                      <>
                        <label className="check-item" style={{ marginTop: 8, display: 'flex' }}>
                          <input
                            type="checkbox"
                            checked={teamVmRun}
                            onChange={(e) => setTeamVmRun(e.target.checked)}
                          />
                          {t('set.vmeAllowRun')}
                        </label>
                        <span className="card-sub" style={{ fontSize: 10.5, display: 'block', marginTop: 4 }}>
                          {t('set.vmeAllowRunSub')}
                        </span>
                      </>
                    )}
                  </div>
                )}
                <div className="form-actions"><button className="btn btn-primary">{t('set.saveTeam')}</button></div>
              </form>
              {data.teams.map((t_: any) => {
                const folders = decodeFolders(t_.folders);
                const writable = decodeWritable(t_.folders);
                return (
                <div className="connection-row" key={t_.id}>
                  <div className="meta">
                    <div className="name">{t_.name}</div>
                    <div className="sub">
                      {(JSON.parse(t_.agent_ids) as string[]).length} agents
                      {folders.length > 0 ? ` · ${folders.length} ${t('set.foldersCount')}` : ''}
                    </div>
                    {folders.length > 0 && (
                      <div className="folder-chips" style={{ marginTop: 6 }}>
                        {folders.map((f: string) => (
                          <span className="folder-chip" key={f}>
                            <PapIcon name="layers" size={12} />
                            <span className="label">{f}</span>
                            <button
                              type="button"
                              className={`chip-toggle ${writable.has(f) ? 'on' : ''}`}
                              title={writable.has(f) ? t('set.writableOn') : t('set.writableOff')}
                              onClick={() => toggleFolderWritable(t_.id, f)}
                            >{writable.has(f) ? t('set.writableOn') : t('set.writableOff')}</button>
                            <button type="button" className="chip-remove" title={t('set.removeFolder')} onClick={() => removeFolderFromTeam(t_.id, f)}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <label className="check-item" style={{ marginTop: 6, display: 'flex' }}>
                      <input
                        type="checkbox"
                        checked={t_.allow_run === 1}
                        onChange={() => toggleTeamRun(t_.id)}
                      />
                      {t('set.allowRun')}
                    </label>
                    {(data.vmes || []).length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <span className="field-label">{t('set.vmeTeam')}</span>
                        <select
                          className="select mini"
                          value={t_.virtual_machine || ''}
                          onChange={(e) => setTeamVmeAssignment(t_.id, e.target.value || null)}
                        >
                          <option value="">{t('set.vmeTeamNone')}</option>
                          {(data.vmes as Vme[])
                            .filter((v) => !v.teamId || v.id === t_.virtual_machine)
                            .map((v) => (
                              <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                        </select>
                        {t_.virtual_machine && (
                          <label className="check-item" style={{ marginTop: 6, display: 'flex' }}>
                            <input
                              type="checkbox"
                              checked={t_.vm_allow_run === 1}
                              onChange={() => toggleTeamVmRun(t_.id)}
                            />
                            {t('set.vmeAllowRun')}
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: 4, justifyItems: 'end' }}>
                    <button className="text-btn" onClick={() => assignFolderToTeam(t_.id)}>{t('set.addFolder')}</button>
                    {t_.virtual_machine && (
                      <button className="text-btn" onClick={() => openVme(t_.virtual_machine)}>{t('set.openVme')}</button>
                    )}
                  </div>
                  <button className="text-btn danger" onClick={async () => { await api()('team:delete', { id: t_.id }); await refresh(); }}>{t('set.delete')}</button>
                </div>
                );
              })}
            </div>

            <div className="card">
              <h2>{t('set.vme')}</h2>
              <p className="card-sub">{t('set.vmeSub')}</p>
              <form className="form" ref={vmeFormRef} onSubmit={createVme}>
                <label>{t('set.vmeName')}
                  <input className="field" name="name" required placeholder={t('set.vmeNamePlaceholder')} />
                </label>
                <label>{t('set.vmePages')}
                  <textarea className="field" name="pages" rows={3} placeholder={t('set.vmePagesPlaceholder')} />
                </label>
                <div className="form-actions">
                  <button className="btn btn-primary">{t('set.createVme')}</button>
                </div>
              </form>
              <p className="card-sub" style={{ marginTop: 10 }}>{t('set.vmeHint')}</p>
              <div className="connection-list">
                {(data.vmes || []).length === 0 && <div className="history-empty">{t('set.noVme')}</div>}
                {((data.vmes || []) as Vme[]).map((v) => {
                  const owner = v.teamId ? data.teams.find((t_: any) => t_.id === v.teamId) : null;
                  return (
                    <div className="connection-row" key={v.id}>
                      <div className="meta">
                        <div className="name">
                          <PapIcon name="monitor" size={13} /> {v.name}
                          <span className={`status-chip ${v.ready ? 'ok' : ''}`}>
                            {v.ready ? t('team.vmReady') : '…'}
                          </span>
                        </div>
                        <div className="sub">
                          {owner
                            ? t('set.vmeAssignedTo', { team: owner.name })
                            : t('set.vmeFree')}
                          {' · '}
                          <span title={v.path}>{t('set.vmePath')} {v.path.length > 46 ? `…${v.path.slice(-44)}` : v.path}</span>
                        </div>
                        {v.pages.length > 0 && (
                          <div className="folder-chips" style={{ marginTop: 6 }}>
                            {v.pages.map((p) => (
                              <span className="folder-chip" key={p.url}>
                                <PapIcon name="globe" size={12} />
                                <span className="label">{p.label}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button className="text-btn" onClick={() => openVme(v.id)}>{t('set.openVme')}</button>
                      {v.pages.length > 0 && (
                        <button className="text-btn" onClick={() => openVme(v.id, 0)}>{t('set.openVmePage')}</button>
                      )}
                      <button
                        className="text-btn danger"
                        disabled={!!v.teamId}
                        title={v.teamId ? t('set.vmeAssignedTo', { team: owner?.name ?? '' }) : undefined}
                        onClick={async () => {
                          try { await api()('vme:delete', { id: v.id }); await refresh(); setNotice(t('set.deletedVme')); }
                          catch (err) { setNotice(String(err instanceof Error ? err.message : err)); }
                        }}
                      >{t('set.delete')}</button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <h2>{t('set.agents')}</h2>
              <p className="card-sub">{t('set.agentsSub')}</p>
              {!showAgentForm && <button className="btn btn-ghost" onClick={() => setShowAgentForm(true)}><PapIcon name="plus" size={14} /> {t('set.createAgent')}</button>}
              {showAgentForm && (
                <form className="form" ref={agentFormRef} onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const f = new FormData(form);
                  try {
                    await api()('agent:save', {
                      name: String(f.get('name') || ''), description: String(f.get('description') || ''), instructions: String(f.get('instructions') || '')
                    });
                    setShowAgentForm(false);
                    await refresh();
                    setNotice(t('set.savedAgent'));
                  } catch (err) { setNotice(String(err instanceof Error ? err.message : err)); }
                }}>
                  <label>{t('set.name')}<input className="field" name="name" required /></label>
                  <label>{t('set.description')}<input className="field" name="description" /></label>
                  <label>{t('set.instructions')}<textarea className="field" name="instructions" required rows={4} /></label>
                  <div className="form-actions">
                    <button className="btn btn-primary">{t('set.save')}</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setShowAgentForm(false)}>{t('set.cancel')}</button>
                  </div>
                </form>
              )}
              <div className="connection-list">
                {data.agents.filter((a: Agent) => a.custom === 1).map((a: Agent) => (
                  <div className="connection-row" key={a.id}>
                    <div className="meta">
                      <div className="name"><PapIcon name={a.icon} size={13} /> {a.name}</div>
                      <div className="sub">{a.description || t('set.noDescription')}</div>
                    </div>
                    <button className="text-btn danger" onClick={async () => { await api()('agent:delete', { id: a.id }); await refresh(); }}>{t('set.delete')}</button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
