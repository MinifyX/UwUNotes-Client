import { defineConfig } from 'vitest/config';

/**
 * Tests only. `vite.config.ts` is the app's build and is left alone: it carries
 * the React plugin and the fixed Tauri dev port, neither of which a headless
 * test run has any use for, and a shared file would mean every test run pays
 * for the app's bundling decisions.
 *
 * `jsdom` rather than node, because the interesting half of this app is
 * CodeMirror and an `EditorView` needs somewhere to put its DOM. The modules
 * under test also read `window.localStorage` while they are being imported,
 * which in a bare node environment throws before a single test runs.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // Module-level singletons are most of what is being tested here; a shared
    // process would let one file's store leak into the next file's assertions.
    isolate: true,
    server: {
      deps: {
        // @uwusuite/design 1.1.0 ships ESM with extensionless relative imports
        // (`./components/Button`), which Vite resolves and plain Node does not.
        // Inlining lets Vite resolve them in tests as it does in the build.
        inline: ['@uwusuite/design'],
      },
    },
  },
});
