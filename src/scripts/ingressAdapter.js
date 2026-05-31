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

  // A value needs rewriting when it is a root-absolute path (/x), is not
  // protocol-relative (//x), and is not already carrying the ingress prefix.
  function needsRewrite(value) {
    return typeof value === 'string'
      && value.charAt(0) === '/'
      && value.charAt(1) !== '/'
      && value.lastIndexOf(prefix + '/', 0) !== 0;
  }

  // Rewrite absolute fetch URLs so /printers becomes <prefix>/printers.
  var originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function (url) {
      if (needsRewrite(url)) arguments[0] = prefix + url;
      return originalFetch.apply(this, arguments);
    };
  }

  // Rewrite XMLHttpRequest.open for upload progress handlers.
  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (needsRewrite(url)) arguments[1] = prefix + url;
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
