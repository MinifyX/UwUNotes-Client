import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Tauri drives the dev server, so the port is fixed and failures must be loud:
// silently moving to 1422 would leave the app pointing at nothing. 1421 rather
// than 1420, so UwUNotes and UwUSSH can run side by side.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**', '**/target/**'],
    },
  },
  build: {
    target: 'chrome110',
    // Source maps would be packed into the release binary for nothing: the
    // source is public anyway, and dev builds have them regardless.
    sourcemap: false,
  },
});
