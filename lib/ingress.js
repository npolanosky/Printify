// ╭────────────────────────────╮
// │  ingress.js               │
// │  Home Assistant ingress   │
// │  middleware that injects  │
// │  a <base> tag and adapter │
// │  script into HTML pages   │
// ╰────────────────────────────╯
const fs   = require('fs');
const path = require('path');

// When the request arrives through HA's ingress proxy, X-Ingress-Path
// carries the public prefix the browser needs to reach this add-on.
// We inject a <base> tag and a small adapter script into HTML responses
// so all static resources, fetch calls, and WebSocket connections
// resolve through the ingress path automatically.
const createIngressMiddleware = ({ staticDir }) => (req, res, next) => {
  const ingressPath = req.headers['x-ingress-path'];
  if (!ingressPath) return next();

  // Only intercept top-level page requests, not API calls or static assets.
  const isPageRequest = req.path === '/'
    || req.path === '/index.html'
    || req.path.endsWith('.html');

  if (!isPageRequest) return next();

  const resolvedPath = req.path === '/' ? 'pages/index.html' : req.path.replace(/^\//, '');
  const filePath = path.join(staticDir, resolvedPath);

  if (!fs.existsSync(filePath)) return next();

  const basePath = ingressPath.endsWith('/') ? ingressPath : `${ingressPath}/`;
  const baseTag = `<base href="${basePath}">`;
  const adapterTag = '<script src="scripts/ingressAdapter.js"></script>';

  try {
    let html = fs.readFileSync(filePath, 'utf8');
    html = html.replace('<head>', `<head>\n    ${baseTag}\n    ${adapterTag}`);
    res.type('html').send(html);
  } catch {
    next();
  }
};

module.exports = { createIngressMiddleware };
