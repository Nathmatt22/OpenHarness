import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android companion packaging (Capacitor).
 *
 * OpenHarness is an Electron desktop application: provider calls, secrets and
 * team workspaces live in the main process. The Android build ships the same
 * React interface as a read-oriented companion (history, agents, settings
 * review) and shows a banner explaining that provider calls need the desktop
 * app — the renderer already handles a missing `window.openharness` bridge
 * gracefully (`chat.loadError`).
 */
const config: CapacitorConfig = {
  appId: 'io.openharness.companion',
  appName: 'OpenHarness',
  webDir: 'dist',
  android: {
    allowMixedContent: false
  },
  server: {
    // Keep the packaged web assets local; no dev-server injection in releases.
    androidScheme: 'https'
  }
};

export default config;
