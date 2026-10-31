export type ProviderType = 'claude' | 'openai' | 'custom';
export interface ProviderInput { type: ProviderType; baseUrl?: string; apiKey?: string; model: string; }
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string; }

/** Official provider endpoints. Users never configure these. */
const OFFICIAL_ENDPOINTS: Record<Exclude<ProviderType, 'custom'>, string> = {
  claude: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions'
};

export function providerEndpoint(type: Exclude<ProviderType, 'custom'>): string {
  return OFFICIAL_ENDPOINTS[type];
}

const DEFAULT_TIMEOUT_MS = 120000;

interface SseFrame { event: string; data: string; }

async function* sseFrames(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    if (signal?.aborted) { reader.cancel().catch(() => undefined); fail('Génération interrompue.'); }
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n|\r\n\r\n/);
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const event = /^event:\s*(.*)$/m.exec(block)?.[1]?.trim() ?? '';
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (data) yield { event, data };
    }
  }
}

function fail(message: string): never { throw new Error(message); }

function anthropicBody(model: string, messages: ChatMessage[], stream: boolean) {
  return JSON.stringify({
    model,
    max_tokens: 4096,
    system: messages.find((m) => m.role === 'system')?.content,
    messages: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
    stream
  });
}

function openAiBody(model: string, messages: ChatMessage[], stream: boolean) {
  return JSON.stringify({ model, messages, stream });
}

function headersFor(provider: ProviderInput, stream: boolean): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (provider.type === 'claude') {
    headers['x-api-key'] = provider.apiKey ?? '';
    headers['anthropic-version'] = '2023-06-01';
    if (stream) headers['accept'] = 'text/event-stream';
  } else if (provider.apiKey) {
    headers.authorization = `Bearer ${provider.apiKey}`;
  }
  return headers;
}

function endpointFor(provider: ProviderInput): string {
  if (provider.type === 'claude') return providerEndpoint('claude');
  if (provider.type === 'openai') return providerEndpoint('openai');
  const base = provider.baseUrl?.replace(/\/+$/, '');
  if (!base) fail('Base URL manquante pour l’API personnalisée.');
  return `${base}/chat/completions`;
}

export async function testProvider(provider: ProviderInput): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(endpointFor(provider), {
      method: 'POST',
      signal: controller.signal,
      headers: headersFor(provider, false),
      body: provider.type === 'claude'
        ? anthropicBody(provider.model, [{ role: 'user', content: 'Reply with the single word OK' }], false)
        : openAiBody(provider.model, [{ role: 'user', content: 'Reply with the single word OK' }], false)
    });
    if (!response.ok) fail(`${response.status} — ${await response.text().catch(() => 'réponse illisible')}`);
    return true;
  } finally {
    clearTimeout(timer);
  }
}

export async function* streamChat(provider: ProviderInput, messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<string> {
  const isClaude = provider.type === 'claude';
  const response = await fetch(endpointFor(provider), {
    method: 'POST',
    signal,
    headers: headersFor(provider, true),
    body: isClaude ? anthropicBody(provider.model, messages, true) : openAiBody(provider.model, messages, true)
  });
  if (!response.ok) fail(`${response.status} — ${await response.text().catch(() => 'réponse illisible')}`);
  if (!response.body) fail('Le fournisseur n’a pas retourné de flux.');

  for await (const frame of sseFrames(response.body, signal)) {
    if (frame.data === '[DONE]') return;
    try {
      const parsed = JSON.parse(frame.data);
      const text = isClaude
        ? (parsed.type === 'content_block_delta' ? parsed.delta?.text : undefined)
        : parsed.choices?.[0]?.delta?.content;
      if (typeof text === 'string' && text) yield text;
      if (parsed.error?.message) fail(String(parsed.error.message));
    } catch (e) {
      if (e instanceof TypeError) throw e;
    }
  }
}

export const DEFAULT_TIMEOUT = DEFAULT_TIMEOUT_MS;
