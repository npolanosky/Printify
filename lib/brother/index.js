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
  buildCutEachPages,
  buildRasterLine,
  buildZeroLine,
  buildPagePrint,
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

  // Build the per-page control codes + raster data for one label, following
  // the raster command reference's page structure. The invalidate + init
  // preamble is NOT included here — per the manual it is sent once per job,
  // not per page (sending it between pages is what forces the wasteful
  // head-to-cutter re-feed before every copy).
  //
  //   startingPage : true for the first page of the job, false thereafter
  //                  (drives the print-info n9 byte: 0 first, 1 continuation)
  //   isLastPage   : terminates with 0x1A (print + feed) on the last page,
  //                  or 0x0C (print, no feed) on intermediate pages — the
  //                  latter is what lets copies print back-to-back with only
  //                  the final label fed out to the cutter.
  const buildLabelPage = ({
    rasterLines,
    mediaWidthMm,
    mediaLengthMm = 0,
    mediaType = 0x01,
    autocut = true,
    startingPage = true,
    isLastPage = true,
  }) => {
    const segments = [
      buildSwitchToRaster(),
      buildPrintInfo({
        mediaType,
        mediaWidthMm,
        mediaLengthMm,
        rasterLines: rasterLines.length,
        startingPage,
      }),
      buildAutocut(autocut),
      buildCutEachPages(1),
      buildCutMode(0x08), // discrete labels: feed + cut after the last page
      buildMargin(0),
    ];

    for (const line of rasterLines) {
      const isEmpty = line.every(byte => byte === 0x00);
      segments.push(isEmpty ? buildZeroLine() : buildRasterLine(line));
    }

    segments.push(isLastPage ? buildPrintAndFeed() : buildPagePrint());

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

      const autocut = printerConfig.brotherAutocut !== false;

      // Per the raster command reference, the invalidate + init preamble is
      // sent ONCE at the start of the job; the control codes, raster data and
      // print command are then repeated per page. Keeping it to a single job
      // (rather than re-initialising per copy) means the head-to-cutter feed
      // happens only once — intermediate copies end with 0x0C (no feed) and
      // only the final copy ends with 0x1A (feed out to the cutter).
      await writeToDevice(fd, buildInvalidate());
      await writeToDevice(fd, buildInitialize());

      for (let copyIndex = 0; copyIndex < normalizedCopies; copyIndex += 1) {
        if (copyIndex > 0) {
          logStamp(`brother: page ${copyIndex + 1}/${normalizedCopies}`);
        }

        const pageBuffer = buildLabelPage({
          rasterLines: lines,
          mediaWidthMm,
          mediaLengthMm: 0,
          mediaType: status?.mediaType ?? 0x01,
          autocut,
          startingPage: copyIndex === 0,
          isLastPage: copyIndex === normalizedCopies - 1,
        });

        await writeToDevice(fd, pageBuffer);

        // The manual requires confirming completion of each page before
        // sending the next. Some models don't emit a status, so tolerate a
        // timeout rather than failing the job.
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
