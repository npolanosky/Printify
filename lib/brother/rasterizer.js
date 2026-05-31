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
//   2. If the image tape-width dimension exceeds the head, scale it down
//      proportionally (rather than cropping) so content is never cut off
//   3. Center-pad the width to exactly headWidthPx with white (no-print)
//   4. Negate so black pixels become 1 (print dot) and white become 0
//   5. Output as raw grayscale at depth 1, packed 8 pixels per byte MSB-first
//
// The resulting buffer is then reversed so raster lines are in left-to-right
// order (line 0 = left edge of the label) rather than the reversed order that
// -rotate -90 naturally produces.  Without reversal the print is mirrored.
const rasterizeImage = async (imagePath, { headWidthPx, imPath }) => {
  // origWidth  = label length (tape feed direction)
  // origHeight = label height (tape width direction) — must fit within headWidthPx
  const { width: origWidth, height: origHeight } = await getImageDimensions(imagePath, imPath);

  // After -90 rotation the dimensions swap: tape-width becomes image width,
  // label-length becomes image height.  If the image is wider than the head,
  // scale it down proportionally so nothing is cropped.
  const scale = origHeight > headWidthPx ? headWidthPx / origHeight : 1;
  const rotatedHeight = Math.round(origWidth * scale);

  const rawData = await new Promise((resolve, reject) => {
    const args = [imagePath, '-rotate', '-90'];

    // Only add a resize step when the tape-width dimension exceeds the head.
    if (scale < 1) {
      // Force exact target dimensions (proportionally computed above) to
      // ensure the raster line width is exactly headWidthPx after -extent.
      args.push('-resize', `${headWidthPx}x${rotatedHeight}!`);
    }

    args.push(
      '-gravity', 'center',
      '-background', 'white',
      '-extent', `${headWidthPx}x${rotatedHeight}`,
      '-negate',
      '-depth', '1',
      '-type', 'bilevel',
      'gray:-',
    );

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

  // -rotate -90 (CCW) produces columns in right-to-left order: line 0 = the
  // rightmost column of the original, line N = the leftmost.  The printer
  // feeds from line 0, so without reversal the output is a mirror image.
  // Reversing here restores the expected left-to-right order.
  lines.reverse();

  return {
    lines,
    rasterLineCount,
    bytesPerLine,
  };
};

module.exports = {
  rasterizeImage,
};
