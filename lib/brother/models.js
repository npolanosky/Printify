// ╭────────────────────────────╮
// │  brother/models.js        │
// │  Brother P-touch model    │
// │  database for USB IDs     │
// │  and print capabilities   │
// ╰────────────────────────────╯

const BROTHER_VENDOR_ID = '04f9';

// Print head widths grouped by pixel count. Most consumer P-touch models use
// a 128px head at 180 DPI; wider or higher-DPI heads appear in the D4xx+ and
// industrial P9xx lines.
const HEAD_128_180 = { headWidthPx: 128, dpi: 180 };
const HEAD_170_180 = { headWidthPx: 170, dpi: 180 };
const HEAD_128_360 = { headWidthPx: 128, dpi: 360 };
const HEAD_454_300 = { headWidthPx: 454, dpi: 300 };

// USB product IDs sourced from ptouch-print, libinklern.info, and Brother
// developer documentation.  Add new entries as models are confirmed.
const MODELS = {
  '2015': { name: 'PT-1500PC',   ...HEAD_128_180 },
  '2020': { name: 'PT-1950',     ...HEAD_128_180 },
  '2025': { name: 'PT-1010',     ...HEAD_128_180 },
  '2028': { name: 'PT-1230PC',   ...HEAD_128_180 },
  '2038': { name: 'PT-2430PC',   ...HEAD_128_180 },
  '2042': { name: 'PT-2700',     ...HEAD_128_180 },
  '2061': { name: 'PT-P700',     ...HEAD_128_180 },
  '2062': { name: 'PT-P750W',    ...HEAD_128_180 },
  '2064': { name: 'PT-H500',     ...HEAD_128_180 },
  '206c': { name: 'PT-E500',     ...HEAD_128_180 },
  '2072': { name: 'PT-D450',     ...HEAD_128_180 },
  '2073': { name: 'PT-E550W',    ...HEAD_128_180 },
  '2074': { name: 'PT-D200',     ...HEAD_128_180 },
  '2085': { name: 'PT-D210',     ...HEAD_128_180 },
  '2086': { name: 'PT-P950NW',   ...HEAD_454_300 },
  '20a7': { name: 'PT-P300BT',   ...HEAD_128_180 },
  '20af': { name: 'PT-P710BT',   ...HEAD_128_180 },
  '20b3': { name: 'PT-P910BT',   ...HEAD_128_360 },
  '20c5': { name: 'PT-D220',     ...HEAD_128_180 },
  '20ca': { name: 'PT-D460BT',   ...HEAD_170_180 },
  '20cb': { name: 'PT-D410',     ...HEAD_170_180 },
  '20cf': { name: 'PT-D610BT',   ...HEAD_170_180 },
};

const DEFAULT_HEAD = HEAD_128_180;

const lookupModel = productId => {
  const normalized = String(productId || '').trim().toLowerCase();
  return MODELS[normalized] || null;
};

const isBrotherDevice = vendorId => (
  String(vendorId || '').trim().toLowerCase() === BROTHER_VENDOR_ID
);

module.exports = {
  BROTHER_VENDOR_ID,
  DEFAULT_HEAD,
  MODELS,
  lookupModel,
  isBrotherDevice,
};
