# Orchestrator

Saved teams contain ordered agent IDs and, optionally, assigned folders. Starting a mission creates a durable mission record and invokes each selected agent against a real configured provider, passing the task and prior outputs as context. Each result is persisted as a mission event and streamed to the UI. A failure marks the mission failed; a successful sequence marks it completed.

## Assigned folders

When a team has folders assigned (Settings → Équipes), the main process builds a read-only listing before the first agent runs and appends it to every participant's first message. Agents can request a file with a full line `READ: <relative path>`; the marker is parsed out of the streamed answer, resolved by the main process, and the content is sent back as the next message of the same conversation so the agent can finalize its answer. A mission turn allows at most 3 rounds and 5 files per round.

Resolution is confined by construction: requests must be relative, `..` and absolute paths are refused, and each candidate is resolved to its real path (symlinks included) then verified to sit inside one of the assigned folders. Binaries and files above 64 KB are refused. Refusals are reported to the agent as text ("Lecture de … impossible") instead of leaking content. See `electron/workspace.ts` and its tests, plus the end-to-end mission test with a scripted SSE provider.

## Scope

The current scheduler is sequential and bounded by team size. It does not autonomously plan subtask dependencies or execute file changes (file access is read-only, within assigned folders only). Cancellation and mission stop are exposed, though the current renderer's stop control needs the active mission ID wired before relying on it; use this workflow with that limitation in mind.
