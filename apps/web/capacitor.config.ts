import type { CapacitorConfig } from '@capacitor/cli'

// appId: apps/api/.env.local carries no APPLE_APP_BUNDLE_IDENTIFIER at the
// time of scaffolding, so com.kasero.app is the canonical id. If an Apple
// bundle identifier is ever provisioned for Sign in with Apple native
// (APPLE_APP_BUNDLE_IDENTIFIER), it must match this value.
const config: CapacitorConfig = {
  appId: 'com.kasero.app',
  appName: 'Kasero',
  // Bundled SPA, NOT a remote server.url — shipping a thin wrapper around
  // a remote URL is an App Store Review Guideline 4.2 rejection vector,
  // and the bundled shell keeps cold start instant and offline-safe.
  webDir: 'dist',
  server: {
    // Distinctive WebView host (FINDING 4). Capacitor's `hostname` is
    // global (not per-platform), so this yields:
    //   iOS     -> capacitor://kasero.localhost
    //   Android -> https://kasero.localhost
    // We moved off the default `localhost` because the generic Android
    // origin `https://localhost` is shared by any local HTTPS dev server,
    // which widened the CSRF/CORS trust boundary. `kasero.localhost` is an
    // app-specific host no ordinary local server occupies, and it is still
    // a *.localhost loopback name so getUserMedia / secure-context Web APIs
    // (barcode camera) keep working. These origins are mirrored in the
    // API allowlist at apps/api/src/lib/native-origins.ts — keep them in
    // sync, and run `npx cap sync` after changing this value.
    hostname: 'kasero.localhost',
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  plugins: {
    SplashScreen: {
      // Brand paper tone (--color-bg light) — matches the PWA splash set.
      backgroundColor: '#F6EFDF',
      launchShowDuration: 800,
      launchAutoHide: true,
      showSpinner: false,
    },
    Keyboard: {
      // 'native' resizes the WebView viewport itself, which is what the
      // existing visualViewport-tuned UI (modal sheets, inputs) expects.
      // See .claude/docs/capacitor-native.md for the modal-shell note.
      resize: 'native',
    },
  },
}

export default config
