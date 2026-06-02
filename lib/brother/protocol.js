// ╭────────────────────────────╮
// │  brother/protocol.js      │
// │  Brother P-touch raster   │
// │  command builders and     │
// │  status response parser   │
// ╰────────────────────────────╯

const STATUS_RESPONSE_LENGTH = 32;

// 100 null bytes flush any residual data left in the printer's receive buffer
// from a previous aborted or incomplete job.
const INVALIDATE_LENGTH = 100;


// ┌─────────────────────────┐
// │  Protocol constructors  │
// └─────────────────────────┘

const buildInvalidate = () => Buffer.alloc(INVALIDATE_LENGTH, 0x00);

// ESC @ resets the printer to its initial state.
const buildInitialize = () => Buffer.from([0x1B, 0x40]);

// ESC i S requests a 32-byte status block from the printer.
const buildStatusRequest = () => Buffer.from([0x1B, 0x69, 0x53]);

// ESC i a 01 switches from ESC/P to raster command mode.
const buildSwitchToRaster = () => Buffer.from([0x1B, 0x69, 0x61, 0x01]);

// ESC i z sets the media layout and raster line count for the current page.
// Per the raster command reference, byte n9 ("starting page") is 0x00 for the
// first page of a job and 0x01 for every subsequent page — NOT a last-page
// flag. The first/last distinction is carried by the print command (0x0C vs
// 0x1A), not here.
const buildPrintInfo = ({ mediaType = 0, mediaWidthMm = 0, mediaLengthMm = 0, rasterLines = 0, startingPage = true }) => {
  // Valid-flag bits: PI_KIND(0x02) | PI_WIDTH(0x04) | PI_LENGTH(0x08) |
  // PI_QUALITY(0x40) | PI_RECOVER(0x80).
  const validFlags = 0xCE;
  const buf = Buffer.alloc(13);
  buf[0] = 0x1B;
  buf[1] = 0x69;
  buf[2] = 0x7A;
  buf[3] = validFlags;
  buf[4] = mediaType;
  buf[5] = mediaWidthMm & 0xFF;
  buf[6] = mediaLengthMm & 0xFF;
  buf.writeUInt32LE(rasterLines, 7);
  buf[11] = startingPage ? 0x00 : 0x01; // n9: 0 = first page, 1 = continuation
  buf[12] = 0x00;                        // n10: fixed 0
  return buf;
};

// ESC i M sets auto-cut behavior.  Pass true to cut after each label.
const buildAutocut = (enabled = true) => (
  Buffer.from([0x1B, 0x69, 0x4D, enabled ? 0x40 : 0x00])
);

// ESC i K — advanced mode settings. Bit definitions (raster ref §4):
//   bit2 0x04 half cut, bit3 0x08 "no chain printing", bit4 0x10 special
//   tape (no cut), bit6 0x40 high-res, bit7 0x80 no buffer clear.
// 0x08 = normal discrete labels: feeding and cutting performed after the
// last label. (bit3 cleared would be true chain printing — labels NOT fed
// or cut at the end, i.e. one continuous strip.)
const buildCutMode = (mode = 0x08) => (
  Buffer.from([0x1B, 0x69, 0x4B, mode])
);

// ESC i A — "cut each N labels" (1..99). Default 1 = cut after every label.
// Only meaningful when auto cut (ESC i M bit6 / 0x40) is enabled.
const buildCutEachPages = (pages = 1) => (
  Buffer.from([0x1B, 0x69, 0x41, Math.max(1, Math.min(99, pages | 0))])
);

// ESC i d sets the feed margin in raster lines (little-endian 16-bit).
const buildMargin = (marginLines = 0) => {
  const buf = Buffer.alloc(5);
  buf[0] = 0x1B;
  buf[1] = 0x69;
  buf[2] = 0x64;
  buf.writeUInt16LE(marginLines, 3);
  return buf;
};

// G + 2-byte LE length + pixel data sends one raster line to the printer.
const buildRasterLine = pixelData => {
  const header = Buffer.alloc(3);
  header[0] = 0x47;
  header.writeUInt16LE(pixelData.length, 1);
  return Buffer.concat([header, pixelData]);
};

// Z sends an empty raster line (no ink deposited for this row).
const buildZeroLine = () => Buffer.from([0x5A]);

// 0x0C prints the current page without final feed (for multi-page jobs).
const buildPagePrint = () => Buffer.from([0x0C]);

// 0x1A prints the current page with feed and finishes the job.
const buildPrintAndFeed = () => Buffer.from([0x1A]);


// ┌──────────────────────────┐
// │  Status response parser  │
// └──────────────────────────┘

const ERROR_FLAGS_1 = {
  0x01: 'no media',
  0x02: 'cutter jam',
  0x04: 'weak battery',
  0x10: 'in use',
  0x80: 'high-voltage adapter',
};

const ERROR_FLAGS_2 = {
  0x01: 'replace media',
  0x02: 'expansion buffer full',
  0x04: 'communication error',
  0x08: 'communication buffer full',
  0x20: 'cover open',
  0x40: 'cancel key',
  0x80: 'media cannot feed',
};

const STATUS_TYPES = {
  0x00: 'reply',
  0x01: 'print-complete',
  0x02: 'error',
  0x05: 'notification',
  0x06: 'phase-change',
};

const parseErrors = (byte1, byte2) => {
  const errors = [];

  Object.entries(ERROR_FLAGS_1).forEach(([bit, description]) => {
    if (byte1 & Number(bit)) errors.push(description);
  });

  Object.entries(ERROR_FLAGS_2).forEach(([bit, description]) => {
    if (byte2 & Number(bit)) errors.push(description);
  });

  return errors;
};

const parseStatusResponse = buffer => {
  if (!Buffer.isBuffer(buffer) || buffer.length < STATUS_RESPONSE_LENGTH) {
    return null;
  }

  if (buffer[0] !== 0x80 || buffer[1] !== 0x20) {
    return null;
  }

  const errors = parseErrors(buffer[8], buffer[9]);

  return {
    headerMark: buffer[0],
    size: buffer[1],
    brotherCode: buffer[2],
    seriesCode: buffer[3],
    modelCode: (buffer[5] << 8) | buffer[4],
    errorInfo1: buffer[8],
    errorInfo2: buffer[9],
    errors,
    hasError: errors.length > 0,
    mediaWidthMm: buffer[10],
    mediaType: buffer[11],
    mediaLengthMm: buffer[17],
    statusType: STATUS_TYPES[buffer[18]] || `unknown-${buffer[18]}`,
    phaseType: buffer[19],
    phaseHigh: buffer[20],
    phaseLow: buffer[21],
    notificationNumber: buffer[22],
  };
};

module.exports = {
  STATUS_RESPONSE_LENGTH,
  buildInvalidate,
  buildInitialize,
  buildStatusRequest,
  buildSwitchToRaster,
  buildPrintInfo,
  buildAutocut,
  buildCutMode,
  buildCutEachPages,
  buildMargin,
  buildRasterLine,
  buildZeroLine,
  buildPagePrint,
  buildPrintAndFeed,
  parseStatusResponse,
};
