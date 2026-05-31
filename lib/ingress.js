// ╭────────────────────────────╮
// │  ingress.js               │
// │  Home Assistant ingress   │
// │  middleware: rewrites      │
// │  absolute asset URLs into  │
// │  the ingress path prefix   │
// ╰────────────────────────────╯
const fs   = require('fs');
const path = require('path');

// HA's ingress proxy serves the add-on under a token prefix
// (e.g. /api/hassio_ingress/<token>) and strips that prefix before
// forwarding requests to us. The browser, however, resolves the page's
// absolute URLs (/scripts/x.js, url(/media/y.svg)) against the HA origin
// WITHOUT the prefix, so they 404. A <base> tag only fixes relative URLs,
// so we rewrite the absolute references in HTML and CSS responses to carry
// the prefix. Runtime fetch/XHR/WebSocket calls are handled separately by
// the injected adapter script. Non-ingress requests pass through untouched.
const createIngressMiddleware = ({ staticDir }) => (req, res, next) => {
  const ingressPath = req.headers['x-ingress-path'];
  if (!ingressPath) return next();

  // Normalise to a prefix without a trailing slash for clean concatenation.
  const prefix = ingressPath.replace(/\/$/, '');

  const isHtml = req.path === '/' || req.path.endsWith('.html');
  const isCss  = req.path.endsWith('.css');
  if (!isHtml && !isCss) return next();

  const resolvedPath = req.path === '/'
    ? 'pages/index.html'
    : req.path.replace(/^\//, '');
  const filePath = path.join(staticDir, resolvedPath);
  if (!fs.existsSync(filePath)) return next();

  try {
    let body = fs.readFileSync(filePath, 'utf8');

    if (isHtml) {
      // Prefix absolute href="/..." and src="/..." (but not protocol-relative //).
      body = body.replace(/(\s(?:href|src)=["'])\/(?!\/)/g, `$1${prefix}/`);

      // Inject a <base> tag and the adapter so runtime requests resolve too.
      const baseTag = `<base href="${prefix}/">`;
      const adapterTag = `<script src="${prefix}/scripts/ingressAdapter.js"></script>`;
      body = body.replace('<head>', `<head>\n    ${baseTag}\n    ${adapterTag}`);
      res.type('html');
    } else {
      // Prefix absolute url(/...) references in stylesheets.
      body = body.replace(/url\((['"]?)\/(?!\/)/g, `url($1${prefix}/`);
      res.type('css');
    }

    res.send(body);
  } catch {
    next();
  }
};

module.exports = { createIngressMiddleware };
