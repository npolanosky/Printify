// ╭────────────────────────────╮
// │  brother/index.js         │
// │  Native Brother P-touch   │
// │  USB printing service     │
// │  for Linux                │
// ╰────────────────────────────╯
const { lookupModel, DEFAULT_HEAD } = require('./models');
const {
  buildInvalidate,
  buildInitialize,
  buildStatusRequest,
  buildSwitchToRaster,
  buildPrintInfo,
  buildAutocut,
  buildCutMode,
  buildMargin,
  buildRasterLine,
  buildZeroLine,
  buildPrintAndFeed,
  parseStatusResponse,
  STATUS_RESPONSE_LENGTH,
} = require('./protocol');
const {
  discoverDevices,
  resolveDevicePath,
  openDevice,
  writeToDevice,
  readFromDevice,
  closeDevice,
} = require('./device');
const { rasterizeImage } = require('./rasterizer');


// ┌────────────────────────┐
// │  Brother print service │
// └────────────────────────┘
const createBrotherService = ({
  imPath,
  logStamp = () => {},
  errorLogStamp = () => {},
}) => {
  // Resolve the print-head width for this job.  Prefer the live status
  // response, fall back to the model database, then to the safe 128px
  // default that covers the majority of consumer P-touch models.
  const resolveHeadWidth = ({ status, deviceInfo }) => {
    if (deviceInfo?.headWidthPx) return deviceInfo.headWidthPx;

    if (status?.mediaWidthMm) {
      const model = lookupModel(deviceInfo?.productId);
      if (model?.headWidthPx) return model.headWidthPx;
    }

    return DEFAULT_HEAD.headWidthPx;
  };

  // Build the full raster job buffer from the image lines and send it in
  // one write sequence.  Keeping the job atomic avoids interleaving with
  // other processes that might share the device file.
  const buildPrintJob = ({
    rasterLines,
    mediaWidthMm,
    mediaLengthMm = 0,
    mediaType = 0x01,
    autocut = true,
  }) => {
    const segments = [
      buildInvalidate(),
      buildInitialize(),
      buildSwitchToRaster(),
      buildPrintInfo({
        mediaType,
        mediaWidthMm,
        mediaLengthMm,
        rasterLines: rasterLines.length,
        isLastPage: true,
      }),
      buildAutocut(autocut),
      buildCutMode(autocut ? 0x08 : 0x00),
      buildMargin(0),
    ];

    // Emit each raster line; empty lines use the compact Z command.
    for (const line of rasterLines) {
      const isEmpty = line.every(byte => byte === 0x00);
      segments.push(isEmpty ? buildZeroLine() : buildRasterLine(line));
    }

    segments.push(buildPrintAndFeed());

    return Buffer.concat(segments);
  };

  // Send a prepared image to a Brother P-touch printer over USB.
  //
  // The caller (printing.js) has already converted the image to a
  // monochrome PNG sized for the target tape.  This function handles the
  // rasterization and protocol framing.
  const print = async ({
    filePath,
    printerConfig = {},
    tapeWidthMm = 0,
  }) => {
    const configuredDevice = printerConfig.brotherDevice || null;
    const devicePath = await resolveDevicePath(configuredDevice);

    if (!devicePath) {
      throw new Error(
        'No Brother P-touch printer found on USB.'
        + (process.platform !== 'linux' ? ' The brother print mode requires Linux.' : '')
        + ' Check that the printer is connected and /dev/usb/lp* is accessible.'
      );
    }

    // Probe the device to learn its current state before printing.
    let status = null;
    let deviceInfo = null;
    const discovered = await discoverDevices();
    deviceInfo = discovered.find(d => d.path === devicePath) || null;

    const fd = await openDevice(devicePath);

    try {
      await writeToDevice(fd, buildInvalidate());
      await writeToDevice(fd, buildInitialize());
      await writeToDevice(fd, buildStatusRequest());

      try {
        const statusBuffer = await readFromDevice(fd, STATUS_RESPONSE_LENGTH, 3000);
        status = parseStatusResponse(statusBuffer);
      } catch {
        logStamp('brother: status probe timed out, proceeding with defaults');
      }

      if (status?.hasError) {
        throw new Error(`Printer reported errors: ${status.errors.join(', ')}`);
      }

      const headWidthPx = resolveHeadWidth({ status, deviceInfo });
      const mediaWidthMm = tapeWidthMm || status?.mediaWidthMm || 0;
      const modelName = deviceInfo?.modelName || (status ? `model-${status.modelCode}` : 'unknown');

      logStamp(`brother: printing to ${modelName} at ${devicePath} (head ${headWidthPx}px, tape ${mediaWidthMm}mm)`);

      const { lines } = await rasterizeImage(filePath, { headWidthPx, imPath });

      if (lines.length === 0) {
        throw new Error('Rasterized image produced zero raster lines');
      }

      logStamp(`brother: sending ${lines.length} raster lines (${lines[0].length} bytes/line)`);

      const jobBuffer = buildPrintJob({
        rasterLines: lines,
        mediaWidthMm,
        mediaLengthMm: 0,
        mediaType: status?.mediaType ?? 0x01,
        autocut: printerConfig.brotherAutocut !== false,
      });

      // Re-initialize and send the full job on the already-open handle.
      // We built the init sequence into the job buffer itself so the
      // printer starts from a known state regardless of the probe above.
      await writeToDevice(fd, jobBuffer);

      // Wait for the print-complete status from the printer.
      try {
        const completeBuffer = await readFromDevice(fd, STATUS_RESPONSE_LENGTH, 30000);
        const completeStatus = parseStatusResponse(completeBuffer);

        if (completeStatus?.statusType === 'error') {
          throw new Error(`Print failed: ${completeStatus.errors.join(', ') || 'unknown error'}`);
        }
      } catch (readError) {
        // Some models don't send a completion status. Log but don't fail.
        logStamp(`brother: no completion status received (${readError.message})`);
      }

      logStamp(`brother: print job sent successfully to ${modelName}`);
      return { devicePath, modelName, rasterLines: lines.length };
    } finally {
      await closeDevice(fd);
    }
  };

  return {
    print,
    discoverDevices,
    resolveDevicePath,
  };
};

module.exports = {
  createBrotherService,
};
