import { defineConfig } from 'vite';

// Tauri expects a fixed port and to not clear the screen.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 5183,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 5184 }
      : undefined,
    watch: {
      // Don't watch the Rust side.
      ignored: ['**/src-tauri/**'],
    },
  },
  // Produce relative asset paths so the Tauri webview can load them.
  base: './',
  build: {
    target: 'es2021',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
