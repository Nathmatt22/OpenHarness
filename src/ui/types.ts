export interface Agent { id: string; name: string; description: string; instructions: string; icon: string; tools: string; custom: number; }
export interface Connection { id: string; name: string; type: string; base_url: string; model: string; created_at: string; }
export interface Conversation { id: string; title: string; agent_id: string; connection_id: string | null; created_at: string; }
export interface ChatMessage { id: string; role: string; content: string; }
export interface Team { id: string; name: string; agent_ids: string; folders: string | null; created_at: string; }
export interface WorkspaceEntry { name: string; type: 'file' | 'folder'; size?: number; }
export interface WorkspaceListing { folder: string; entries: WorkspaceEntry[]; }
export interface MissionEvent { missionId: string; agentId: string; content: string; created_at?: string; }
export interface Endpoints { claude: string; openai: string; }

export interface AppData {
  agents: Agent[];
  connections: Connection[];
  conversations: Conversation[];
  teams: Team[];
  settings: Record<string, string>;
  endpoints?: Endpoints;
  encryptionAvailable?: boolean;
}

export interface Invoke {
  (channel: 'app:init'): Promise<AppData>;
  (channel: 'settings:get', data: { key: string }): Promise<string | null>;
  (channel: 'settings:set', data: { key: string; value: string }): Promise<boolean>;
  (channel: 'connection:save', data: { id?: string; name: string; type: string; baseUrl?: string; apiKey?: string; model: string }): Promise<{ id: string }>;
  (channel: 'connection:delete', data: { id: string }): Promise<boolean>;
  (channel: 'connection:test', data: { id?: string; type?: string; baseUrl?: string; apiKey?: string; model?: string }): Promise<boolean>;
  (channel: 'conversation:create', data: { agentId: string; connectionId?: string | null; title?: string }): Promise<{ id: string }>;
  (channel: 'conversation:delete', data: { id: string }): Promise<boolean>;
  (channel: 'conversation:messages', data: { id: string }): Promise<ChatMessage[]>;
  (channel: 'chat:send', data: { conversationId: string; agentId: string; content: string }): Promise<{ content: string }>;
  (channel: 'chat:stop', data: { id: string }): Promise<boolean>;
  (channel: 'agent:save', data: { id?: string; name: string; description?: string; instructions: string }): Promise<{ id: string }>;
  (channel: 'agent:delete', data: { id: string }): Promise<boolean>;
  (channel: 'team:save', data: { id?: string; name: string; agentIds: string[]; folders?: string[] }): Promise<{ id: string }>;
  (channel: 'team:delete', data: { id: string }): Promise<boolean>;
  (channel: 'team:pickFolder'): Promise<string | null>;
  (channel: 'workspace:list', data: { teamId: string }): Promise<WorkspaceListing[]>;
  (channel: 'workspace:read', data: { teamId: string; relative: string }): Promise<string>;
  (channel: 'mission:start', data: { teamId: string; task: string }): Promise<{ id: string; result: string }>;
  (channel: 'mission:stop', data: { id: string }): Promise<boolean>;
  (channel: 'mission:events', data: { id: string }): Promise<MissionEvent[]>;
  (channel: string, data?: any): Promise<any>;
  on(channel: string, callback: (data: any) => void): () => void;
}

export type Api = Invoke & { on: (channel: string, callback: (data: any) => void) => () => void };

export function api(): Api {
  const bridge = (window as any).openharness;
  const call = ((channel: string, data?: unknown) => bridge.invoke(channel, data)) as Api;
  call.on = (channel: string, callback: (data: any) => void) => bridge.on(channel, callback);
  return call;
}
