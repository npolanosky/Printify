// ╭──────────────────────────╮
// │  utils.js                │
// │  Numeric helpers, serial │
// │  token logic, and small  │
// │  browser utilities       │
// ╰──────────────────────────╯
(function () {
  const namespace = window.PrintifyLabelBuilder = window.PrintifyLabelBuilder || {};
  const constants = namespace.constants;

  // Keep these helpers framework-free so future builder modules can share
  // them without pulling in canvas/runtime concerns.
  const mmToPixels = (millimeters, density) => {
    const numericMillimeters = Number(millimeters);
    const numericDensity = Number(density);

    if (!Number.isFinite(numericMillimeters) || numericMillimeters <= 0 || !Number.isFinite(numericDensity) || numericDensity <= 0) {
      return null;
    }

    return Math.max(1, Math.round((numericMillimeters / 25.4) * numericDensity));
  };

  const normalizeTapeLengthMm = value => {
    const parsedValue = Number.parseInt(value, 10);
    return Number.isFinite(parsedValue) ? Math.max(constants.MIN_TAPE_LENGTH_MM, parsedValue) : constants.DEFAULT_TAPE_LENGTH_MM;
  };

  const getResolvedDefaultTapeWidth = printer => {
    const configuredTapes = Array.isArray(printer?.tapes) ? printer.tapes : [];
    const preferredTape = Number.parseInt(printer?.lastTapeWidthMm, 10);
    const defaultTape = Number.parseInt(printer?.defaultTape, 10);

    if (configuredTapes.includes(preferredTape)) {
      return preferredTape;
    }

    if (configuredTapes.includes(defaultTape)) {
      return defaultTape;
    }

    return configuredTapes[0] || null;
  };

  const getPrinterCanvasSize = printer => {
    if (printer?.isTape) {
      const tapeWidthMm = getResolvedDefaultTapeWidth(printer) || 12;
      const tapeHeightPx = mmToPixels(tapeWidthMm, printer?.density);
      const tapeLengthPx = mmToPixels(constants.DEFAULT_TAPE_LENGTH_MM, printer?.density);

      if (Number.isFinite(tapeHeightPx) && Number.isFinite(tapeLengthPx)) {
        return {
          width: tapeLengthPx,
          height: tapeHeightPx,
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

    if (!match) {
      return constants.DEFAULT_CANVAS_SIZE;
    }

    return {
      width: Number.parseInt(match[1], 10),
      height: Number.parseInt(match[2], 10),
    };
  };

  const normalizeSerialValue = value => {
    const parsedValue = Number.parseInt(value, 10);
    return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 1;
  };

  const normalizeSerialDigits = value => {
    const parsedValue = Number.parseInt(value, 10);
    return Number.isFinite(parsedValue)
      ? Math.max(1, Math.min(constants.MAX_SERIAL_DIGITS, parsedValue))
      : constants.DEFAULT_SERIAL_DIGITS;
  };

  const getSerialTokenDigits = sourceText => {
    const match = String(sourceText || '').match(/\{(x+)\}/i);
    return match ? normalizeSerialDigits(match[1].length) : constants.DEFAULT_SERIAL_DIGITS;
  };

  const replaceSerialTokenDigits = (sourceText, digits) => String(sourceText || '').replace(/\{x+\}/gi, `{${'x'.repeat(normalizeSerialDigits(digits))}}`);
  const removeSerialTokens = sourceText => String(sourceText || '').replace(/\s*\{x+\}\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim();

  const appendSerialToken = (sourceText, digits = constants.DEFAULT_SERIAL_DIGITS) => {
    const normalizedText = String(sourceText || '');
    const nextToken = `{${'x'.repeat(normalizeSerialDigits(digits))}}`;
    if (/\{x+\}/i.test(normalizedText)) return replaceSerialTokenDigits(normalizedText, digits);
    if (!normalizedText.trim()) return nextToken;
    return `${normalizedText} ${nextToken}`;
  };

  const applySerialTokens = (sourceText, serialValue) => String(sourceText || '').replace(/\{(x+)\}/gi, (_, digits) => (
    String(normalizeSerialValue(serialValue)).padStart(digits.length, '0')
  ));

  const renderSerialText = (sourceText, serialEnabled, serialValue) => (
    serialEnabled ? applySerialTokens(sourceText, serialValue) : String(sourceText || '')
  );

  const setClientOverlayActive = (layerName, isActive) => {
    window.printifyClientOverlay?.setActive?.(layerName, isActive);
  };

  const isArrowNudgeKey = key => key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';

  const readFileAsDataUrl = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read the image file.'));
    reader.readAsDataURL(file);
  });

  const loadImageElement = source => new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Could not decode the image file.'));
    element.src = source;
  });

  const bindHoldAction = (element, startAction, stopAction) => {
    if (!element) {
      return;
    }

    // Preview interactions rely on "hold to preview" semantics in more than
    // one place, so this stays centralized instead of duplicating listeners.
    element.addEventListener('pointerdown', async event => {
      event.preventDefault();
      await startAction();
    });
    // pointerup and pointercancel are the pointer equivalents of keyup —
    // without them the preview starts on press but never stops on release.
    element.addEventListener('pointerup', async () => {
      await stopAction();
    });
    element.addEventListener('pointercancel', async () => {
      await stopAction();
    });
    element.addEventListener('keydown', async event => {
      if (event.repeat) return;
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      await startAction();
    });
    element.addEventListener('keyup', async event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      await stopAction();
    });
    element.addEventListener('blur', async () => {
      await stopAction();
    });
  };

  const sanitizeTemplateName = value => String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  const getCurrentIsoTimestamp = () => new Date().toISOString();

  const readThemeVariable = (name, fallbackValue) => {
    const rootStyles = window.getComputedStyle(document.documentElement);
    const resolvedValue = rootStyles.getPropertyValue(name).trim();
    return resolvedValue || fallbackValue;
  };

  const getBuilderThemeColors = () => ({
    accent: readThemeVariable('--printify-accent', '#1f6f43'),
    accentSoft: readThemeVariable('--printify-accent-soft', 'rgba(100, 212, 123, 0.12)'),
    focusRing: readThemeVariable('--printify-focus-ring', 'rgba(31, 111, 67, 0.28)'),
    guideOutline: 'rgba(12, 16, 19, 0.52)',
  });

  namespace.utils = {
    appendSerialToken,
    applySerialTokens,
    bindHoldAction,
    getBuilderThemeColors,
    getCurrentIsoTimestamp,
    getPrinterCanvasSize,
    getResolvedDefaultTapeWidth,
    getSerialTokenDigits,
    isArrowNudgeKey,
    loadImageElement,
    mmToPixels,
    normalizeSerialDigits,
    normalizeSerialValue,
    normalizeTapeLengthMm,
    readFileAsDataUrl,
    removeSerialTokens,
    renderSerialText,
    replaceSerialTokenDigits,
    sanitizeTemplateName,
    setClientOverlayActive,
  };
}());
