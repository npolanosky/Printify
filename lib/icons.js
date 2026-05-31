// ╭──────────────────────────╮
// │  icons.js                │
// │  Resolves icon paths     │
// │  from runtime-facing     │
// │  names and config        │
// ╰──────────────────────────╯
const fs = require('fs');
const path = require('path');

const ICON_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif']);
const DEFAULT_ICON_URL = '/favicon.ico';

// Normalize IDs like "brotherLaser" and driver names like "Brother 2360 D USB"
// into the same lookup key so icon filenames can stay flexible for operators.
const normalizeIconKey = value => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
);

const buildPrinterIconResolver = iconsDir => {
  // Only index known image extensions so users can leave notes or other files
  // in the icons folder without affecting runtime icon resolution.
  const iconFileNames = fs.existsSync(iconsDir)
    ? fs.readdirSync(iconsDir).filter(fileName => ICON_EXTENSIONS.has(path.extname(fileName).toLowerCase()))
    : [];

  // Keep both the literal basename and a normalized form so we can support
  // exact filename matches first, then a more forgiving fallback.
  const iconEntries = iconFileNames.map(fileName => ({
    fileName,
    baseName: path.parse(fileName).name,
    normalizedBaseName: normalizeIconKey(path.parse(fileName).name),
  }));

  const findIconFileName = (...candidates) => {
    for (const candidate of candidates) {
      if (!candidate) continue;

      // Allow the full filename (with extension) or the bare base name.
      const exactMatch = iconEntries.find(entry => (
        entry.fileName === candidate || entry.baseName === candidate
      ));
      if (exactMatch) return exactMatch.fileName;

      const normalizedCandidate = normalizeIconKey(candidate);
      if (!normalizedCandidate) continue;

      const normalizedMatch = iconEntries.find(entry => entry.normalizedBaseName === normalizedCandidate);
      if (normalizedMatch) return normalizedMatch.fileName;
    }

    return null;
  };

  // Prefer an explicit "icon" set in the printer config, then the config ID,
  // then the human-facing driver name, so users can either point directly at
  // a file or rely on whichever filename is more obvious to them.
  const getPrinterIconUrl = (printerId, printerConfig = {}) => {
    const iconFileName = findIconFileName(printerConfig.icon, printerId, printerConfig.driverName);
    return iconFileName ? `/icons/${encodeURIComponent(iconFileName)}` : DEFAULT_ICON_URL;
  };

  return {
    getPrinterIconUrl,
  };
};

module.exports = {
  buildPrinterIconResolver,
  normalizeIconKey,
  DEFAULT_ICON_URL,
};
