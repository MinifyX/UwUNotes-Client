import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The setup's page. 1431 rather than the editor's 1421, so both dev servers can
// run at once, and `strictPort` because `tauri.conf.json` names this port: a
// silent move to 1432 would leave the setup window pointing at nothing.
//
// Nyu is imported straight out of the editor's source tree instead of being
// copied here, which is the only unusual thing in this file — see `fs.allow`
// and `dedupe` below.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    // Nyu is compiled from `apps/desktop/src`, whose `react` resolves against
    // that package's `node_modules`. pnpm links the same React into both, so
    // this is insurance rather than a fix — two Reacts in one page fail as
    // broken hooks, a long way from the import that caused them.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 1431,
    strictPort: true,
    // Nyu lives outside this package, and the dev server refuses to serve a
    // file above its root without being told.
    fs: { allow: ['..'] },
    watch: {
      ignored: ['**/src-tauri/**', '**/target/**'],
    },
  },
  build: {
    target: 'chrome110',
    // The page is packed into the setup executable, which people download over
    // a slow line often enough; source maps have no reader there.
    sourcemap: false,
  },
});
