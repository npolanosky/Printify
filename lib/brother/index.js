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

  // Build one complete, self-contained print job for a single label.
  //
  // Every job carries its own invalidate + init + raster-mode preamble so
  // the printer always starts from a known state.  It terminates with 0x1A
  // (print and feed), which advances the label to the cutter and cuts.
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
    copies = 1,
  }) => {
    const normalizedCopies = Math.max(1, Math.floor(Number(copies)) || 1);
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

      const copyLabel = normalizedCopies > 1 ? ` x${normalizedCopies} chain` : '';
      logStamp(`brother: printing${copyLabel} to ${modelName} at ${devicePath} (head ${headWidthPx}px, tape ${mediaWidthMm}mm)`);

      const { lines } = await rasterizeImage(filePath, { headWidthPx, imPath });

      if (lines.length === 0) {
        throw new Error('Rasterized image produced zero raster lines');
      }

      logStamp(`brother: sending ${lines.length} raster lines (${lines[0].length} bytes/line)${copyLabel}`);

      const jobBuffer = buildPrintJob({
        rasterLines: lines,
        mediaWidthMm,
        mediaLengthMm: 0,
        mediaType: status?.mediaType ?? 0x01,
        autocut: printerConfig.brotherAutocut !== false,
      });

      // Send one complete job per copy, sequentially on the same handle.
      // Each job is the proven single-label sequence; we wait for the
      // printer to settle between copies so the device buffer never
      // overflows and writes never interleave.
      for (let copyIndex = 0; copyIndex < normalizedCopies; copyIndex += 1) {
        if (copyIndex > 0) {
          logStamp(`brother: sending copy ${copyIndex + 1}/${normalizedCopies}`);
        }

        await writeToDevice(fd, jobBuffer);

        // Wait for the print-complete status from the printer before the
        // next copy. Some models don't send one, so a timeout is tolerated.
        try {
          const completeBuffer = await readFromDevice(fd, STATUS_RESPONSE_LENGTH, 30000);
          const completeStatus = parseStatusResponse(completeBuffer);

          if (completeStatus?.statusType === 'error') {
            throw new Error(`Print failed: ${completeStatus.errors.join(', ') || 'unknown error'}`);
          }
        } catch (readError) {
          logStamp(`brother: no completion status received (${readError.message})`);
        }
      }

      logStamp(`brother: print job sent successfully to ${modelName}${normalizedCopies > 1 ? ` (${normalizedCopies} labels)` : ''}`);
      return { devicePath, modelName, rasterLines: lines.length, copies: normalizedCopies };
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
