import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  // tsconfig.json sets `jsx: preserve` (Next.js convention), so `.test.tsx`
  // files can't be parsed by Vite's default loader. The React plugin
  // installs the JSX transform needed to compile component tests.
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // The second pattern runs the co-located unit tests in
    // packages/shared (pure helpers, no runtime deps). The shared
    // package has no test runner of its own; without this pattern
    // those tests never execute anywhere.
    include: ['src/**/*.test.{ts,tsx}', '../../packages/shared/src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `server-only` throws at import time when bundled into a
      // non-server context — that's the Next.js boundary it
      // enforces. Vitest doesn't run in a Next request context, so
      // any module that does `import 'server-only'` (e.g. our
      // simple-auth, business-auth, db, storage) would crash the
      // test runner. Aliasing it to an empty stub preserves the
      // production-time check without breaking unit tests.
      'server-only': path.resolve(__dirname, './src/test/server-only-stub.ts'),
    },
  },
})
