# Agents

Ten built-in agents are seeded into SQLite on first launch. Their stable IDs, system instructions and permitted-tool labels are maintained in `electron/agents.ts`. Custom agents can be created from Settings and are stored locally. Tool labels are descriptive only: the application does not expose arbitrary local file access to model calls.

During team missions, agents of a team with assigned folders gain one bounded capability: requesting the content of a file inside those folders with a `READ: <fichier>` line. The request is resolved in the main process under strict path confinement (read-only, no traversal, no symlinks out) — see `docs/ORCHESTRATOR.md`.
