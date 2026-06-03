import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// Tauri expects a fixed port and to not clear the screen.
const host = process.env.TAURI_DEV_HOST;
// Expose package.json version to the app (used by the 关于 section).
const pkgVersion = JSON.parse(readFileSync('./package.json', 'utf8')).version;

export default defineConfig({
  clearScreen: false,
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkgVersion),
  },
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
