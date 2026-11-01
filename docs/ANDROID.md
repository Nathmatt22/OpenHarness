# Android companion (Capacitor)

OpenHarness est une application de bureau Electron. La build Android est un
**compagnon** : il empaquète la même interface React (Capacitor, `webDir:
dist`) sous forme d'APK pour consulter l'application en mobilité.

- **Ce qui fonctionne** : navigation dans l'interface, thème, langue.
- **Ce qui ne fonctionne pas** : les appels fournisseurs, les secrets chiffrés,
  les missions, les dossiers assignés et les environnements virtuels — tout ce
  qui vit dans le processus principal Electron. L'interface le signale
  (`chat.loadError`) puisque le pont IPC `window.openharness` est absent.

## Build local

```sh
npm install
npm run build:android   # build web + cap sync + gradle assembleDebug
```

L'APK sort dans `android/app/build/outputs/apk/debug/app-debug.apk`. La CI
(`build:android` dans `.github/workflows/build.yml`) produit le même artefact
sur ubuntu (JDK 17 + SDK Android préinstallés/activés par les actions
`setup-java` et `setup-android`) et le joint à la release GitHub.
