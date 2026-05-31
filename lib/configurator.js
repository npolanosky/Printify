// ╭────────────────────────────╮
// │  configurator.js           │
// │  Loads root YAML config    │
// │  and normalizes runtime    │
// │  values for the app        │
// ╰────────────────────────────╯
const path = require('path');
const {
  rootDir,
  configDir,
  configPath,
  readParsedConfig,
  getDefaultImPath,
  iconsDir,
  fontsDir,
} = require('./runtimeConfig');


// ┌─────────────────┐
// │  Project paths  │
// └─────────────────┘
const packageJson  = require(path.join(rootDir, 'package.json'));
const parsedConfig = readParsedConfig();


// ┌─────────────────┐
// │  Runtime flags  │
// └─────────────────┘
const getPortFromParsedConfig = nextParsedConfig => nextParsedConfig.port ?? 8020;
const getTestingFromParsedConfig = nextParsedConfig => nextParsedConfig.testing ?? true;
const getImPathFromParsedConfig = nextParsedConfig => nextParsedConfig.imPath || getDefaultImPath();
const getAssistantFromParsedConfig = nextParsedConfig => (
  nextParsedConfig.assistant !== undefined
    ? (nextParsedConfig.assistant === 'none' ? 'Clippy' : nextParsedConfig.assistant)
    : 'Clippy'
);
const supportedFileKinds = new Set(['pdf', 'image', 'zip']);
const supportedPrintModes = new Set(['driver', 'cli', 'brother']);
const supportedCliOutputs = new Set(['pdf', 'png']);
const supportedTapeWidths = new Set([6, 9, 12, 18, 24, 36]);
const supportedMonochromeDithers = new Set(['floydsteinberg', 'riemersma', 'none']);
const supportedMonochromeBits = new Set([1, 8]);
const supportedSizeUnits = new Map([
  ['inch', 'inch'],
  ['inches', 'inch'],
  ['in', 'inch'],
  ['mm', 'mm'],
  ['millimeter', 'mm'],
  ['millimeters', 'mm'],
  ['cm', 'cm'],
  ['centimeter', 'cm'],
  ['centimeters', 'cm'],
  ['px', 'px'],
  ['pixel', 'px'],
  ['pixels', 'px'],
]);

const parseDecimalSize = sizeValue => {
  const match = String(sizeValue || '')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/i);

  if (!match) {
    return null;
  }

  return {
    width: Number.parseFloat(match[1]),
    height: Number.parseFloat(match[2]),
  };
};

const normalizeSizeUnit = unitValue => {
  const normalized = String(unitValue || '').trim().toLowerCase();
  return supportedSizeUnits.get(normalized) || null;
};

const parseTapeWidths = (printerId, tapeValues) => {
  if (!Array.isArray(tapeValues) || tapeValues.length === 0) {
    throw new Error(`Printer "${printerId}" with size "tape" must define a non-empty tapes array`);
  }

  const normalizedTapes = tapeValues.map(value => Number.parseInt(value, 10));

  normalizedTapes.forEach(tapeWidth => {
    if (!supportedTapeWidths.has(tapeWidth)) {
      throw new Error(`Printer "${printerId}" has unsupported tape width "${tapeWidth}"`);
    }
  });

  return Array.from(new Set(normalizedTapes));
};

// Keep the runtime pixel size as a single normalized string because the
// converter and browser clients both already speak in "WIDTHxHEIGHT" form.
const formatPxSize = ({ width, height }) => `${width}x${height}`;

// Operators configure physical size in decimal units, but downstream print
// prep still needs a concrete pixel box for ImageMagick resize and builder
// canvas dimensions. This resolver is the one place that translates:
//   1. physical size + density -> pixels
//   2. raw pixel size -> normalized pixel size
// so the rest of the app can consume one stable shape.
const resolvePxSize = ({ printerId, size, units, density, legacyPxSize }) => {
  if (String(size || '').trim().toLowerCase() === 'tape') {
    return {
      size: 'tape',
      units: 'mm',
      sizePxWidth: null,
      sizePxHeight: null,
      sizePx: null,
    };
  }

  if (size === null || size === undefined || size === '') {
    if (!legacyPxSize) {
      return {
        size: null,
        units: null,
        sizePxWidth: null,
        sizePxHeight: null,
        sizePx: null,
      };
    }

    const parsedLegacySize = parseDecimalSize(legacyPxSize);

    if (!parsedLegacySize) {
      throw new Error(`Printer "${printerId}" has invalid legacy pxSize "${legacyPxSize}"`);
    }

    const sizePxWidth = Math.round(parsedLegacySize.width);
    const sizePxHeight = Math.round(parsedLegacySize.height);

    return {
      size: String(legacyPxSize),
      units: 'px',
      sizePxWidth,
      sizePxHeight,
      sizePx: formatPxSize({
        width: sizePxWidth,
        height: sizePxHeight,
      }),
    };
  }

  const parsedSize = parseDecimalSize(size);

  if (!parsedSize) {
    throw new Error(`Printer "${printerId}" has invalid size "${size}"`);
  }

  const normalizedUnits = normalizeSizeUnit(units);

  if (!normalizedUnits) {
    throw new Error(`Printer "${printerId}" has unsupported units "${units}"`);
  }

  let sizePxWidth = null;
  let sizePxHeight = null;

  if (normalizedUnits === 'px') {
    sizePxWidth = Math.round(parsedSize.width);
    sizePxHeight = Math.round(parsedSize.height);
  } else {
    const numericDensity = Number.parseFloat(density);

    if (!Number.isFinite(numericDensity) || numericDensity <= 0) {
      throw new Error(`Printer "${printerId}" needs a positive density when size units are not pixels`);
    }

    const pixelsPerUnit = normalizedUnits === 'inch'
      ? numericDensity
      : (normalizedUnits === 'cm' ? numericDensity / 2.54 : numericDensity / 25.4);

    sizePxWidth = Math.round(parsedSize.width * pixelsPerUnit);
    sizePxHeight = Math.round(parsedSize.height * pixelsPerUnit);
  }

  return {
    size: String(size),
    units: normalizedUnits,
    sizePxWidth,
    sizePxHeight,
    sizePx: formatPxSize({
      width: sizePxWidth,
      height: sizePxHeight,
    }),
  };
};


// ┌───────────────────────┐
// │  Printer definitions  │
// └───────────────────────┘
const normalizePrinters = rawPrinters => {
  const printers = Object.fromEntries(
    Object.entries(rawPrinters || {}).map(([printerId, printerConfig]) => [
      printerId,
      {
        ...printerConfig,
      },
    ])
  );

  Object.entries(printers).forEach(([printerId, printerConfig]) => {
  const printMode = printerConfig.printMode || 'driver';

  if (!supportedPrintModes.has(printMode)) {
    throw new Error(`Printer "${printerId}" has unsupported printMode "${printMode}"`);
  }

  if (printMode === 'driver' && !printerConfig.driverName) {
    throw new Error(`Printer "${printerId}" is missing driverName`);
  }

  if (printMode === 'cli' && !printerConfig.cliCommand) {
    throw new Error(`Printer "${printerId}" uses cli printMode but is missing cliCommand`);
  }

  if (printMode === 'cli' && !supportedCliOutputs.has(String(printerConfig.output || '').trim().toLowerCase())) {
    throw new Error(`Printer "${printerId}" uses cli printMode but has unsupported output "${printerConfig.output}"`);
  }

  if (printMode === 'brother' && process.platform !== 'linux') {
    // Not an error; the printer still appears in the UI but jobs will
    // fail at dispatch time with a clear message unless testing mode is on.
  }

  if (!Array.isArray(printerConfig.acceptedKinds) || printerConfig.acceptedKinds.length === 0) {
    throw new Error(`Printer "${printerId}" must define a non-empty acceptedKinds array`);
  }

  printerConfig.acceptedKinds.forEach(fileKind => {
    if (!supportedFileKinds.has(fileKind)) {
      throw new Error(`Printer "${printerId}" has unsupported acceptedKinds value "${fileKind}"`);
    }
  });

  if (printerConfig.labelBuilder && !printerConfig.acceptedKinds.includes('image')) {
    throw new Error(`Printer "${printerId}" enables the label builder but does not accept image uploads`);
  }

  printerConfig.printMode = printMode;
  printerConfig.output = printMode === 'cli'
    ? String(printerConfig.output || '').trim().toLowerCase()
    : (printMode === 'brother' ? 'png' : null);
  printerConfig.bundleCopies = Boolean(printerConfig.bundleCopies);
  printerConfig.monochrome = Boolean(printerConfig.monochrome);
  printerConfig.monochromeBit = printerConfig.monochrome
    ? Number.parseInt(printerConfig.monochromeBit ?? 1, 10)
    : null;
  printerConfig.monochromeDither = printerConfig.monochrome
    ? String(printerConfig.monochromeDither || 'floydsteinberg').trim().toLowerCase()
    : null;

  if (printerConfig.monochrome && !supportedMonochromeDithers.has(printerConfig.monochromeDither)) {
    throw new Error(`Printer "${printerId}" has unsupported monochromeDither "${printerConfig.monochromeDither}"`);
  }

  if (printerConfig.monochrome && !supportedMonochromeBits.has(printerConfig.monochromeBit)) {
    throw new Error(`Printer "${printerId}" has unsupported monochromeBit "${printerConfig.monochromeBit}"`);
  }

  const isTapePrinter = String(printerConfig.size || '').trim().toLowerCase() === 'tape';

  if (isTapePrinter) {
    const tapes = parseTapeWidths(printerId, printerConfig.tapes);
    const numericDensity = Number.parseFloat(printerConfig.density);
    const defaultTape = printerConfig.defaultTape === undefined || printerConfig.defaultTape === null || printerConfig.defaultTape === ''
      ? null
      : Number.parseInt(printerConfig.defaultTape, 10);

    if (!Number.isFinite(numericDensity) || numericDensity <= 0) {
      throw new Error(`Printer "${printerId}" with size "tape" needs a positive density`);
    }

    if (defaultTape !== null && !tapes.includes(defaultTape)) {
      throw new Error(`Printer "${printerId}" has defaultTape "${printerConfig.defaultTape}" that is not listed in tapes`);
    }

    printerConfig.tapes = tapes;
    printerConfig.defaultTape = defaultTape;
    printerConfig.isTape = true;
  } else {
    printerConfig.tapes = [];
    printerConfig.defaultTape = null;
    printerConfig.isTape = false;
  }

  Object.assign(printerConfig, resolvePxSize({
    printerId,
    size: printerConfig.size,
    units: printerConfig.units,
    density: printerConfig.density,
    legacyPxSize: printerConfig.pxSize,
  }));
  });

  return printers;
};

const getNormalizedPrinters = nextParsedConfig => normalizePrinters(nextParsedConfig.printers || {});

const port = getPortFromParsedConfig(parsedConfig);
const testing = getTestingFromParsedConfig(parsedConfig);
const imPath = getImPathFromParsedConfig(parsedConfig);
const assistant = getAssistantFromParsedConfig(parsedConfig);
const printers = getNormalizedPrinters(parsedConfig);

module.exports = {
  rootDir,
  configDir,
  configPath,
  staticDir: path.join(rootDir, 'src'),
  iconsDir,
  fontsDir,
  dataDir: path.join(rootDir, 'data'),
  logsDir: path.join(rootDir, 'data', 'logs'),
  uploadsDir: path.join(rootDir, 'data', 'uploads'),
  labelTemplatesDir: path.join(rootDir, 'data', 'labelTemplates'),
  previewCacheDir: path.join(rootDir, 'lib', 'previewCache'),
  serverDataPath: path.join(rootDir, 'data', 'logs', 'serverData.json'),
  version: packageJson.version,
  port,
  testing,
  assistant,
  imPath,
  printers,
  getNormalizedPrinters,
  getPortFromParsedConfig,
  getTestingFromParsedConfig,
  getImPathFromParsedConfig,
  getAssistantFromParsedConfig,
};
