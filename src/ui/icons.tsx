import { Sparkles, Code, Search, Check, Globe, Pen, Lock, Tasks, Gears, Add, ArrowUp, User, TextBubble, Pause } from '@getpapillon/papicons';

/** Verified against @getpapillon/papicons 0.2.3 exports. */
const map = {
  sparkles: Sparkles, code: Code, search: Search, check: Check,
  globe: Globe, edit: Pen, shield: Lock, layers: Tasks,
  chart: Tasks, workflow: Tasks, settings: Gears, plus: Add,
  send: ArrowUp, users: User, chat: TextBubble, stop: Pause,
  monitor: Globe
} as const;

export type IconName = keyof typeof map;

export function PapIcon({ name, size = 17, className }: { name: string; size?: number; className?: string }) {
  const Icon = map[name as IconName] ?? Sparkles;
  return (
    <span className={`pi ${className ?? ''}`}>
      <Icon size={size} color="currentColor" />
    </span>
  );
}

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5 4h6a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H9v6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
