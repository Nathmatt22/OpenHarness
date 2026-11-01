import { useEffect, useState } from 'react';
import { api } from './types';
import { makeT, type Lang, type TFunction } from './i18n';

export type Page = 'chat' | 'team' | 'settings';
export type Mode = 'solo' | 'team';

const LANG_KEY = 'ui.language';

export function useLang(data: any) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = data?.settings?.[LANG_KEY];
    if (stored === 'en' || stored === 'fr') return stored;
    return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  });

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = async (next: Lang) => {
    setLangState(next);
    try { await api()('settings:set', { key: LANG_KEY, value: next }); } catch { /* keep in-memory value */ }
  };

  return { lang, setLang, t: makeT(lang) as TFunction };
}

export function useAppData() {
  const [data, setData] = useState({
    agents: [], connections: [], conversations: [], teams: [], vmes: [], endpoints: undefined, encryptionAvailable: true
  } as any);
  const [loadError, setLoadError] = useState('');
  const refresh = async () => {
    try { setData(await api()('app:init')); setLoadError(''); }
    catch (e) { setLoadError(String(e instanceof Error ? e.message : e)); }
  };
  useEffect(() => { void refresh(); }, []);
  return { data, loadError, refresh };
}

export function useTheme() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle('light-root', light);
  }, [light]);
  return { light, toggle: () => setLight(l => !l) };
}

export type Activity = 'thinking' | 'reading' | 'writing' | 'creating' | 'deleting' | 'running' | 'vm' | 'queued' | 'idle';

export function useRealtime(onDelta: (d: any) => void, onChatError: (e: any) => void) {
  const [missionId, setMissionId] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [missionRunning, setMissionRunning] = useState(false);
  const [missionDone, setMissionDone] = useState('');
  // conversationId -> { agentId, activity } : what each thread's agent is doing.
  const [activities, setActivities] = useState<Record<string, { agentId?: string; activity: Activity }>>({});
  useEffect(() => {
    const offs = [
      api().on('chat:delta', onDelta),
      api().on('chat:error', onChatError),
      api().on('mission:started', (x: any) => { setMissionId(x.missionId); setMissionRunning(true); }),
      api().on('mission:event', (x: any) => setEvents(prev => [...prev, x])),
      api().on('mission:done', (x: any) => { setMissionRunning(false); setMissionId(''); setMissionDone(x.status ?? 'completed'); }),
      api().on('agent:activity', (x: any) => {
        setActivities((prev) => {
          const next = { ...prev };
          if (!x.activity || x.activity === 'idle') delete next[x.conversationId];
          else next[x.conversationId] = { agentId: x.agentId, activity: x.activity };
          return next;
        });
      })
    ];
    return () => offs.forEach(off => off());
    // Handlers read live ids through refs, so a single subscription is enough.
  }, []);
  return { missionId, events, setEvents, missionRunning, missionDone, activities };
}
