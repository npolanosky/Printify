// ╭────────────────────────────╮
// │  brother/rasterizer.js    │
// │  Converts a prepared PNG  │
// │  into Brother raster      │
// │  lines using ImageMagick  │
// ╰────────────────────────────╯
const path = require('path');
const { execFile } = require('child_process');

// ImageMagick 7 bundles everything behind "magick"; IM6 has separate
// "identify" and "convert" binaries.  This helper resolves the right
// command and arguments for dimension lookup.
const resolveIdentifyCommand = imPath => {
  const baseName = path.basename(String(imPath || '')).toLowerCase();
  const isMagick7 = baseName === 'magick' || baseName === 'magick.exe';
  return {
    command: isMagick7 ? imPath : 'identify',
    prefix: isMagick7 ? ['identify'] : [],
  };
};

// Get the pixel dimensions of a source image without loading it fully.
const getImageDimensions = (imagePath, imPath) => {
  const { command, prefix } = resolveIdentifyCommand(imPath);
  const args = [...prefix, '-format', '%w %h', imagePath];

  return new Promise((resolve, reject) => {
    execFile(command, args, {
      encoding: 'utf8',
      timeout: 10000,
    }, (error, stdout) => {
      if (error) return reject(error);

      const parts = stdout.trim().split(/\s+/);
      const width = parseInt(parts[0], 10);
      const height = parseInt(parts[1], 10);

      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        return reject(new Error(`Could not parse image dimensions: "${stdout.trim()}"`));
      }

      resolve({ width, height });
    });
  });
};

// Produce raw 1-bit-per-pixel raster data ready for the Brother protocol.
//
// The pipeline:
//   1. Rotate -90 so image columns become rows (each row = one raster line)
//   2. Center-pad the width to exactly headWidthPx with white (no-print)
//   3. Negate so black pixels become 1 (print dot) and white become 0
//   4. Output as raw grayscale at depth 1, packed 8 pixels per byte MSB-first
//
// The resulting buffer can be sliced into bytesPerLine chunks, each chunk
// being one raster line in print-head order.
const rasterizeImage = async (imagePath, { headWidthPx, imPath }) => {
  const { width: origWidth } = await getImageDimensions(imagePath, imPath);

  // After -90 rotation the dimensions swap.
  const rotatedHeight = origWidth;

  const rawData = await new Promise((resolve, reject) => {
    const args = [
      imagePath,
      '-rotate', '-90',
      '-gravity', 'center',
      '-background', 'white',
      '-extent', `${headWidthPx}x${rotatedHeight}`,
      '-negate',
      '-depth', '1',
      '-type', 'bilevel',
      'gray:-',
    ];

    execFile(imPath, args, {
      encoding: 'buffer',
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
    }, (error, stdout) => {
      if (error) return reject(error);
      resolve(stdout);
    });
  });

  const bytesPerLine = Math.ceil(headWidthPx / 8);
  const rasterLineCount = Math.floor(rawData.length / bytesPerLine);

  const lines = [];
  for (let i = 0; i < rasterLineCount; i++) {
    lines.push(rawData.subarray(i * bytesPerLine, (i + 1) * bytesPerLine));
  }

  return {
    lines,
    rasterLineCount,
    bytesPerLine,
  };
};

module.exports = {
  rasterizeImage,
};
