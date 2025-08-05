import { defineConfig } from 'vite';

export default defineConfig({
  root: 'demo',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: 'localhost',
    port: 5173,
    proxy: {
      // proxy websockets
      '/': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
});
