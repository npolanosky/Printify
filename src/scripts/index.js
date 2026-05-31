(function () {
  // ╭──────────────────────────╮
  // │  Shared constants        │
  // ╰──────────────────────────╯
  const APP_VERSION = '2.7.1';
  window.PRINTIFY_CLIENT_VERSION = APP_VERSION;
  const PRINTIFY_LOG_ROUTE = '#printifyLogDrawer';
  const PRINTIFY_FILE_KINDS = {
    pdf: {
      fieldName: 'pdfFile',
      label: 'PDF',
    },
    image: {
      fieldName: 'imgFile',
      label: 'Image',
    },
    zip: {
      fieldName: 'zipFile',
      label: 'ZIP',
    },
  };
  const ZIP_MIME_TYPES = new Set([
    'application/zip',
    'application/x-zip',
    'application/x-zip-compressed',
    'application/octet-stream',
  ]);
  const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp']);
  const IMAGE_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/tiff',
    'image/webp',
  ]);
  const ZIP_EXTENSIONS = new Set(['zip']);
  const ASPECT_RATIO_WARNING_MIN_AREA_FRACTION = 0.72;
  const APPEARANCE_STORAGE_KEY = 'printify-appearance';
  const THEME_FAMILY_STORAGE_KEY = 'printify-theme-family';
  const ASSISTANT_OVERRIDE_STORAGE_KEY = 'printify-assistant-override';
  const PRINTER_OPTION_STATE_STORAGE_KEY = 'printify-printer-option-state';
  const DUPLICATE_WHITELIST_STORAGE_KEY = 'printify-duplicate-whitelist';
  const DUPLICATE_WHITELIST_DURATION_MS = 24 * 60 * 60 * 1000;
  const ASSISTANT_BOOT_BUBBLE_DELAY_MIN_MS = 1000;
  const ASSISTANT_BOOT_BUBBLE_DELAY_MAX_MS = 2500;
  const ASSISTANT_BOOT_BUBBLE_HOLD_MS = 5000;
  const DEFAULT_APPEARANCE = 'dark';
  const DEFAULT_THEME_FAMILY = 'default';
  const DEFAULT_THEME_OPTION = {
    value: DEFAULT_THEME_FAMILY,
    label: 'Default',
    href: null,
  };
  const SERVER_ASSISTANT_OPTION = '__server__';
  const DEFAULT_ASSISTANT = 'Clippy';
  let themeFamilyOptions = [DEFAULT_THEME_OPTION];
  const ASSISTANT_OPTIONS = [
    { value: SERVER_ASSISTANT_OPTION, label: 'Server Default' },
    { value: 'Bonzi', label: 'Bonzi' },
    { value: 'Clippy', label: 'Clippy' },
    { value: 'F1', label: 'F1' },
    { value: 'Genie', label: 'Genie' },
    { value: 'Genius', label: 'Genius' },
    { value: 'Links', label: 'Links' },
    { value: 'Merlin', label: 'Merlin' },
    { value: 'Peedy', label: 'Peedy' },
    { value: 'Rocky', label: 'Rocky' },
    { value: 'Rover', label: 'Rover' },
    { value: 'none', label: 'None' },
  ];
  const DUPLICATE_PROMPTS = [
    'This file has been printed recently, send it?',
    'File printed within the last 31 days, print again?',
    'Recent match found for this file. Run another print?',
    'This document was already printed not long ago. Send it anyway?',
    'Looks like this file has been used recently. Print one more time?',
    'A recent copy of this file was already sent to this printer. Queue another one?',
    'This document has a fresh print history for this printer. Send it again?',
  ];
  const ID_DEBUG_PREFIX = '[id-debug]';
  const UUID_GREGORIAN_OFFSET_100NS = 122192928000000000n;
  const UUID_100NS_PER_MILLISECOND = 10000n;
  let lastClientJobTimestamp = 0n;

  const loadPrinterOptionState = () => {
    try {
      const rawValue = window.localStorage.getItem(PRINTER_OPTION_STATE_STORAGE_KEY);
      if (!rawValue) return {};
      const parsedValue = JSON.parse(rawValue);
      return parsedValue && typeof parsedValue === 'object' ? parsedValue : {};
    } catch (error) {
      return {};
    }
  };

  const getStoredAppearance = () => {
    try {
      const storedValue = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
      return storedValue === 'light' ? 'light' : DEFAULT_APPEARANCE;
    } catch (error) {
      return DEFAULT_APPEARANCE;
    }
  };

  const getStoredThemeFamily = () => {
    try {
      const storedValue = window.localStorage.getItem(THEME_FAMILY_STORAGE_KEY);
      return storedValue ? String(storedValue) : DEFAULT_THEME_FAMILY;
    } catch (error) {
      return DEFAULT_THEME_FAMILY;
    }
  };

  const getStoredAssistantOverride = () => {
    try {
      const storedValue = window.localStorage.getItem(ASSISTANT_OVERRIDE_STORAGE_KEY);
      if (!storedValue) return null;
      return ASSISTANT_OPTIONS.some(option => option.value === storedValue)
        ? storedValue
        : null;
    } catch (error) {
      return null;
    }
  };

  const getRandomDelayMs = (min, max) => {
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    return Math.round(low + (Math.random() * (high - low)));
  };

  const persistPrinterOptionState = () => {
    try {
      window.localStorage.setItem(PRINTER_OPTION_STATE_STORAGE_KEY, JSON.stringify(appState.printerOptionState || {}));
    } catch (error) {
      // Keep printer option persistence best-effort so the UI stays responsive.
    }
  };

  const appState = {
    printers: [],
    pageHits: 0,
    printCounter: 0,
    exactPrintCounter: 0,
    pageCounter: 0,
    actualPrintCounter: 0,
    actualPageCounter: 0,
    testingPrintCounter: 0,
    testingPageCounter: 0,
    paperAreaSquareMm: 0,
    actualPaperAreaSquareMm: 0,
    testingPaperAreaSquareMm: 0,
    serverVersion: 'Unknown',
    serverDataVersion: 'Unknown',
    testing: false,
    lastStartedAt: null,
    lastPrintAt: null,
    lastPrintJob: null,
    dailyStats: {},
    serverAssistant: DEFAULT_ASSISTANT,
    appearance: getStoredAppearance(),
    themeFamily: getStoredThemeFamily(),
    assistantOverride: getStoredAssistantOverride(),
    assistant: DEFAULT_ASSISTANT,
    feedbackTimer: null,
    assistantAgent: null,
    assistantBootTimer: null,
    assistantSpeechTimer: null,
    labelBuilder: null,
    logDrawer: null,
    clientPluginsById: {},
    clientPluginModules: {},
    clientPluginInputHandles: [],
    openPrinterId: null,
    printerOptionState: loadPrinterOptionState(),
    statsSocket: null,
    statsSocketReconnectTimer: null,
    statsRefreshTimer: null,
    confirmSystem: null,
    activeJobs: [],
  };

  const dragDepth = new Map();
  const appShell = document.querySelector('.printify-app');
  const printerGrid = document.getElementById('printerGrid');
  const feedback = document.getElementById('feedback');
  const confirmLayer = document.getElementById('confirmLayer');
  const promptLayer = document.getElementById('promptLayer');
  const promptCard = document.getElementById('promptCard');
  const promptEyebrow = document.getElementById('promptEyebrow');
  const promptTitle = document.getElementById('promptTitle');
  const promptMessage = document.getElementById('promptMessage');
  const promptSubtext = document.getElementById('promptSubtext');
  const promptCancel = document.getElementById('promptCancel');
  const promptConfirm = document.getElementById('promptConfirm');
  const themeToggle = document.getElementById('themeToggle');
  const quickConfig = document.getElementById('quickConfig');
  const quickConfigBody = document.getElementById('quickConfigBody');
  const quickConfigThemeToggle = document.getElementById('quickConfigThemeToggle');
  const quickConfigThemeMeta = document.getElementById('quickConfigThemeMeta');
  const quickConfigThemeFamilyButton = document.getElementById('quickConfigThemeFamilyButton');
  const quickConfigThemeFamilyMenu = document.getElementById('quickConfigThemeFamilyMenu');
  const quickConfigThemeFamilyMeta = document.getElementById('quickConfigThemeFamilyMeta');
  const quickConfigAssistantButton = document.getElementById('quickConfigAssistantButton');
  const quickConfigAssistantMenu = document.getElementById('quickConfigAssistantMenu');
  const quickConfigAssistantMeta = document.getElementById('quickConfigAssistantMeta');
  const footerDrawer = window.createPrintifyFooterDrawer?.('#printifyFooterDrawer', {
    footerSelector: '#footer',
  }) || null;
  const setClientOverlayActive = (layerName, isActive) => {
    window.printifyClientOverlay?.setActive?.(layerName, isActive);
  };

  // ╭──────────────────────────╮
  // │  Formatting helpers      │
  // ╰──────────────────────────╯
  const escapeHtml = value => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const getThemeFamilyOptions = () => themeFamilyOptions;

  const getThemeFamilyOption = value => (
    getThemeFamilyOptions().find(option => option.value === value) || DEFAULT_THEME_OPTION
  );

  const hasThemeFamilyOption = value => (
    getThemeFamilyOptions().some(option => option.value === value)
  );

  const getThemeStylesheetId = themeValue => `printify-theme-family-${themeValue}-stylesheet`;

  const ensureThemeStylesheet = themeOption => new Promise(resolve => {
    if (!themeOption?.href) {
      resolve();
      return;
    }

    const stylesheetId = getThemeStylesheetId(themeOption.value);
    const existingLink = document.getElementById(stylesheetId);

    if (existingLink) {
      resolve();
      return;
    }

    const link = document.createElement('link');
    link.id = stylesheetId;
    link.rel = 'stylesheet';
    link.href = themeOption.href;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });

  const loadThemeFamilies = async () => {
    const response = await fetch('/themes');

    if (!response.ok) {
      throw new Error('Could not load themes.');
    }

    const payload = await response.json();
    const discoveredThemes = Array.isArray(payload?.themes) ? payload.themes : [];
    const normalizedThemes = discoveredThemes
      .map(theme => ({
        value: String(theme?.value || '').trim(),
        label: String(theme?.label || '').trim(),
        href: String(theme?.href || '').trim(),
      }))
      .filter(theme => (
        theme.value
        && theme.value !== DEFAULT_THEME_FAMILY
        && theme.label
        && theme.href
      ));

    themeFamilyOptions = [
      DEFAULT_THEME_OPTION,
      ...normalizedThemes,
    ];

    await Promise.all(themeFamilyOptions.map(ensureThemeStylesheet));
  };

  const formatWholeNumber = value => {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return '0';
    }

    return numericValue.toLocaleString();
  };

  const getSixDigitCounter = value => {
    const numericValue = Math.max(0, Math.floor(Number(value) || 0));
    return String(numericValue).padStart(6, '0').slice(-6);
  };

  const buildPrinterCounterMarkup = value => {
    const digits = getSixDigitCounter(value).split('');
    const firstSignificantIndex = digits.findIndex(digit => digit !== '0');

    return digits.map((digit, index) => `
      <span class="printer-card__counter-digit${firstSignificantIndex !== -1 && index < firstSignificantIndex ? ' is-leading' : ''}" aria-hidden="true">
        <span class="printer-card__counter-digit-face">${digit}</span>
      </span>
    `).join('');
  };

  const getPrinterDisplayPageCount = printer => {
    const actualPageCounter = Number.isFinite(printer?.actualPageCounter)
      ? printer.actualPageCounter
      : 0;
    const combinedPageCounter = Number.isFinite(printer?.pageCounter)
      ? printer.pageCounter
      : actualPageCounter;

    return appState.testing
      ? combinedPageCounter
      : actualPageCounter;
  };

  const getPrinterDisplayAreaSquareMm = printer => {
    const actualAreaSquareMm = Number.isFinite(printer?.actualPaperAreaSquareMm)
      ? printer.actualPaperAreaSquareMm
      : 0;
    const combinedAreaSquareMm = Number.isFinite(printer?.paperAreaSquareMm)
      ? printer.paperAreaSquareMm
      : actualAreaSquareMm;

    return appState.testing
      ? combinedAreaSquareMm
      : actualAreaSquareMm;
  };

  const formatAreaSquareMeters = value => {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return '0';
    }

    const areaSquareMeters = numericValue / 1_000_000;

    if (areaSquareMeters > 0 && areaSquareMeters < 0.01) {
      return '<0.01';
    }

    const maximumFractionDigits = areaSquareMeters < 10
      ? 2
      : (areaSquareMeters < 100 ? 1 : 0);

    return areaSquareMeters.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits,
    });
  };

  const buildPrinterCounterTooltip = printer => {
    const numericPageCount = Math.max(0, Math.floor(Number(getPrinterDisplayPageCount(printer)) || 0));
    const pageCount = formatWholeNumber(numericPageCount);
    const pageLabel = numericPageCount === 1 ? 'page' : 'pages';
    const areaSquareMeters = formatAreaSquareMeters(getPrinterDisplayAreaSquareMm(printer));
    return `${pageCount} ${pageLabel} printed\n(${areaSquareMeters} m²)`;
  };

  const getFileExtension = fileName => {
    const segments = String(fileName || '').toLowerCase().split('.');
    return segments.length > 1 ? segments.pop() : '';
  };

  const getPrinterTargetSize = printer => {
    if (printer?.isTape) {
      const tapeWidth = Number.parseInt(printer.lastTapeWidthMm || printer.defaultTape || printer.tapes?.[0], 10);
      const density = Number(printer?.density);

      if (Number.isFinite(tapeWidth) && Number.isFinite(density) && density > 0) {
        return {
          width: Math.round((60 / 25.4) * density),
          height: Math.round((tapeWidth / 25.4) * density),
        };
      }
    }

    if (Number.isFinite(printer?.sizePxWidth) && Number.isFinite(printer?.sizePxHeight)) {
      return {
        width: printer.sizePxWidth,
        height: printer.sizePxHeight,
      };
    }

    const match = String(printer?.sizePx || '').match(/^(\d+)x(\d+)$/i);

    if (!match) return null;

    return {
      width: Number.parseInt(match[1], 10),
      height: Number.parseInt(match[2], 10),
    };
  };

  const getPrinterPaperRatio = printer => {
    const targetSize = getPrinterTargetSize(printer);

    if (targetSize?.width > 0 && targetSize?.height > 0) {
      return `${targetSize.width} / ${targetSize.height}`;
    }

    const sizeMatch = String(printer?.size || '').match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i);

    if (sizeMatch) {
      return `${sizeMatch[1]} / ${sizeMatch[2]}`;
    }

    return '4 / 6';
  };

  const prettyPrinterKinds = acceptedKinds => (
    acceptedKinds.map(kind => PRINTIFY_FILE_KINDS[kind]?.label || kind.toUpperCase())
  );

  const getFileKindToneClass = fileKind => {
    if (fileKind === 'pdf') return 'printer-card__kind-bubble--pdf';
    if (fileKind === 'image') return 'printer-card__kind-bubble--image';
    if (fileKind === 'zip') return 'printer-card__kind-bubble--zip';
    return '';
  };

  const getPrinterById = printerId => appState.printers.find(printer => printer.id === printerId);

  const pickRandomPrompt = () => DUPLICATE_PROMPTS[Math.floor(Math.random() * DUPLICATE_PROMPTS.length)];
  const formatPixels = ({ width, height }) => `${Math.round(width)}x${Math.round(height)}px`;

  const formatPercent = value => {
    if (!Number.isFinite(value)) return '0';
    const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };

  const debugIdLog = (...args) => {
    if (typeof console !== 'undefined' && typeof console.debug === 'function') {
      console.debug(ID_DEBUG_PREFIX, ...args);
    }
  };

  const createClientJobId = () => {
    if (!window.crypto?.getRandomValues) {
      const fallbackId = `client-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
      debugIdLog('client id generated (fallback)', fallbackId);
      return fallbackId;
    }

    let timestamp100ns = UUID_GREGORIAN_OFFSET_100NS + (BigInt(Date.now()) * UUID_100NS_PER_MILLISECOND);

    if (timestamp100ns <= lastClientJobTimestamp) {
      timestamp100ns = lastClientJobTimestamp + 1n;
    }

    lastClientJobTimestamp = timestamp100ns;

    const clockSeq = new Uint8Array(2);
    const nodeId = new Uint8Array(6);
    window.crypto.getRandomValues(clockSeq);
    window.crypto.getRandomValues(nodeId);

    const bytes = new Uint8Array(16);
    const timestampHex = timestamp100ns.toString(16).padStart(15, '0');

    const writeHex = (offset, value) => {
      for (let index = 0; index < value.length; index += 2) {
        bytes[offset + (index / 2)] = Number.parseInt(value.slice(index, index + 2), 16);
      }
    };

    writeHex(0, timestampHex.slice(0, 8));
    writeHex(4, timestampHex.slice(8, 12));
    bytes[6] = 0x60 | Number.parseInt(timestampHex.slice(12, 13), 16);
    bytes[7] = Number.parseInt(timestampHex.slice(13, 15), 16);
    bytes[8] = 0x80 | (clockSeq[0] & 0x3f);
    bytes[9] = clockSeq[1];
    bytes.set(nodeId, 10);

    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0'));
    const clientJobId = [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10, 16).join(''),
    ].join('-');

    debugIdLog('client id generated', clientJobId);
    return clientJobId;
  };

  const showFeedback = (message, options = {}) => {
    if (appState.assistant !== 'none' && appState.assistantAgent && typeof appState.assistantAgent.speak === 'function') {
      if (options.interruptAssistant) {
        window.clearTimeout(appState.assistantBootTimer);
        appState.assistantBootTimer = null;
        window.clearTimeout(appState.assistantSpeechTimer);
        appState.assistantSpeechTimer = null;
        appState.assistantAgent.stop?.();
      }

      appState.assistantAgent.speak(message, options.hold === true);
      return;
    }

    feedback.textContent = message;
    feedback.classList.add('is-visible');

    if (appState.feedbackTimer) window.clearTimeout(appState.feedbackTimer);
    appState.feedbackTimer = window.setTimeout(() => {
      feedback.classList.remove('is-visible');
    }, 2400);
  };

  const showConfirm = message => {
    showFeedback(message);
  };

  const getAssistantOption = value => (
    ASSISTANT_OPTIONS.find(option => option.value === value) || ASSISTANT_OPTIONS[0]
  );

  const getEffectiveAssistant = () => (
    appState.assistantOverride || appState.serverAssistant || DEFAULT_ASSISTANT
  );

  const persistAssistantOverride = value => {
    try {
      if (!value || value === SERVER_ASSISTANT_OPTION) {
        window.localStorage.removeItem(ASSISTANT_OVERRIDE_STORAGE_KEY);
        return;
      }

      window.localStorage.setItem(ASSISTANT_OVERRIDE_STORAGE_KEY, value);
    } catch (error) {
      // Keep assistant selection best-effort so the picker never blocks UI work.
    }
  };

  const destroyAssistantAgent = () => {
    window.clearTimeout(appState.assistantBootTimer);
    appState.assistantBootTimer = null;
    window.clearTimeout(appState.assistantSpeechTimer);
    appState.assistantSpeechTimer = null;

    const agent = appState.assistantAgent;
    if (!agent) {
      return;
    }

    try {
      agent._queue?.clear?.();
      agent._balloon?.pause?.();
      if (agent._balloon) {
        agent._balloon._active = false;
        agent._balloon._hold = false;
        agent._balloon._hidden = true;
        window.clearTimeout(agent._balloon._loop);
        window.clearTimeout(agent._balloon._hiding);
      }
      agent.stopCurrent?.();
      agent.closeBalloon?.();
      agent.stop?.();
      agent.hide?.(true);
      agent._balloon?.stop?.(true, true);
      agent._balloon?._balloon?.stop?.(true, true);
      agent._balloon?._balloon?.hide?.();
      agent._balloon?.remove?.();
      agent._el?.stop?.(true, true);
      agent._el?.remove?.();
    } catch (error) {
      // Assistant cleanup is intentionally tolerant because clippy.js internals vary by mascot.
    }

    appState.assistantAgent = null;
  };

  appState.assistant = getEffectiveAssistant();

  appState.confirmSystem = typeof window.createPrintifyConfirmSystem === 'function'
    ? window.createPrintifyConfirmSystem({
      confirmLayer,
      getPrinterCardElement: printerId => printerGrid?.querySelector(`[data-role="printer-card"][data-printer-id="${printerId}"]`) || null,
    })
    : null;

  const uploadFormDataWithProgress = options => (
    appState.confirmSystem?.uploadFormDataWithProgress
      ? appState.confirmSystem.uploadFormDataWithProgress(options)
      : fetch(options.routePath, {
        method: 'POST',
        body: options.formData,
      }).then(async response => {
        if (!response.ok) {
          throw new Error(`Upload failed (${response.status})`);
        }

        return response.json();
      })
  );

  const showPromptCard = ({
    tone = 'warning',
    eyebrow = 'Warning',
    title = 'Heads up',
    message = '',
    subtext = '',
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
  }) => new Promise(resolve => {
    if (!promptLayer || !promptCard || !promptEyebrow || !promptTitle || !promptMessage || !promptCancel || !promptConfirm) {
      resolve(window.confirm(message || title));
      return;
    }

    let settled = false;
    let previousFocus = document.activeElement;

    const finish = accepted => {
      if (settled) return;
      settled = true;

      promptLayer.hidden = true;
      setClientOverlayActive('prompt', false);
      promptCard.classList.remove('printify-prompt__card--warning');
      document.removeEventListener('keydown', handleKeyDown);
      promptCancel.removeEventListener('click', cancel);
      promptConfirm.removeEventListener('click', confirm);
      promptLayer.removeEventListener('click', handleBackdropClick);

      if (previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }

      resolve(accepted);
    };

    const cancel = () => finish(false);
    const confirm = () => finish(true);
    const handleBackdropClick = event => {
      if (event.target === promptLayer) {
        cancel();
      }
    };
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        confirm();
      }
    };

    promptCard.classList.toggle('printify-prompt__card--warning', tone === 'warning');
    promptEyebrow.textContent = eyebrow;
    promptTitle.textContent = title;
    promptMessage.textContent = message;
    if (promptSubtext) {
      promptSubtext.textContent = subtext;
      promptSubtext.hidden = !subtext;
    }
    promptCancel.textContent = cancelLabel;
    promptConfirm.textContent = confirmLabel;
    promptLayer.hidden = false;
    setClientOverlayActive('prompt', true);

    document.addEventListener('keydown', handleKeyDown);
    promptCancel.addEventListener('click', cancel);
    promptConfirm.addEventListener('click', confirm);
    promptLayer.addEventListener('click', handleBackdropClick);

    window.setTimeout(() => {
      promptConfirm.focus();
    }, 0);
  });

  window.printifyShowPromptCard = showPromptCard;

  let quickConfigOpen = false;
  let quickConfigCloseTimer = null;
  let assistantMenuOpen = false;
  let themeFamilyMenuOpen = false;
  let quickConfigHeightFrame = null;
  const measureQuickConfigOpenHeight = () => {
    if (!quickConfig || !quickConfigBody) {
      return;
    }

    const previousTransition = quickConfig.style.transition;
    const previousWidth = quickConfig.style.width;
    const previousHeight = quickConfig.style.height;
    const previousBodyHidden = quickConfigBody.hidden;

    quickConfig.style.transition = 'none';
    quickConfig.style.width = '274px';
    quickConfig.style.height = '48px';
    quickConfigBody.hidden = false;
    syncQuickConfigHeight();
    void quickConfig.offsetWidth;
    quickConfig.style.transition = previousTransition;
    quickConfig.style.width = previousWidth;
    quickConfig.style.height = previousHeight;

    if (previousBodyHidden && !quickConfigOpen) {
      quickConfigBody.hidden = true;
    }
  };

  const scheduleQuickConfigHeightSync = () => {
    window.cancelAnimationFrame(quickConfigHeightFrame);
    quickConfigHeightFrame = window.requestAnimationFrame(() => {
      quickConfigHeightFrame = window.requestAnimationFrame(() => {
        syncQuickConfigHeight();
      });
    });
  };

  const syncQuickConfigHeight = () => {
    if (!quickConfig || !quickConfigBody) {
      return;
    }

    const wasHidden = quickConfigBody.hidden;

    if (wasHidden) {
      quickConfigBody.hidden = false;
    }

    const computedStyle = window.getComputedStyle(quickConfigBody);
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
    const contentBottom = Array.from(quickConfigBody.children).reduce((maxBottom, child) => {
      if (!(child instanceof HTMLElement) || child.hidden) {
        return maxBottom;
      }

      const childBottom = child.offsetTop + child.offsetHeight;
      return Math.max(maxBottom, childBottom);
    }, paddingTop);
    const measuredHeight = Math.ceil(contentBottom + paddingBottom);
    quickConfig.style.setProperty('--printify-quick-config-open-height', `${measuredHeight}px`);

    if (wasHidden && !quickConfigOpen) {
      quickConfigBody.hidden = true;
    }
  };

  const closeThemeFamilyMenu = () => {
    themeFamilyMenuOpen = false;
    quickConfig?.classList.remove('is-menu-open');
    if (quickConfigThemeFamilyMenu) {
      quickConfigThemeFamilyMenu.hidden = true;
    }
    quickConfigThemeFamilyButton?.setAttribute('aria-expanded', 'false');
  };

  const closeAssistantMenu = () => {
    assistantMenuOpen = false;
    if (quickConfigAssistantMenu) {
      quickConfigAssistantMenu.hidden = true;
    }
    quickConfigAssistantButton?.setAttribute('aria-expanded', 'false');
  };

  const syncQuickConfigMenuState = () => {
    quickConfig?.classList.toggle('is-menu-open', assistantMenuOpen || themeFamilyMenuOpen);
  };

  const renderThemeFamilyMenu = () => {
    if (!quickConfigThemeFamilyMenu) {
      return;
    }

    quickConfigThemeFamilyMenu.innerHTML = getThemeFamilyOptions().map(option => `
      <button
        class="printify-quick-config__menu-option${option.value === appState.themeFamily ? ' is-active' : ''}"
        type="button"
        role="menuitemradio"
        aria-checked="${option.value === appState.themeFamily ? 'true' : 'false'}"
        data-theme-family-value="${escapeHtml(option.value)}"
      >${escapeHtml(option.label)}</button>
    `).join('');
  };

  const renderAssistantMenu = () => {
    if (!quickConfigAssistantMenu) {
      return;
    }

    const activeValue = appState.assistantOverride || SERVER_ASSISTANT_OPTION;
    quickConfigAssistantMenu.innerHTML = ASSISTANT_OPTIONS.map(option => `
      <button
        class="printify-quick-config__menu-option${option.value === activeValue ? ' is-active' : ''}"
        type="button"
        role="menuitemradio"
        aria-checked="${option.value === activeValue ? 'true' : 'false'}"
        data-assistant-value="${escapeHtml(option.value)}"
      >${escapeHtml(option.label)}</button>
    `).join('');
  };

  const syncThemeUi = () => {
    const currentAppearance = appState.appearance === 'light' ? 'light' : 'dark';
    const isDark = currentAppearance === 'dark';
    const currentThemeFamily = getThemeFamilyOption(appState.themeFamily);

    if (quickConfigThemeToggle) {
      quickConfigThemeToggle.textContent = isDark ? 'Switch to Light' : 'Switch to Dark';
    }

    if (quickConfigThemeMeta) {
      quickConfigThemeMeta.textContent = isDark
        ? 'Dark mode is active.'
        : 'Light mode is active.';
    }

    if (quickConfigThemeFamilyButton) {
      quickConfigThemeFamilyButton.textContent = currentThemeFamily.label;
      quickConfigThemeFamilyButton.title = `Theme family: ${currentThemeFamily.label}. Click to cycle themes. Right click for the full list.`;
    }

    if (quickConfigThemeFamilyMeta) {
      quickConfigThemeFamilyMeta.textContent = `Current family: ${currentThemeFamily.label}.`;
    }

    renderThemeFamilyMenu();
  };

  const syncAssistantUi = () => {
    const currentOption = getAssistantOption(appState.assistantOverride || SERVER_ASSISTANT_OPTION);
    const effectiveOption = getAssistantOption(getEffectiveAssistant());

    if (quickConfigAssistantButton) {
      quickConfigAssistantButton.textContent = currentOption.label;
      quickConfigAssistantButton.title = currentOption.value === SERVER_ASSISTANT_OPTION
        ? `Using server default (${effectiveOption.label}). Click to cycle assistants. Right click for the full list.`
        : `Assistant override: ${currentOption.label}. Click to cycle assistants. Right click for the full list.`;
    }

    if (quickConfigAssistantMeta) {
      quickConfigAssistantMeta.textContent = currentOption.value === SERVER_ASSISTANT_OPTION
        ? `Using server default: ${effectiveOption.label}.`
        : `Personal pick: ${currentOption.label}.`;
    }

    renderAssistantMenu();
    scheduleQuickConfigHeightSync();
  };

  const openAssistantMenu = () => {
    if (!quickConfigAssistantMenu) {
      return;
    }

    renderAssistantMenu();
    assistantMenuOpen = true;
    quickConfigAssistantMenu.hidden = false;
    quickConfigAssistantButton?.setAttribute('aria-expanded', 'true');
    syncQuickConfigMenuState();
  };

  const toggleAssistantMenu = () => {
    if (assistantMenuOpen) {
      closeAssistantMenu();
      syncQuickConfigMenuState();
      return;
    }

    closeThemeFamilyMenu();
    openAssistantMenu();
  };

  const openThemeFamilyMenu = () => {
    if (!quickConfigThemeFamilyMenu) {
      return;
    }

    renderThemeFamilyMenu();
    themeFamilyMenuOpen = true;
    quickConfigThemeFamilyMenu.hidden = false;
    quickConfigThemeFamilyButton?.setAttribute('aria-expanded', 'true');
    syncQuickConfigMenuState();
  };

  const toggleThemeFamilyMenu = () => {
    if (themeFamilyMenuOpen) {
      closeThemeFamilyMenu();
      syncQuickConfigMenuState();
      return;
    }

    closeAssistantMenu();
    openThemeFamilyMenu();
  };

  const bootClippy = () => {
    destroyAssistantAgent();

    if (appState.assistant === 'none') return;
    if (!window.clippy) return;

    window.clippy.load(appState.assistant, agent => {
      if (appState.assistant !== getEffectiveAssistant()) {
        agent.hide?.(true);
        agent._balloon?.remove?.();
        agent._el?.remove?.();
        return;
      }

      appState.assistantAgent = agent;
      if (typeof agent.pinToCorner === 'function') {
        agent.pinToCorner({
          right: 15,
          bottom: 15,
        });
      }
      agent.show();
      window.setTimeout(() => agent.reposition(), 80);

      appState.assistantBootTimer = window.setTimeout(() => {
        const line = window.PrintifyQuippy?.getRandomBootLine({
          printCounter: appState.exactPrintCounter || appState.printCounter,
          pageCounter: appState.pageCounter,
          actualPrintCounter: appState.actualPrintCounter,
          actualPageCounter: appState.actualPageCounter,
          testingPrintCounter: appState.testingPrintCounter,
          testingPageCounter: appState.testingPageCounter,
          paperAreaSquareMm: appState.paperAreaSquareMm,
          actualPaperAreaSquareMm: appState.actualPaperAreaSquareMm,
          testingPaperAreaSquareMm: appState.testingPaperAreaSquareMm,
          testing: appState.testing,
          pageHits: appState.pageHits,
          printers: appState.printers,
          serverVersion: appState.serverVersion,
          serverDataVersion: appState.serverDataVersion,
          lastStartedAt: appState.lastStartedAt,
          lastPrintAt: appState.lastPrintAt,
          lastPrintJob: appState.lastPrintJob,
          dailyStats: appState.dailyStats,
        }) || 'I appear to be between remarks at the moment.';

        agent.speak(line, true);
        window.clearTimeout(appState.assistantSpeechTimer);
        const speechDuration = typeof agent._balloon?.estimateSpeechDuration === 'function'
          ? agent._balloon.estimateSpeechDuration(line)
          : 0;
        appState.assistantSpeechTimer = window.setTimeout(() => {
          if (appState.assistantAgent !== agent) {
            return;
          }

          agent._balloon?.close?.();
          agent._balloon?.hide?.(true);
          appState.assistantSpeechTimer = null;
        }, ASSISTANT_BOOT_BUBBLE_HOLD_MS + speechDuration);
      }, getRandomDelayMs(ASSISTANT_BOOT_BUBBLE_DELAY_MIN_MS, ASSISTANT_BOOT_BUBBLE_DELAY_MAX_MS));
    });
  };

  const applyAssistantChoice = assistantValue => {
    const normalizedValue = ASSISTANT_OPTIONS.some(option => option.value === assistantValue)
      ? assistantValue
      : SERVER_ASSISTANT_OPTION;
    appState.assistantOverride = normalizedValue === SERVER_ASSISTANT_OPTION
      ? null
      : normalizedValue;
    persistAssistantOverride(normalizedValue);
    appState.assistant = getEffectiveAssistant();
    syncAssistantUi();
    closeAssistantMenu();
    syncQuickConfigMenuState();
    bootClippy();
  };

  const cycleAssistantChoice = () => {
    const currentValue = appState.assistantOverride || SERVER_ASSISTANT_OPTION;
    const currentIndex = ASSISTANT_OPTIONS.findIndex(option => option.value === currentValue);
    const nextIndex = currentIndex === -1
      ? 0
      : (currentIndex + 1) % ASSISTANT_OPTIONS.length;
    applyAssistantChoice(ASSISTANT_OPTIONS[nextIndex].value);
  };

  const setQuickConfigOpen = nextOpenState => {
    if (!quickConfig || !themeToggle || !quickConfigBody) {
      return;
    }

    quickConfigOpen = Boolean(nextOpenState);
    window.clearTimeout(quickConfigCloseTimer);

    if (quickConfigOpen) {
      quickConfigBody.hidden = false;
      measureQuickConfigOpenHeight();
      quickConfig.classList.add('is-open');
      scheduleQuickConfigHeightSync();
    } else {
      closeThemeFamilyMenu();
      closeAssistantMenu();
      quickConfig.classList.remove('is-open');
      quickConfigCloseTimer = window.setTimeout(() => {
        if (!quickConfigOpen) {
          quickConfigBody.hidden = true;
        }
      }, 360);
    }

    themeToggle.setAttribute('aria-expanded', String(quickConfigOpen));
  };

  const applyTheme = ({ appearance = appState.appearance, themeFamily = appState.themeFamily } = {}) => {
    appState.appearance = appearance === 'light' ? 'light' : 'dark';
    appState.themeFamily = hasThemeFamilyOption(themeFamily)
      ? themeFamily
      : DEFAULT_THEME_FAMILY;

    if (appState.appearance === 'dark') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
    }

    if (appState.themeFamily === DEFAULT_THEME_FAMILY) {
      document.documentElement.removeAttribute('data-theme-family');
    } else {
      document.documentElement.setAttribute('data-theme-family', appState.themeFamily);
    }

    if (themeToggle) {
      themeToggle.setAttribute('aria-label', 'Open quick config');
      themeToggle.setAttribute('title', 'Open quick config');
    }

    syncThemeUi();
    syncAssistantUi();
    scheduleQuickConfigHeightSync();
  };

  const applyThemeFamilyChoice = themeFamily => {
    const normalizedValue = hasThemeFamilyOption(themeFamily)
      ? themeFamily
      : DEFAULT_THEME_FAMILY;
    window.localStorage.setItem(THEME_FAMILY_STORAGE_KEY, normalizedValue);
    applyTheme({ themeFamily: normalizedValue });
    closeThemeFamilyMenu();
    syncQuickConfigMenuState();
  };

  const cycleThemeFamilyChoice = () => {
    const availableThemes = getThemeFamilyOptions();
    const currentIndex = availableThemes.findIndex(option => option.value === appState.themeFamily);
    const nextIndex = currentIndex === -1
      ? 0
      : (currentIndex + 1) % availableThemes.length;
    applyThemeFamilyChoice(availableThemes[nextIndex].value);
  };

  const bootTheme = async () => {
    try {
      await loadThemeFamilies();
    } catch (error) {
      console.error('Could not load theme registry.', error);
      themeFamilyOptions = [DEFAULT_THEME_OPTION];
    }

    applyTheme({
      appearance: appState.appearance,
      themeFamily: appState.themeFamily,
    });

    window.addEventListener('printify-quick-config-updated', scheduleQuickConfigHeightSync);

    themeToggle?.addEventListener('click', () => {
      setQuickConfigOpen(!quickConfigOpen);
    });

    quickConfigThemeToggle?.addEventListener('click', () => {
      const nextAppearance = appState.appearance === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, nextAppearance);
      applyTheme({ appearance: nextAppearance });
    });

    quickConfigThemeFamilyButton?.addEventListener('click', () => {
      cycleThemeFamilyChoice();
    });

    quickConfigThemeFamilyButton?.addEventListener('contextmenu', event => {
      event.preventDefault();
      if (!quickConfigOpen) {
        setQuickConfigOpen(true);
      }
      toggleThemeFamilyMenu();
    });

    quickConfigThemeFamilyMenu?.addEventListener('click', event => {
      const optionButton = event.target.closest('[data-theme-family-value]');
      if (!optionButton) {
        return;
      }

      applyThemeFamilyChoice(optionButton.getAttribute('data-theme-family-value'));
    });

    quickConfigAssistantButton?.addEventListener('click', () => {
      cycleAssistantChoice();
    });

    quickConfigAssistantButton?.addEventListener('contextmenu', event => {
      event.preventDefault();
      if (!quickConfigOpen) {
        setQuickConfigOpen(true);
      }
      toggleAssistantMenu();
    });

    quickConfigAssistantMenu?.addEventListener('click', event => {
      const optionButton = event.target.closest('[data-assistant-value]');
      if (!optionButton) {
        return;
      }

      applyAssistantChoice(optionButton.getAttribute('data-assistant-value'));
    });

    document.addEventListener('click', event => {
      if (themeFamilyMenuOpen && quickConfigThemeFamilyMenu && !quickConfigThemeFamilyMenu.contains(event.target) && event.target !== quickConfigThemeFamilyButton) {
        closeThemeFamilyMenu();
        syncQuickConfigMenuState();
      }

      if (assistantMenuOpen && quickConfigAssistantMenu && !quickConfigAssistantMenu.contains(event.target) && event.target !== quickConfigAssistantButton) {
        closeAssistantMenu();
        syncQuickConfigMenuState();
      }

      if (!quickConfigOpen || !quickConfig) {
        return;
      }

      if (quickConfig.contains(event.target)) {
        return;
      }

      setQuickConfigOpen(false);
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && themeFamilyMenuOpen) {
        closeThemeFamilyMenu();
        syncQuickConfigMenuState();
        return;
      }

      if (event.key === 'Escape' && assistantMenuOpen) {
        closeAssistantMenu();
        syncQuickConfigMenuState();
        return;
      }

      if (event.key === 'Escape' && quickConfigOpen) {
        setQuickConfigOpen(false);
      }
    });
  };

  // ╭──────────────────────────╮
  // │  Server bootstrap        │
  // ╰──────────────────────────╯
  const syncPrinterStatBadges = () => {
    Array.from(printerGrid?.querySelectorAll('[data-role="printer-card"]') || []).forEach(card => {
      const printerId = card.getAttribute('data-printer-id');
      const printer = getPrinterById(printerId);
      const pageTotal = card.querySelector('.printer-card__page-total');

      if (!printer) return;

      const statusEl = card.querySelector('[data-role="printer-status"]');
      if (statusEl) {
        const offline = printer.online === false;
        statusEl.classList.toggle('is-offline', offline);
        statusEl.classList.toggle('is-online', !offline);
        statusEl.setAttribute('title', offline
          ? 'Printer not detected or not responding'
          : 'Printer detected and ready');
        const statusLabel = statusEl.querySelector('.printer-card__status-label');
        if (statusLabel) statusLabel.textContent = offline ? 'Offline' : 'Online';
      }

      if (!pageTotal) return;

      const displayCount = getPrinterDisplayPageCount(printer);

      pageTotal.innerHTML = buildPrinterCounterMarkup(displayCount);
      pageTotal.setAttribute('aria-label', `Successful pages printed: ${formatWholeNumber(displayCount)}`);
      pageTotal.setAttribute('title', buildPrinterCounterTooltip(printer));
    });
  };

  const applyServerData = (serverData, { updateFooter = false, patchPrinterStats = false } = {}) => {
    if (!serverData || typeof serverData !== 'object') {
      return;
    }

    appState.serverVersion = serverData.version;
    appState.pageHits = serverData.pageHits;
    appState.printCounter = serverData.printCounter;
    appState.exactPrintCounter = Number.isFinite(serverData.exactPrintCounter)
      ? serverData.exactPrintCounter
      : serverData.printCounter;
    appState.pageCounter = Number.isFinite(serverData.pageCounter) ? serverData.pageCounter : 0;
    appState.actualPrintCounter = Number.isFinite(serverData.actualPrintCounter) ? serverData.actualPrintCounter : 0;
    appState.actualPageCounter = Number.isFinite(serverData.actualPageCounter) ? serverData.actualPageCounter : 0;
    appState.testingPrintCounter = Number.isFinite(serverData.testingPrintCounter) ? serverData.testingPrintCounter : 0;
    appState.testingPageCounter = Number.isFinite(serverData.testingPageCounter) ? serverData.testingPageCounter : 0;
    appState.paperAreaSquareMm = Number.isFinite(serverData.paperAreaSquareMm) ? serverData.paperAreaSquareMm : 0;
    appState.actualPaperAreaSquareMm = Number.isFinite(serverData.actualPaperAreaSquareMm) ? serverData.actualPaperAreaSquareMm : 0;
    appState.testingPaperAreaSquareMm = Number.isFinite(serverData.testingPaperAreaSquareMm) ? serverData.testingPaperAreaSquareMm : 0;
    appState.serverDataVersion = serverData.dataVersion || 'Unknown';
    appState.testing = Boolean(serverData.testing);
    appState.lastStartedAt = serverData.lastStartedAt || null;
    appState.lastPrintAt = serverData.lastPrintAt || null;
    appState.lastPrintJob = serverData.lastPrintJob || null;
    appState.dailyStats = serverData.dailyStats || {};
    appState.serverAssistant = serverData.assistant || DEFAULT_ASSISTANT;
    appState.assistant = getEffectiveAssistant();
    appState.activeJobs = Array.isArray(serverData.activeJobs) ? serverData.activeJobs : appState.activeJobs;
    syncAssistantUi();

    if (patchPrinterStats && serverData.printers && appState.printers.length) {
      appState.printers = appState.printers.map(printer => ({
        ...printer,
        ...(serverData.printers[printer.id] || {}),
      }));
      syncPrinterStatBadges();
    }

    if (updateFooter) {
      footerDrawer?.setVersionText?.(APP_VERSION, serverData.version);
    }

    appState.confirmSystem?.syncJobs?.(appState.activeJobs);
  };

  const loadVersion = options => fetch('/version')
    .then(response => response.json())
    .then(serverData => {
      applyServerData(serverData, options);
      return serverData;
    });

  const loadPrinters = ({ preserveExisting = false } = {}) => fetch('/printers')
    .then(response => response.json())
    .then(payload => {
      appState.printers = payload.printers || [];
      renderPrinters(appState.printers, { preserveExisting });
    });

  const loadClientPlugins = () => fetch('/client-plugins')
    .then(response => response.json())
    .then(payload => {
      const plugins = Array.isArray(payload?.plugins) ? payload.plugins : [];

      appState.clientPluginsById = plugins.reduce((pluginMap, pluginConfig) => {
        if (pluginConfig?.id) {
          pluginMap[pluginConfig.id] = pluginConfig;
        }

        return pluginMap;
      }, {});

      syncClientPluginTriggers();
    });

  const refreshServerState = () => loadVersion({ patchPrinterStats: true });
  const refreshPrinterState = () => loadPrinters({ preserveExisting: true })
    .then(() => loadVersion({ patchPrinterStats: true }));
  const queueServerStateRefresh = () => {
    if (appState.statsRefreshTimer) {
      window.clearTimeout(appState.statsRefreshTimer);
    }

    appState.statsRefreshTimer = window.setTimeout(() => {
      appState.statsRefreshTimer = null;
      refreshServerState().catch(() => {});
    }, 350);
  };
  const queuePrinterStateRefresh = () => {
    if (appState.statsRefreshTimer) {
      window.clearTimeout(appState.statsRefreshTimer);
    }

    appState.statsRefreshTimer = window.setTimeout(() => {
      appState.statsRefreshTimer = null;
      refreshPrinterState().catch(() => {});
    }, 350);
  };

  // ╭──────────────────────────╮
  // │  Printer rendering       │
  // ╰──────────────────────────╯
  const buildAcceptValue = acceptedKinds => {
    const accepts = [];

    if (acceptedKinds.includes('pdf')) accepts.push('.pdf,application/pdf');
    if (acceptedKinds.includes('image')) accepts.push('image/png,image/jpeg,image/jpg,image/tiff,image/webp,.png,.jpg,.jpeg,.tif,.tiff,.webp');
    if (acceptedKinds.includes('zip')) accepts.push('.zip,application/zip,application/x-zip,application/x-zip-compressed,application/octet-stream');

    return accepts.join(',');
  };

  const buildPrinterStatusMarkup = printer => {
    const offline = printer.online === false;
    const label = offline ? 'Offline' : 'Online';
    const title = offline
      ? 'Printer not detected or not responding'
      : 'Printer detected and ready';

    return `
      <span class="printer-card__status ${offline ? 'is-offline' : 'is-online'}" data-role="printer-status" title="${title}">
        <span class="printer-card__status-dot" aria-hidden="true"></span>
        <span class="printer-card__status-label">${label}</span>
      </span>
    `;
  };

  const buildPrinterCardInnerMarkup = printer => `
    <div class="printer-card__overlay" aria-hidden="true"></div>
    <div class="printer-card__file-count" data-role="file-count" style="--printer-file-count-ratio:${getPrinterPaperRatio(printer)};" aria-hidden="true">
      <span class="printer-card__file-count-text">
        <span class="printer-card__file-count-number">1</span>
      </span>
    </div>
    <div class="printer-card__header">
      <p class="printer-card__name">${escapeHtml(printer.displayName)}</p>
      ${buildPrinterStatusMarkup(printer)}
    </div>
    <div class="printer-card__body">
      <img class="printer-card__icon" src="${printer.iconUrl || '/favicon.ico'}" alt="${escapeHtml(printer.displayName)}">
      <p class="printer-card__page-total" aria-label="Successful pages printed: ${escapeHtml(formatWholeNumber(getPrinterDisplayPageCount(printer)))}" title="${escapeHtml(buildPrinterCounterTooltip(printer))}">${buildPrinterCounterMarkup(getPrinterDisplayPageCount(printer))}</p>
    </div>
    <div class="printer-card__details">
      <div class="printer-card__kind-bubbles">
        ${(printer.acceptedKinds || []).map(fileKind => `
          <span class="printer-card__kind-bubble ${getFileKindToneClass(fileKind)}">${escapeHtml(PRINTIFY_FILE_KINDS[fileKind]?.label || fileKind.toUpperCase())}</span>
        `).join('')}
      </div>
      <div class="printer-card__actions">
        <span class="printify-builder__tooltip-wrap printer-card__tooltip-wrap printer-card__tooltip-wrap--primary">
          <button class="printer-card__button printer-card__button--primary" type="button" data-role="choose-files" data-printer-id="${printer.id}">Choose Files</button>
          <span class="printify-builder__tooltip printer-card__tooltip" role="tooltip">You can also drag files directly to this card.</span>
        </span>
        ${printer.labelBuilder ? `<button class="printer-card__button printer-card__button--secondary" type="button" data-role="label-builder" data-printer-id="${printer.id}">Label Builder</button>` : ''}
      </div>
    </div>
    <input class="printer-card__file-input" data-role="file-input" data-printer-id="${printer.id}" type="file" multiple accept="${buildAcceptValue(printer.acceptedKinds || [])}">
  `;

  const buildPrinterCardMarkup = (printer, index) => `
    <article
      class="printer-card${appState.openPrinterId === printer.id ? ' is-open' : ''}"
      data-role="printer-card"
      data-printer-id="${printer.id}"
      style="--card-index:${index};"
      role="button"
      tabindex="0"
      aria-expanded="${appState.openPrinterId === printer.id ? 'true' : 'false'}"
    >
      ${buildPrinterCardInnerMarkup(printer)}
    </article>
  `;

  const syncPrinterCard = (card, printer, index) => {
    const isOpen = appState.openPrinterId === printer.id;
    const preservedClasses = {
      highlighted: card.classList.contains('is-highlighted'),
      invalid: card.classList.contains('is-drop-invalid'),
      clearing: card.classList.contains('is-drop-clearing'),
      entering: card.classList.contains('is-entering'),
      removing: card.classList.contains('is-removing'),
    };

    card.setAttribute('data-printer-id', printer.id);
    card.setAttribute('style', `--card-index:${index};`);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-expanded', String(isOpen));
    card.classList.toggle('is-open', isOpen);
    card.innerHTML = buildPrinterCardInnerMarkup(printer);
    card.classList.toggle('is-highlighted', preservedClasses.highlighted);
    card.classList.toggle('is-drop-invalid', preservedClasses.invalid);
    card.classList.toggle('is-drop-clearing', preservedClasses.clearing);
    card.classList.toggle('is-entering', preservedClasses.entering);
    card.classList.toggle('is-removing', preservedClasses.removing);
  };

  const getPrinterUploadOptions = printerId => {
    const printerOptions = appState.printerOptionState?.[printerId] || {};

    return {
      invertPrint: printerOptions.invertPrint ? '1' : null,
    };
  };

  const createPrinterCardElement = (printer, index, { instant = false } = {}) => {
    const template = document.createElement('template');
    template.innerHTML = buildPrinterCardMarkup(printer, index).trim();
    const card = template.content.firstElementChild;

    if (instant) {
      card.classList.add('printer-card--instant', 'is-entering');
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          card.classList.remove('is-entering');
        });
      });
    }

    return card;
  };

  const animatePrinterCardRemoval = card => {
    if (!card?.isConnected) return;

    const rect = card.getBoundingClientRect();
    const placeholder = document.createElement('div');
    placeholder.className = 'printer-card printer-card--placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.style.height = `${rect.height}px`;
    card.replaceWith(placeholder);

    card.classList.add('printer-card--instant', 'printer-card--ghost');
    card.classList.remove('is-open', 'is-highlighted', 'is-drop-invalid', 'is-drop-clearing', 'is-entering', 'is-removing');
    card.style.left = `${rect.left}px`;
    card.style.top = `${rect.top}px`;
    card.style.width = `${rect.width}px`;
    card.style.height = `${rect.height}px`;
    card.style.pointerEvents = 'none';
    document.body.appendChild(card);

    const removeGhost = () => {
      placeholder.remove();
      card.remove();
    };

    if (typeof card.animate === 'function') {
      const animation = card.animate(
        [
          {
            opacity: 1,
            transform: 'translateY(0) scale(1)',
            filter: 'blur(0) saturate(1)',
          },
          {
            opacity: 0,
            transform: 'translateY(-10px) scale(0.94)',
            filter: 'blur(6px) saturate(0.88)',
          },
        ],
        {
          duration: 180,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'forwards',
        }
      );

      animation.addEventListener('finish', removeGhost, { once: true });
      animation.addEventListener('cancel', removeGhost, { once: true });
      return;
    }

    card.getBoundingClientRect();

    window.requestAnimationFrame(() => {
      card.classList.add('is-removing');
    });

    window.setTimeout(removeGhost, 190);
  };

  const renderPrinters = (printers, { preserveExisting = false } = {}) => {
    if (appState.openPrinterId && !printers.some(printer => printer.id === appState.openPrinterId)) {
      appState.openPrinterId = null;
    }

    if (!printers.length) {
      printerGrid.innerHTML = `
        <article class="printer-card printer-card--empty">
          <p class="printer-card__empty-copy">No printers are configured on the server.</p>
        </article>
      `;
      return;
    }

    if (!preserveExisting) {
      printerGrid.innerHTML = printers.map((printer, index) => buildPrinterCardMarkup(printer, index)).join('');
      window.requestAnimationFrame(() => {
        updatePrinterGridVerticalOffset();
      });
      return;
    }

    const existingCards = new Map(
      Array.from(printerGrid.querySelectorAll('[data-role="printer-card"]'))
        .map(card => [card.getAttribute('data-printer-id'), card])
    );
    const nextPrinterIds = new Set(printers.map(printer => printer.id));

    printerGrid.querySelector('.printer-card--empty')?.remove();

    existingCards.forEach((card, printerId) => {
      if (nextPrinterIds.has(printerId)) {
        return;
      }

      resetCardDragState(card);
      animatePrinterCardRemoval(card);
      existingCards.delete(printerId);
    });

    let insertionCursor = printerGrid.firstElementChild;

    printers.forEach((printer, index) => {
      const existingCard = existingCards.get(printer.id);

      if (existingCard) {
        syncPrinterCard(existingCard, printer, index);
        if (existingCard !== insertionCursor) {
          printerGrid.insertBefore(existingCard, insertionCursor);
        }
        existingCards.delete(printer.id);
        insertionCursor = existingCard.nextElementSibling;
        return;
      }

      const nextCard = createPrinterCardElement(printer, index, { instant: true });
      printerGrid.insertBefore(nextCard, insertionCursor);
      insertionCursor = nextCard.nextElementSibling;
    });

    window.requestAnimationFrame(() => {
      updatePrinterGridVerticalOffset();
    });
  };

  const updatePrinterGridVerticalOffset = () => {
    if (!appShell || !printerGrid) return;

    const cards = Array.from(printerGrid.querySelectorAll('[data-role="printer-card"]'));
    if (!cards.length) {
      appShell.style.setProperty('--printify-app-top-pad', '88px');
      return;
    }

    const gridHeight = Math.ceil(printerGrid.getBoundingClientRect().height);
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const nextTopPad = Math.max(88, Math.floor((viewportHeight - gridHeight) / 2));
    appShell.style.setProperty('--printify-app-top-pad', `${nextTopPad}px`);
  };

  // ╭──────────────────────────╮
  // │  Upload routing          │
  // ╰──────────────────────────╯
  const detectFileKind = file => {
    const mimeType = String(file.type || '').toLowerCase();
    const extension = getFileExtension(file.name);

    if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf';
    if (IMAGE_MIME_TYPES.has(mimeType) || IMAGE_EXTENSIONS.has(extension)) return 'image';
    if (ZIP_MIME_TYPES.has(mimeType) || ZIP_EXTENSIONS.has(extension)) return 'zip';

    return null;
  };

  const loadImageDimensions = file => new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not read dimensions for ${file.name}`));
    };

    image.src = objectUrl;
  });

  const loadPdfDimensions = async (file, printerDensity) => {
    if (!window.pdfjsLib) return null;

    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/scripts/vendor/pdf-2.16.105.worker.min.js';
    }

    const pdfBytes = await file.arrayBuffer();
    const pdfDocument = await window.pdfjsLib.getDocument({ data: pdfBytes }).promise;
    const firstPage = await pdfDocument.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1 });
    const density = Number.parseInt(printerDensity || '72', 10) || 72;

    return {
      width: (viewport.width * density) / 72,
      height: (viewport.height * density) / 72,
    };
  };

  const getTapeUploadMeta = async (printer, file) => {
    if (!printer?.isTape) {
      return {};
    }

    const density = Number.parseFloat(printer.density);

    if (!Number.isFinite(density) || density <= 0) {
      return {};
    }

    const fileKind = detectFileKind(file);
    let dimensions = null;

    if (fileKind === 'image') {
      dimensions = await loadImageDimensions(file);
    } else if (fileKind === 'pdf') {
      dimensions = await loadPdfDimensions(file, density);
    }

    if (!dimensions) {
      return {};
    }

    const widthMm = (dimensions.width / density) * 25.4;
    const heightMm = (dimensions.height / density) * 25.4;
    const shorterSideMm = Math.min(widthMm, heightMm);
    const longerSideMm = Math.max(widthMm, heightMm);

    if (!Number.isFinite(shorterSideMm) || !Number.isFinite(longerSideMm) || shorterSideMm <= 0 || longerSideMm <= 0) {
      return {};
    }

    return {
      tapeWidthMm: Math.round(shorterSideMm),
      lengthMm: Math.round(longerSideMm),
    };
  };

  const getAreaFillFractionForFit = (dimensions, target) => {
    if (
      !dimensions?.width
      || !dimensions?.height
      || !target?.width
      || !target?.height
    ) {
      return 1;
    }

    const sourceRatio = dimensions.width / dimensions.height;
    const targetRatio = target.width / target.height;

    if (!Number.isFinite(sourceRatio) || !Number.isFinite(targetRatio) || sourceRatio <= 0 || targetRatio <= 0) {
      return 1;
    }

    return Math.min(sourceRatio / targetRatio, targetRatio / sourceRatio);
  };

  const getBestAspectRatioWarning = (dimensions, target) => {
    const directAreaFraction = getAreaFillFractionForFit(dimensions, target);
    const rotatedAreaFraction = getAreaFillFractionForFit(dimensions, {
      width: target.height,
      height: target.width,
    });
    const bestAreaFraction = Math.max(directAreaFraction, rotatedAreaFraction);

    return {
      printableAreaFraction: bestAreaFraction,
      printableAreaLoss: 1 - bestAreaFraction,
    };
  };

  const buildOversizeWarnings = async (printer, files) => {
    const targetSize = getPrinterTargetSize(printer);
    if (!targetSize) return [];

    const warnings = [];

    for (const file of files) {
      const fileKind = detectFileKind(file);
      if (!fileKind || fileKind === 'zip') continue;

      try {
        let dimensions = null;

        if (fileKind === 'image') {
          dimensions = await loadImageDimensions(file);
        }

        if (fileKind === 'pdf') {
          dimensions = await loadPdfDimensions(file, printer.density);
        }

        if (!dimensions) continue;

        const aspectRatioWarning = getBestAspectRatioWarning(dimensions, targetSize);

        if (aspectRatioWarning.printableAreaFraction <= ASPECT_RATIO_WARNING_MIN_AREA_FRACTION) {
          warnings.push({
            fileName: file.name,
            dimensions,
            targetSize,
            printableAreaFraction: aspectRatioWarning.printableAreaFraction,
            printableAreaLoss: aspectRatioWarning.printableAreaLoss,
          });
        }
      } catch (error) {
        console.warn(error);
      }
    }

    return warnings;
  };

  const confirmOversizeFiles = async (printer, files) => {
    const warnings = await buildOversizeWarnings(printer, files);
    if (!warnings.length) return true;

    const largestWarning = warnings.reduce((currentLargest, warning) => (
      !currentLargest || warning.printableAreaLoss > currentLargest.printableAreaLoss
        ? warning
        : currentLargest
    ), null);

    const extraWarningCount = warnings.length - 1;
    const printableAreaLossPercent = formatPercent(largestWarning.printableAreaLoss * 100);
    const warningMessage = [
      `Aspect ratio mismatch would shrink the printed content area by about ${printableAreaLossPercent}% on ${printer.displayName} (${formatPixels(largestWarning.dimensions)} vs ${formatPixels(largestWarning.targetSize)}).`,
      extraWarningCount > 0 ? `${extraWarningCount} more file${extraWarningCount === 1 ? '' : 's'} would also lose significant printable area.` : null,
      '',
      'Print anyway?',
    ].filter(Boolean).join('\n');

    return showPromptCard({
      tone: 'warning',
      eyebrow: '🚨 Warning',
      title: 'Print Aspect Ratio Mismatch',
      message: warningMessage,
      confirmLabel: 'Send It',
      cancelLabel: 'Cancel',
    });
  };

  const groupFilesByKind = (printer, files) => {
    const groupedFiles = {
      pdf: [],
      image: [],
      zip: [],
    };
    const unsupportedFiles = [];

    Array.from(files).forEach(file => {
      const fileKind = detectFileKind(file);

      if (!fileKind || !(printer.acceptedKinds || []).includes(fileKind)) {
        unsupportedFiles.push(file.name);
        return;
      }

      groupedFiles[fileKind].push(file);
    });

    if (unsupportedFiles.length) {
      throw new Error(`Unsupported for ${printer.displayName}: ${unsupportedFiles.join(', ')}`);
    }

    return Object.fromEntries(
      Object.entries(groupedFiles).filter(([, grouped]) => grouped.length > 0)
    );
  };

  const readDuplicateWhitelist = () => {
    try {
      const rawValue = window.localStorage.getItem(DUPLICATE_WHITELIST_STORAGE_KEY);
      const now = Date.now();
      const parsedValue = JSON.parse(rawValue || '[]');
      const parsedEntries = Array.isArray(parsedValue) ? parsedValue : [];
      const activeEntries = parsedEntries.filter(entry => (
        entry
        && typeof entry.checksum === 'string'
        && Number.isFinite(entry.expiresAt)
        && entry.expiresAt > now
      ));

      if (activeEntries.length !== parsedEntries.length) {
        window.localStorage.setItem(DUPLICATE_WHITELIST_STORAGE_KEY, JSON.stringify(activeEntries));
      }

      return activeEntries;
    } catch (error) {
      window.localStorage.removeItem(DUPLICATE_WHITELIST_STORAGE_KEY);
      return [];
    }
  };

  const writeDuplicateWhitelist = entries => {
    window.localStorage.setItem(DUPLICATE_WHITELIST_STORAGE_KEY, JSON.stringify(entries));
  };

  const whitelistDuplicateChecksum = checksum => {
    if (!checksum) return;

    const now = Date.now();
    const nextEntries = readDuplicateWhitelist()
      .filter(entry => entry.checksum !== checksum);

    nextEntries.push({
      checksum,
      expiresAt: now + DUPLICATE_WHITELIST_DURATION_MS,
    });

    writeDuplicateWhitelist(nextEntries);
  };

  const isDuplicateChecksumWhitelisted = checksum => (
    readDuplicateWhitelist().some(entry => entry.checksum === checksum)
  );

  const resolvePendingDuplicates = async (printer, uploadResult) => {
    if (!uploadResult?.needsConfirmation || !uploadResult.sessionId) {
      return uploadResult;
    }

    const duplicates = Array.isArray(uploadResult.duplicates) ? uploadResult.duplicates : [];
    const duplicatePromptGroups = new Map();
    const approvedItemIds = [];

    duplicates.forEach(duplicate => {
      const isZipDuplicate = duplicate?.sourceType === 'upload-zip-pdf';
      const groupKey = isZipDuplicate
        ? `zip:${duplicate.uploadGroupId || duplicate.sourceArchiveName || duplicate.id}`
        : `file:${duplicate.checksum || duplicate.id}`;
      const groupedDuplicates = duplicatePromptGroups.get(groupKey) || [];
      groupedDuplicates.push(duplicate);
      duplicatePromptGroups.set(groupKey, groupedDuplicates);
    });

    for (const groupedDuplicates of duplicatePromptGroups.values()) {
      const sampleDuplicate = groupedDuplicates[0];
      const isZipDuplicate = sampleDuplicate?.sourceType === 'upload-zip-pdf';
      const duplicateCount = groupedDuplicates.length;

      if (!isZipDuplicate && sampleDuplicate.checksum && isDuplicateChecksumWhitelisted(sampleDuplicate.checksum)) {
        groupedDuplicates.forEach(duplicate => {
          approvedItemIds.push(duplicate.id);
        });
        continue;
      }

      const accepted = await showPromptCard({
        tone: 'warning',
        eyebrow: 'Recent Match',
        title: isZipDuplicate ? 'Duplicate ZIP Contents Detected' : 'Duplicate Detected',
        message: pickRandomPrompt(),
        subtext: isZipDuplicate
          ? `Matched ${duplicateCount} ${duplicateCount === 1 ? 'PDF' : 'PDFs'} from ${sampleDuplicate.sourceArchiveName || 'this ZIP'} on ${printer.displayName}. Approving sends the full duplicate set from that ZIP upload.`
          : `Matched ${sampleDuplicate.originalFilename} on ${printer.displayName}. Approving it suppresses repeat warnings for 24 hours in this browser.`,
        confirmLabel: 'Send It',
        cancelLabel: 'Cancel',
      });

      if (!accepted) {
        continue;
      }

      if (!isZipDuplicate && sampleDuplicate.checksum) {
        whitelistDuplicateChecksum(sampleDuplicate.checksum);
      }

      groupedDuplicates.forEach(duplicate => {
        approvedItemIds.push(duplicate.id);
      });
    }

    const response = await fetch(`/ingest/${encodeURIComponent(uploadResult.sessionId)}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        approvedItemIds,
      }),
    });

    if (!response.ok) {
      throw new Error(`Duplicate confirmation failed for ${printer.displayName}`);
    }

    const confirmedResult = await response.json();

    return {
      ...uploadResult,
      printedCount: Number(uploadResult.printedCount || 0) + Number(confirmedResult.printedCount || 0),
      skippedCount: Number(uploadResult.skippedCount || 0) + Number(confirmedResult.skippedCount || 0),
      skippedDuplicates: [
        ...(Array.isArray(uploadResult.skippedDuplicates) ? uploadResult.skippedDuplicates : []),
        ...(Array.isArray(confirmedResult.skippedDuplicates) ? confirmedResult.skippedDuplicates : []),
      ],
      needsConfirmation: false,
      duplicates: [],
    };
  };

  const uploadGroupedFiles = async (printer, groupedFiles, extraFields = {}) => {
    const groupEntries = Object.entries(groupedFiles);
    const uploadJobs = [];

    if (!groupEntries.length) {
      throw new Error('No valid files were supplied.');
    }

    for (const [fileKind, files] of groupEntries) {
      files.forEach(file => {
        const clientJobId = createClientJobId();
        uploadJobs.push({
          fileKind,
          file,
          clientJobId,
          indicator: appState.confirmSystem?.createIndicator(printer.id, {
            id: clientJobId,
            state: 'uploading',
            progress: 0.02,
          }) || {
            setProgress() {},
            setState() {},
            settle() {},
          },
        });
        debugIdLog('indicator created', `printer=${printer.id}`, `clientJobId=${clientJobId}`, `file=${file.name}`);
      });
    }

    const settledUploads = await Promise.allSettled(uploadJobs.map(async ({ fileKind, file, indicator, clientJobId }) => {
      const routePath = `/${printer.id}/${fileKind}`;
      const formData = new FormData();
      const uploadFields = {
        ...(await getTapeUploadMeta(printer, file)),
        ...getPrinterUploadOptions(printer.id),
        ...extraFields,
      };

      formData.append(PRINTIFY_FILE_KINDS[fileKind].fieldName, file, file.name);
      formData.append('clientJobId', clientJobId);
      debugIdLog('upload start', `printer=${printer.id}`, `route=${routePath}`, `clientJobId=${clientJobId}`, `file=${file.name}`);

      Object.entries(uploadFields).forEach(([fieldName, fieldValue]) => {
        if (fieldValue !== null && fieldValue !== undefined && fieldValue !== '') {
          formData.append(fieldName, fieldValue);
        }
      });

      try {
        const uploadResult = await uploadFormDataWithProgress({
          routePath,
          formData,
          onProgress: progress => indicator.setProgress(Math.max(0.02, progress * 0.28)),
        });
        const resolvedResult = await resolvePendingDuplicates(printer, uploadResult);
        debugIdLog(
          'upload success',
          `printer=${printer.id}`,
          `clientJobId=${clientJobId}`,
          `printed=${Number(resolvedResult?.printedCount || 0)}`,
          `needsConfirmation=${Boolean(resolvedResult?.needsConfirmation)}`
        );
        indicator.settle('success');
        return resolvedResult;
      } catch (error) {
        debugIdLog('upload failed', `printer=${printer.id}`, `clientJobId=${clientJobId}`, error.message);
        indicator.settle('error');
        throw new Error(`${printer.displayName}: ${error.message}`);
      }
    }));

    const uploadResults = settledUploads
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);
    const uploadErrors = settledUploads
      .filter(result => result.status === 'rejected')
      .map(result => result.reason);

    if (uploadErrors.length) {
      const batchError = new Error(
        uploadErrors.length === 1
          ? uploadErrors[0].message
          : `${uploadErrors[0].message} (+${uploadErrors.length - 1} more)`
      );
      batchError.uploadResults = uploadResults;
      throw batchError;
    }

    return uploadResults;
  };

  const handlePrinterFiles = async (printerId, files, extraFields = {}) => {
    const printer = getPrinterById(printerId);

    if (!printer) throw new Error(`Unknown printer: ${printerId}`);

    const shouldContinue = await confirmOversizeFiles(printer, files);
    if (!shouldContinue) return;

    const groupedFiles = groupFilesByKind(printer, files);
    let uploadResults = [];

    try {
      uploadResults = await uploadGroupedFiles(printer, groupedFiles, extraFields);
    } catch (error) {
      uploadResults = Array.isArray(error?.uploadResults) ? error.uploadResults : [];

      if (uploadResults.length) {
        await refreshServerState();
      }

      throw error;
    }

    await refreshServerState();
    const skippedCount = uploadResults.reduce((total, result) => (
      total + Number(result?.skippedCount || 0)
    ), 0);
    const printedCount = uploadResults.reduce((total, result) => (
      total + Number(result?.printedCount || 0)
    ), 0);

    if (printedCount && skippedCount) {
      showConfirm(`${printer.displayName}: ${printedCount} sent, ${skippedCount} duplicate skipped`);
      return;
    }

    if (printedCount) {
      showConfirm(`${printer.displayName} job sent`);
      return;
    }

    if (skippedCount) {
      showFeedback(`${printer.displayName}: duplicate skipped`);
      return;
    }

    showFeedback(`${printer.displayName}: no files sent`);
  };

  // ╭──────────────────────────╮
  // │  UI events               │
  // ╰──────────────────────────╯
  const clearCardDragReset = card => {
    if (!card?._dragResetTimer) return;
    window.clearTimeout(card._dragResetTimer);
    card._dragResetTimer = null;
  };

  const setCardFileCount = (card, fileCount) => {
    const badge = card?.querySelector('[data-role="file-count"]');
    const label = badge?.querySelector('.printer-card__file-count-number');

    if (!badge || !label || !Number.isFinite(fileCount) || fileCount <= 1) {
      if (badge) {
        badge.classList.remove('is-visible');
        badge.setAttribute('aria-hidden', 'true');
      }
      return;
    }

    label.textContent = String(fileCount);
    badge.classList.add('is-visible');
    badge.setAttribute('aria-hidden', 'false');
  };

  const setCardHighlight = (card, isHighlighted) => {
    if (!card) return;
    clearCardDragReset(card);
    const highlightMode = isHighlighted === true ? 'compatible' : isHighlighted;
    card.classList.remove('is-drop-clearing');
    card.classList.toggle('is-highlighted', Boolean(highlightMode));
    card.classList.toggle('is-drop-invalid', highlightMode === 'invalid');
  };

  const resetCardDragState = card => {
    if (!card) return;
    dragDepth.delete(card);
    setCardFileCount(card, 0);
    clearCardDragReset(card);

    const wasInvalid = card.classList.contains('is-drop-invalid');

    card.classList.remove('is-highlighted');

    if (!wasInvalid) {
      card.classList.remove('is-drop-invalid');
      card.classList.remove('is-drop-clearing');
      return;
    }

    card.classList.remove('is-drop-invalid');
    card.classList.add('is-drop-clearing');
    card._dragResetTimer = window.setTimeout(() => {
      card.classList.remove('is-drop-clearing');
      card._dragResetTimer = null;
    }, 180);
  };

  const playPrinterCardSettleAnimation = (card, mode) => {
    if (!card || typeof card.animate !== 'function') {
      return;
    }

    card._settleAnimation?.cancel?.();

    const keyframes = mode === 'open'
      ? [
        { transform: 'translateY(0) scale(1)' },
        { transform: 'translateY(-4px) scale(1.018)' },
        { transform: 'translateY(0) scale(1)' },
      ]
      : [
        { transform: 'translateY(0) scale(1)' },
        { transform: 'translateY(2px) scale(0.992)' },
        { transform: 'translateY(0) scale(1)' },
      ];

    const animation = card.animate(keyframes, {
      duration: mode === 'open' ? 340 : 280,
      easing: mode === 'open'
        ? 'cubic-bezier(0.2, 1.18, 0.24, 1)'
        : 'cubic-bezier(0.24, 0.92, 0.3, 1)',
      fill: 'none',
    });
    card._settleAnimation = animation;

    const clearAnimation = () => {
      if (card._settleAnimation === animation) {
        card._settleAnimation = null;
      }
    };

    animation.addEventListener('finish', clearAnimation, { once: true });
    animation.addEventListener('cancel', clearAnimation, { once: true });
  };

  const setOpenPrinter = printerId => {
    const previousPrinterId = appState.openPrinterId;
    appState.openPrinterId = printerId;
    printerGrid.querySelectorAll('[data-role="printer-card"]').forEach(card => {
      const cardPrinterId = card.getAttribute('data-printer-id');
      const wasOpen = cardPrinterId === previousPrinterId;
      const isOpen = cardPrinterId === printerId;
      card.classList.toggle('is-open', isOpen);
      card.setAttribute('aria-expanded', String(isOpen));

      if (isOpen && !wasOpen) {
        playPrinterCardSettleAnimation(card, 'open');
        return;
      }

      if (!isOpen && wasOpen) {
        playPrinterCardSettleAnimation(card, 'close');
      }
    });
  };

  const isFileDragEvent = event => {
    const transferTypes = event.dataTransfer?.types;

    if (!transferTypes) return false;

    return Array.from(transferTypes).includes('Files');
  };

  const detectDraggedFileKinds = event => {
    const dragItems = Array.from(event.dataTransfer?.items || []);
    const draggedFiles = Array.from(event.dataTransfer?.files || []);
    const detectedKinds = new Set();

    dragItems.forEach(item => {
      if (item.kind !== 'file') return;

      const mimeType = String(item.type || '').trim().toLowerCase();

      if (mimeType === 'application/pdf') {
        detectedKinds.add('pdf');
        return;
      }

      if (IMAGE_MIME_TYPES.has(mimeType)) {
        detectedKinds.add('image');
        return;
      }

      if (ZIP_MIME_TYPES.has(mimeType)) {
        detectedKinds.add('zip');
      }
    });

    draggedFiles.forEach(file => {
      const detectedKind = detectFileKind(file);
      if (detectedKind) detectedKinds.add(detectedKind);
    });

    return detectedKinds;
  };

  const detectDraggedFileCount = event => {
    const dragItems = Array.from(event.dataTransfer?.items || [])
      .filter(item => item.kind === 'file');

    if (dragItems.length) {
      return dragItems.length;
    }

    const draggedFiles = Array.from(event.dataTransfer?.files || []);
    return draggedFiles.length;
  };

  const getCardDragHighlightMode = (card, event) => {
    if (!card || !isFileDragEvent(event)) {
      return false;
    }

    const printer = getPrinterById(card.getAttribute('data-printer-id'));
    const draggedKinds = detectDraggedFileKinds(event);

    if (!printer || !draggedKinds.size) {
      return true;
    }

    const acceptsAllDraggedKinds = Array.from(draggedKinds).every(fileKind => (
      (printer.acceptedKinds || []).includes(fileKind)
    ));

    return acceptsAllDraggedKinds ? 'compatible' : 'invalid';
  };

  const closeLogDrawerForFileDrag = event => {
    if (!isFileDragEvent(event)) return;
    if (!appState.logDrawer || typeof appState.logDrawer.close !== 'function') return;
    appState.logDrawer.close();
  };

  const bindPrinterEvents = () => {
    document.addEventListener('dragenter', closeLogDrawerForFileDrag);

    printerGrid.addEventListener('click', event => {
      const chooseFilesButton = event.target.closest('[data-role="choose-files"]');
      if (chooseFilesButton) {
        event.stopPropagation();
        const input = printerGrid.querySelector(`[data-role="file-input"][data-printer-id="${chooseFilesButton.getAttribute('data-printer-id')}"]`);
        input?.click();
        return;
      }

      const labelBuilderButton = event.target.closest('[data-role="label-builder"]');
      if (labelBuilderButton) {
        event.stopPropagation();
        const printer = getPrinterById(labelBuilderButton.getAttribute('data-printer-id'));
        appState.labelBuilder?.open(printer);
        return;
      }

      const card = event.target.closest('[data-role="printer-card"]');
      if (!card) return;
      const printerId = card.getAttribute('data-printer-id');
      setOpenPrinter(appState.openPrinterId === printerId ? null : printerId);
    });

    printerGrid.addEventListener('contextmenu', event => {
      if (!event.target.closest('[data-role="printer-card"]')) return;
      event.preventDefault();
    });

    document.addEventListener('click', event => {
      if (!appState.openPrinterId) return;
      if (document.body.classList.contains('printify-client-overlay-open')) return;
      if (event.target.closest('[data-role="printer-card"]')) return;
      setOpenPrinter(null);
    });

    printerGrid.addEventListener('keydown', event => {
      const card = event.target.closest('[data-role="printer-card"]');
      if (!card) return;

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const printerId = card.getAttribute('data-printer-id');
        setOpenPrinter(appState.openPrinterId === printerId ? null : printerId);
      }
    });

    printerGrid.addEventListener('change', async event => {
      const input = event.target.closest('[data-role="file-input"]');
      if (!input || !input.files?.length) return;

      try {
        await handlePrinterFiles(input.getAttribute('data-printer-id'), Array.from(input.files));
      } catch (error) {
        showFeedback(error.message);
      } finally {
        input.value = '';
      }
    });

    printerGrid.addEventListener('dragenter', event => {
      const card = event.target.closest('[data-role="printer-card"]');
      if (!card) return;

      event.preventDefault();
      const nextDepth = (dragDepth.get(card) || 0) + 1;
      dragDepth.set(card, nextDepth);
      setCardFileCount(card, detectDraggedFileCount(event));
      setCardHighlight(card, getCardDragHighlightMode(card, event));
    });

    printerGrid.addEventListener('dragover', event => {
      const card = event.target.closest('[data-role="printer-card"]');
      if (!card) return;

      event.preventDefault();
      const highlightMode = getCardDragHighlightMode(card, event);
      setCardFileCount(card, detectDraggedFileCount(event));
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = highlightMode === 'invalid' ? 'none' : 'copy';
      }
      setCardHighlight(card, highlightMode);
    });

    printerGrid.addEventListener('dragleave', event => {
      const card = event.target.closest('[data-role="printer-card"]');
      if (!card) return;

      const nextDepth = Math.max((dragDepth.get(card) || 1) - 1, 0);

      if (nextDepth === 0) {
        resetCardDragState(card);
        return;
      }

      dragDepth.set(card, nextDepth);
    });

    printerGrid.addEventListener('drop', async event => {
      const card = event.target.closest('[data-role="printer-card"]');
      if (!card) return;

      event.preventDefault();
      closeLogDrawerForFileDrag(event);
      resetCardDragState(card);

      try {
        await handlePrinterFiles(
          card.getAttribute('data-printer-id'),
          Array.from(event.dataTransfer?.files || [])
        );
      } catch (error) {
        showFeedback(error.message);
      }
    });
  };

  // ╭──────────────────────────╮
  // │  Log drawer + Clippy     │
  // ╰──────────────────────────╯
  const bootLogDrawer = () => {
    if (typeof window.createPrintifyLogDrawer === 'function') {
      appState.logDrawer = window.createPrintifyLogDrawer(PRINTIFY_LOG_ROUTE);
    }
  };

  const bootStatsSocket = () => {
    if (!('WebSocket' in window)) return;

    const reconnectDelayMs = 2500;
    const connect = () => {
      if (
        appState.statsSocket
        && (
          appState.statsSocket.readyState === window.WebSocket.OPEN
          || appState.statsSocket.readyState === window.WebSocket.CONNECTING
        )
      ) {
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new window.WebSocket(`${protocol}//${window.location.host}/ws/logs`);
      appState.statsSocket = socket;

      socket.addEventListener('message', event => {
        let payload = null;

        try {
          payload = JSON.parse(event.data);
        } catch (error) {
          payload = null;
        }

        if (payload?.type === 'printers-updated') {
          queuePrinterStateRefresh();
          return;
        }

        if (payload?.type === 'job-queue-updated' || payload?.type === 'job-queue-sync') {
          appState.activeJobs = Array.isArray(payload.jobs) ? payload.jobs : [];
          debugIdLog(
            'job sync',
            `type=${payload.type}`,
            `count=${appState.activeJobs.length}`,
            appState.activeJobs.map(job => `${job.id}:${job.printerId}:${job.state}`).join(', ') || 'none'
          );
          appState.confirmSystem?.syncJobs?.(appState.activeJobs);
          return;
        }

        queueServerStateRefresh();
      });

      socket.addEventListener('close', () => {
        if (appState.statsSocket === socket) {
          appState.statsSocket = null;
        }

        if (appState.statsSocketReconnectTimer) return;

        appState.statsSocketReconnectTimer = window.setTimeout(() => {
          appState.statsSocketReconnectTimer = null;
          connect();
        }, reconnectDelayMs);
      });

      socket.addEventListener('error', () => {
        socket.close();
      });
    };

    connect();
  };

  const bootLabelBuilder = () => {
    if (typeof window.createPrintifyLabelBuilder !== 'function') return;

    appState.labelBuilder = window.createPrintifyLabelBuilder({
      onPrint: (printer, files, extraFields) => handlePrinterFiles(printer.id, files, extraFields),
      onError: error => showFeedback(error.message),
      getMonochromePreviewFields: printer => getPrinterUploadOptions(printer?.id),
      getInvertPrintEnabled: printerId => Boolean(appState.printerOptionState?.[printerId]?.invertPrint),
      getSavedFontFamily: printerId => appState.printerOptionState?.[printerId]?.fontFamily || '',
      setInvertPrintEnabled: (printerId, enabled) => {
        if (!printerId) return;
        appState.printerOptionState[printerId] = {
          ...(appState.printerOptionState[printerId] || {}),
          invertPrint: Boolean(enabled),
        };
        persistPrinterOptionState();
      },
      setSavedFontFamily: (printerId, fontFamily) => {
        if (!printerId) return;
        appState.printerOptionState[printerId] = {
          ...(appState.printerOptionState[printerId] || {}),
          fontFamily: String(fontFamily || '').trim() || 'Arial',
        };
        persistPrinterOptionState();
      },
      closeOnPrint: false,
    });
  };

  const loadClientPluginModule = async pluginConfig => {
    const scriptUrl = String(pluginConfig?.scriptUrl || '').trim();

    if (!scriptUrl) {
      throw new Error(`Client plugin "${pluginConfig?.id || 'unknown'}" is missing a script URL.`);
    }

    if (!appState.clientPluginModules[scriptUrl]) {
      appState.clientPluginModules[scriptUrl] = import(scriptUrl);
    }

    return appState.clientPluginModules[scriptUrl];
  };

  const activateClientPlugin = async pluginId => {
    const pluginConfig = appState.clientPluginsById[pluginId];

    if (!pluginConfig) {
      throw new Error(`Client plugin "${pluginId}" is not enabled.`);
    }

    const pluginModule = await loadClientPluginModule(pluginConfig);

    if (typeof pluginModule.activatePlugin !== 'function') {
      throw new Error(`Client plugin "${pluginId}" does not expose an activatePlugin() entry.`);
    }

    return pluginModule.activatePlugin(pluginConfig, {
      showFeedback,
      footerDrawer,
    });
  };

  const buildClientPluginCodeSteps = code => {
    return Array.from(String(code || '').trim())
      .map(character => ({
        keys: [character],
        display: character,
      }));
  };

  const syncClientPluginTriggers = () => {
    appState.clientPluginInputHandles.forEach(handle => handle?.unregister?.());
    appState.clientPluginInputHandles = [];

    if (!window.printifyInput?.registerSequence) {
      return;
    }

    Object.values(appState.clientPluginsById).forEach(pluginConfig => {
      const code = String(pluginConfig?.code || '').trim();
      const steps = buildClientPluginCodeSteps(code);

      if (!steps.length) {
        return;
      }

      const handle = window.printifyInput.registerSequence({
        id: `client-plugin-${pluginConfig.id}-code`,
        steps,
        timeoutMs: 1200,
        matchDelayMs: 60,
        cooldownMs: 320,
        disableOnMatch: true,
        onProgress: state => {
          window.printifyFooterDrawer?.setSequencePreview?.(state?.matchedSteps || []);
        },
        onMatch: async event => {
          event.preventDefault();
          window.printifyFooterDrawer?.setSequencePreview?.([]);

          try {
            await activateClientPlugin(pluginConfig.id);
          } catch (error) {
            showFeedback(error.message || 'Could not open client plugin.');
            console.error(error);
          }
        },
      });

      appState.clientPluginInputHandles.push(handle);
    });
  };

  const bindClientPluginTriggers = () => {
    if (appState.clientPluginInputHandles.length) {
      return;
    }

    syncClientPluginTriggers();
  };

  // ╭──────────────────────────╮
  // │  Boot sequence           │
  // ╰──────────────────────────╯
  const boot = async () => {
    await bootTheme();
    bindPrinterEvents();
    bindClientPluginTriggers();
    bootLogDrawer();
    bootLabelBuilder();
    bootStatsSocket();

    try {
      await Promise.all([
        loadVersion({ updateFooter: true }),
        loadPrinters(),
        loadClientPlugins(),
      ]);
      window.addEventListener('resize', updatePrinterGridVerticalOffset);
      bootClippy();
    } catch (error) {
      showFeedback('Could not load printer configuration from the server.');
      console.error(error);
    }
  };

  boot();
}());
