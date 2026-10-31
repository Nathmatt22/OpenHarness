# Providers

Exactly three connector types are exposed: Claude (Anthropic), ChatGPT / OpenAI API, and Custom API.

- Claude uses the fixed official endpoint `https://api.anthropic.com/v1/messages` with Anthropic version headers and SSE streaming. The endpoint is enforced in `electron/providers.ts` and is never user-configurable.
- OpenAI uses the fixed official endpoint `https://api.openai.com/v1/chat/completions` with bearer auth and SSE streaming. Also enforced, not configurable.
- Custom connections append `/chat/completions` to the user's Base URL with bearer auth when a key is present.
- Custom endpoints must be explicitly configured; example Ollama URL: `http://localhost:11434/v1`.
- API keys are encrypted with Electron `safeStorage`; connection metadata is stored in SQLite.
- Use provider-issued API access. ChatGPT subscriptions do not provide an OpenAI API key.

Some compatible providers vary in URL layout and streaming format. Validate a provider against its documented API before production use.
