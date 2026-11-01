# OpenHarness for Android

The native mobile edition of [OpenHarness](../README.md) — **One Platform. Multiple AI Agents.**
Same product, rebuilt in Kotlin + Jetpack Compose, with the desktop application kept intact in the
repository root.

## What it does

- **Ten built-in agents** plus custom agents with their own system instructions.
- **Provider connections** for Claude (Anthropic), OpenAI and any OpenAI-compatible endpoint
  (Ollama, DeepSeek, LocalAI…).
- **Real streaming** chat over Server-Sent Events, with a working Stop button.
- **Sequential team missions**: every agent on the team is actually invoked, in order, with the
  previous results folded into the next prompt.
- **Read-only assigned folders** using the Storage Access Framework, with the `READ: <file>` request
  cycle, exactly like the desktop orchestrator.
- Dark and light themes, French and English interface.

Nothing is mocked: every response comes from a real provider call.

## Build

Requires JDK 17 and the Android SDK.

```bash
cd mobile
./gradlew assembleDebug        # debug APK
./gradlew assembleRelease      # release APK (debug-signed)
```

APKs land in `app/build/outputs/apk/`.

## Continuous integration

`.github/workflows/android.yml` runs on every push to `mobile/**`, on pull requests and by hand.
It compiles **both** the debug and the release APK, uploads them as artifacts, and attaches them to
the GitHub release when a `v*` tag is pushed.

## Architecture

| Desktop (Electron)              | Android                                  |
| ------------------------------- | ---------------------------------------- |
| `electron/main.ts` IPC handlers | `ui/AppViewModel.kt`                     |
| `electron/database.ts` SQLite   | `data/HarnessDb.kt`                      |
| `electron/providers.ts` SSE     | `net/Providers.kt` (OkHttp)              |
| `electron/agents.ts`            | `data/Agents.kt`                         |
| `electron/workspace.ts`         | `util/Workspace.kt` (SAF)                |
| `safeStorage`                   | `data/SecretStore.kt` (Android Keystore) |
| `src/ui/*` React                | `ui/*.kt` Compose                        |

The database schema is identical, so a desktop database can be read by the mobile app.

## Security

API keys are sealed with an AES/GCM key in the Android Keystore and never returned to the UI layer.
Folder access is confined to the SAF tree grants the user explicitly hands over; the app can never
see outside them. The app requests only `INTERNET` and `ACCESS_NETWORK_STATE`.

## License

MIT. See [LICENSE](../LICENSE).
