import { useRef, useState } from 'react';
import { PapIcon } from './icons';
import { Agent, Connection, Endpoints, api } from './types';
import type { Lang, TFunction } from './i18n';

export function SettingsPage({ data, refresh, notice, setNotice, lang, onLangChange, t }: {
  data: any; refresh: () => Promise<void>; notice: string; setNotice: (n: string) => void;
  lang: Lang; onLangChange: (l: Lang) => void; t: TFunction;
}) {
  const [testing, setTesting] = useState('');
  const [testResult, setTestResult] = useState<Record<string, 'ok' | 'err'>>({});
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [teamFolders, setTeamFolders] = useState<string[]>([]);
  const endpoints: Endpoints | undefined = data.endpoints;
  const connectionFormRef = useRef<HTMLFormElement>(null);
  const teamFormRef = useRef<HTMLFormElement>(null);
  const agentFormRef = useRef<HTMLFormElement>(null);
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
      await api()('team:save', { name: String(f.get('name') || ''), agentIds, folders: teamFolders });
      teamFormRef.current?.reset();
      setTeamFolders([]);
      await refresh();
      setNotice(t('set.savedTeam'));
    } catch (err) { setNotice(String(err instanceof Error ? err.message : err)); }
  };

  const pickTeamFolder = async () => {
    try {
      const folder = await api()('team:pickFolder');
      if (folder) setTeamFolders((prev) => (prev.includes(folder) ? prev : [...prev, folder]));
    } catch (err) { setNotice(String(err instanceof Error ? err.message : err)); }
  };

  const assignFolderToTeam = async (teamId: string) => {
    try {
      const folder = await api()('team:pickFolder');
      if (!folder) return;
      const team = data.teams.find((t: any) => t.id === teamId);
      if (!team) return;
      const folders: string[] = team.folders ? JSON.parse(team.folders) : [];
      if (!folders.includes(folder)) folders.push(folder);
      await api()('team:save', {
        id: team.id, name: team.name,
        agentIds: JSON.parse(team.agent_ids) as string[], folders
      });
      await refresh();
      setNotice(t('set.savedFolder'));
    } catch (err) { setNotice(String(err instanceof Error ? err.message : err)); }
  };

  const removeFolderFromTeam = async (teamId: string, folder: string) => {
    try {
      const team = data.teams.find((t: any) => t.id === teamId);
      if (!team) return;
      const folders: string[] = (team.folders ? JSON.parse(team.folders) : []).filter((f: string) => f !== folder);
      await api()('team:save', {
        id: team.id, name: team.name,
        agentIds: JSON.parse(team.agent_ids) as string[], folders
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
                          <button type="button" className="chip-remove" onClick={() => setTeamFolders((prev) => prev.filter((x) => x !== f))}>×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="form-actions"><button className="btn btn-primary">{t('set.saveTeam')}</button></div>
              </form>
              {data.teams.map((t_: any) => (
                <div className="connection-row" key={t_.id}>
                  <div className="meta">
                    <div className="name">{t_.name}</div>
                    <div className="sub">
                      {(JSON.parse(t_.agent_ids) as string[]).length} agents
                      {t_.folders && (JSON.parse(t_.folders) as string[]).length > 0
                        ? ` · ${(JSON.parse(t_.folders) as string[]).length} ${t('set.foldersCount')}`
                        : ''}
                    </div>
                    {t_.folders && (JSON.parse(t_.folders) as string[]).length > 0 && (
                      <div className="folder-chips" style={{ marginTop: 6 }}>
                        {(JSON.parse(t_.folders) as string[]).map((f: string) => (
                          <span className="folder-chip" key={f}>
                            <PapIcon name="layers" size={12} />
                            <span className="label">{f}</span>
                            <button type="button" className="chip-remove" title={t('set.removeFolder')} onClick={() => removeFolderFromTeam(t_.id, f)}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="text-btn" onClick={() => assignFolderToTeam(t_.id)}>{t('set.addFolder')}</button>
                  <button className="text-btn danger" onClick={async () => { await api()('team:delete', { id: t_.id }); await refresh(); }}>{t('set.delete')}</button>
                </div>
              ))}
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
