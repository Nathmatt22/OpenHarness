# Contributing

1. Install Node.js 20+ and run `npm install`.
2. Create a focused branch and describe the behavior being changed.
3. Run `npm test`, `npm run typecheck`, and `npm run build` before submitting.
4. Never commit API keys, local databases, build output, or personal data.
5. Changes to IPC must preserve the preload allowlist and validate untrusted renderer inputs in the main process.
6. Provider tests should use controlled local HTTP fixtures; do not require live credentials in CI.
7. Packaging changes should be verified on the target OS and report generated artifact names.

By contributing, you agree that contributions are provided under the repository's MIT license.
