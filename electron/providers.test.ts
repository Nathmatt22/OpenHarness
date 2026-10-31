import { describe, expect, it, vi } from 'vitest';
import { streamChat, testProvider } from './providers';
describe('provider adapters',()=>{
 it('sends Claude messages to its native API and parses SSE text',async()=>{
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Salut"}}\n\ndata: [DONE]\n\n',{status:200}));
  const chunks=[];for await(const chunk of streamChat({type:'claude',model:'test',apiKey:'secret'},[{role:'user',content:'Bonjour'}],new AbortController().signal))chunks.push(chunk);
  expect(chunks.join('')).toBe('Salut');expect(fetcher.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).system).toBeUndefined();fetcher.mockRestore();
 });
 it('rejects a provider test on HTTP failures',async()=>{
  vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response('unauthorized',{status:401}));
  await expect(testProvider({type:'custom',baseUrl:'http://localhost:11434/v1',model:'missing'})).rejects.toThrow('401');vi.restoreAllMocks();
 });
 it('rejects a failed chat request',async()=>{
  vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response('busy',{status:429}));
  const stream=streamChat({type:'openai',baseUrl:'https://example.test/v1',model:'m'},[{role:'user',content:'x'}],new AbortController().signal);
  await expect(stream.next()).rejects.toThrow('429');vi.restoreAllMocks();
 });
});
