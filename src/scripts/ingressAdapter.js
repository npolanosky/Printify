// ╭────────────────────────────────╮
// │  ingressAdapter.js            │
// │  Transparent URL rewriter     │
// │  for Home Assistant ingress.  │
// │  Activates only when a        │
// │  <base> tag is present.       │
// ╰────────────────────────────────╯
(function () {
  var baseElement = document.querySelector('base');
  if (!baseElement) return;

  var basePath = baseElement.getAttribute('href') || '';
  if (!basePath || basePath === '/') return;
  if (!basePath.endsWith('/')) basePath += '/';
  var prefix = basePath.slice(0, -1); // ingress path without trailing slash

  // The ingress token (everything up to the last slash in basePath).
  var originPrefix = window.location.origin; // e.g. https://homeassistant.local:8123

  // A value needs rewriting when it is either:
  //   (a) a root-absolute path (/foo) — not protocol-relative (//foo)
  //   (b) an absolute URL on the same origin (https://ha:8123/foo)
  // In both cases, skip if it already carries the ingress prefix.
  function needsRewrite(value) {
    if (typeof value !== 'string') return false;
    // Same-origin absolute URL: strip origin, then treat as path.
    if (value.indexOf(originPrefix + '/') === 0) {
      value = value.slice(originPrefix.length);
    }
    return value.charAt(0) === '/'
      && value.charAt(1) !== '/'
      && value.lastIndexOf(prefix + '/', 0) !== 0;
  }

  function rewrite(value) {
    if (typeof value !== 'string') return value;
    // Same-origin absolute: rewrite in-place keeping the origin.
    if (value.indexOf(originPrefix + '/') === 0) {
      var path = value.slice(originPrefix.length);
      if (path.charAt(0) === '/' && path.charAt(1) !== '/' && path.lastIndexOf(prefix + '/', 0) !== 0) {
        return originPrefix + prefix + path;
      }
      return value;
    }
    // Root-absolute path.
    if (needsRewrite(value)) return prefix + value;
    return value;
  }

  // Rewrite absolute fetch URLs so /printers becomes <prefix>/printers,
  // and same-origin URLs built with new URL(..., window.location.origin).
  var originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function (url) {
      if (typeof url === 'string') arguments[0] = rewrite(url);
      return originalFetch.apply(this, arguments);
    };
  }

  // Rewrite XMLHttpRequest.open for upload progress handlers.
  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === 'string') arguments[1] = rewrite(url);
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

  // Static markup is rewritten server-side, but the UI also injects images
  // (printer icons, previews, template icons) at runtime via innerHTML and
  // element.src. Watch the DOM and prefix any absolute src/href as it lands.
  var ATTRS = ['src', 'href'];
  function fixElement(element) {
    if (!element || element.nodeType !== 1 || !element.getAttribute) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var value = element.getAttribute(ATTRS[i]);
      if (needsRewrite(value)) element.setAttribute(ATTRS[i], prefix + value);
    }
  }
  function fixTree(node) {
    fixElement(node);
    if (node.querySelectorAll) {
      var matches = node.querySelectorAll('[src],[href]');
      for (var i = 0; i < matches.length; i++) fixElement(matches[i]);
    }
  }

  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      if (mutation.type === 'attributes') {
        fixElement(mutation.target);
      } else {
        for (var j = 0; j < mutation.addedNodes.length; j++) {
          fixTree(mutation.addedNodes[j]);
        }
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
})();
