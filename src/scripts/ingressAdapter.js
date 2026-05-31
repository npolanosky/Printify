// ╭────────────────────────────────╮
// │  ingressAdapter.js            │
// │  Transparent URL rewriter     │
// │  for Home Assistant ingress.  │
// │  Only activates when a        │
// │  <base> tag is present.       │
// ╰────────────────────────────────╯
(function () {
  var baseElement = document.querySelector('base');
  if (!baseElement) return;

  var basePath = baseElement.getAttribute('href') || '';
  if (!basePath || basePath === '/') return;

  // Ensure the base path ends with a slash for clean concatenation.
  if (!basePath.endsWith('/')) basePath += '/';

  // Rewrite absolute fetch URLs so /printers becomes <basePath>printers.
  var originalFetch = window.fetch;
  window.fetch = function (url) {
    if (typeof url === 'string' && url.startsWith('/')) {
      arguments[0] = basePath + url.slice(1);
    }
    return originalFetch.apply(this, arguments);
  };

  // Rewrite XMLHttpRequest.open for upload progress handlers.
  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === 'string' && url.startsWith('/')) {
      arguments[1] = basePath + url.slice(1);
    }
    return originalOpen.apply(this, arguments);
  };

  // Rewrite WebSocket URLs so ws://host/ws/logs includes the ingress path.
  var OriginalWebSocket = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    if (typeof url === 'string') {
      url = url.replace(/^(wss?:\/\/[^/]+)\//, '$1' + basePath);
    }
    return protocols
      ? new OriginalWebSocket(url, protocols)
      : new OriginalWebSocket(url);
  };
  window.WebSocket.prototype = OriginalWebSocket.prototype;
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
})();
