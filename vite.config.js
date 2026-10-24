import { defineConfig } from 'vite';

function tripoProxyPlugin() {
  return {
    name: 'tripo-cors-proxy',
    configureServer(server) {
      server.middlewares.use('/api/tripo-proxy', async (req, res) => {
        try {
          const targetUrl = req.headers['x-target-url'];
          if (!targetUrl) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing x-target-url header' }));
            return;
          }
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const bodyBuf = Buffer.concat(chunks);

          const headers = { Accept: 'application/json' };
          if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
          if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'];
          if (req.headers['x-custom-auth-name'] && req.headers['x-custom-auth-val']) {
            headers[req.headers['x-custom-auth-name']] = req.headers['x-custom-auth-val'];
          }

          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 7500);
          let upstream;
          try {
            upstream = await fetch(targetUrl, {
              method: req.method || 'GET',
              headers,
              body: req.method !== 'GET' && req.method !== 'HEAD' && bodyBuf.length > 0 ? bodyBuf : undefined,
              signal: ctrl.signal,
            });
          } finally {
            clearTimeout(timer);
          }

          res.statusCode = upstream.status;
          const ct = upstream.headers.get('content-type') || 'application/json';
          res.setHeader('Content-Type', ct);
          res.setHeader('Access-Control-Allow-Origin', '*');
          const arrBuf = await upstream.arrayBuffer();
          res.end(Buffer.from(arrBuf));
        } catch (err) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.name === 'AbortError' ? `连接超时 (${req.headers['x-target-url']} 可能是内网地址，云服务器无法直连)` : (err.message || 'Proxy request failed') }));
        }
      });
    },
  };
}

export default defineConfig({
  publicDir: 'assets',
  plugins: [tripoProxyPlugin()],
  server: { host: '0.0.0.0', port: 3000, strictPort: true, allowedHosts: true },
  build: { target: 'esnext', chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
