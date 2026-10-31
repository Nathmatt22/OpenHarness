import { contextBridge, ipcRenderer } from 'electron';
const invokeChannels = new Set(['app:init','settings:get','settings:set','connection:save','connection:delete','connection:test','conversation:create','conversation:list','conversation:messages','conversation:delete','chat:send','chat:stop','agent:save','agent:delete','team:save','team:delete','team:pickFolder','workspace:list','workspace:read','workspace:write','workspace:delete','workspace:mkdir','workspace:run','teamchat:create','teamchat:list','teamchat:messages','teamchat:send','teamchat:stop','mission:start','mission:stop','mission:events']);
const eventChannels = new Set(['chat:delta','chat:error','mission:event','mission:done','mission:started']);
contextBridge.exposeInMainWorld('openharness', {
  invoke: (channel: string, data?: unknown) => { if (!invokeChannels.has(channel)) return Promise.reject(new Error('IPC method not allowed')); return ipcRenderer.invoke(channel, data); },
  on: (channel: string, callback: (data: unknown) => void) => { if (!eventChannels.has(channel)) throw new Error('IPC event not allowed'); const listener = (_: Electron.IpcRendererEvent, data: unknown) => callback(data); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener); }
});
