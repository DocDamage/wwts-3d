import { defineConfig } from 'vite';
import path from 'path';
import { attachJudgeHub, judgeInfoMiddleware } from './server/judgeHub.js';
import { dataApiMiddleware } from './server/dataApi.js';

/** Runs the local judge hub inside Vite so phones on the same Wi-Fi can score */
function judgeHubPlugin() {
  const wire = (server) => {
    if (!server.httpServer) return;
    attachJudgeHub(server.httpServer);
    server.middlewares.use(judgeInfoMiddleware(() => server.httpServer.address()?.port));
    server.middlewares.use(dataApiMiddleware(path.resolve(__dirname, 'data')));
  };
  return {
    name: 'wwts-judge-hub',
    configureServer: wire,
    configurePreviewServer: wire
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [judgeHubPlugin()],
  server: {
    port: 3000,
    host: true, // listen on the LAN so judges' phones can connect
    open: true
  },
  preview: {
    port: 3000,
    host: true
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        broadcast: path.resolve(__dirname, 'broadcast.html'),
        judge: path.resolve(__dirname, 'judge.html'),
        vote: path.resolve(__dirname, 'vote.html'),
        overlay: path.resolve(__dirname, 'overlay.html')
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  assetsInclude: ['**/*.fbx']
});
