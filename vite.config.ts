import { defineConfig } from 'vite';

export default defineConfig({
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
