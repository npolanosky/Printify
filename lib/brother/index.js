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
  buildCompressionMode,
  buildRasterLine,
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

  // Build one complete, self-contained print job for a single discrete label.
  //
  // Each label carries its own invalidate + init preamble and terminates with
  // 0x1A (print + feed), which advances the label to the cutter and cuts it.
  // Discrete labels MUST end with 0x1A: the intermediate 0x0C ("print without
  // feeding") would leave the label short of the cutter, producing one
  // continuous uncut strip instead of separate labels.
  const buildPrintJob = ({
    rasterLines,
    mediaWidthMm,
    mediaLengthMm = 0,
    mediaType = 0x01,
    autocut = true,
  }) => {
    // This is byte-for-byte the sequence that prints a correct single label.
    // Do NOT add the ESC i A ("cut each N") command here — it makes this model
    // fire the cutter without printing or advancing the tape.
    const segments = [
      buildInvalidate(),
      buildInitialize(),
      buildSwitchToRaster(),
      buildPrintInfo({
        mediaType,
        mediaWidthMm,
        mediaLengthMm,
        rasterLines: rasterLines.length,
        startingPage: true,
      }),
      buildAutocut(autocut),
      buildCutMode(autocut ? 0x08 : 0x00),
      buildMargin(0),
      buildCompressionMode(0x00),
    ];

    // Send every row as a full raster line (G), including all-zero rows. The
    // compact Z zero-line command is only valid in TIFF mode; in no-compression
    // mode it corrupts the stream on stricter models (e.g. PT-P700), producing
    // blank labels.
    for (const line of rasterLines) {
      segments.push(buildRasterLine(line));
    }

    segments.push(buildPrintAndFeed());

    return Buffer.concat(segments);
  };

  // EXPERIMENTAL chain printing (opt-in via printerConfig.brotherChain).
  //
  // Build one PAGE of a multi-page job: the per-page control codes + raster,
  // WITHOUT the invalidate/init preamble (sent once per job). Per the raster
  // command reference §2.1, control codes repeat per page; n9 is the starting
  // page flag (0 first / 1 continuation); intermediate pages end with 0x0C
  // ("print, no feed") and only the final page ends with 0x1A ("print + feed"),
  // so the head-to-cutter feed happens once for the whole run.
  //
  // Uses the 0x84 print-info flags (width + recovery only) like the reference
  // implementation, rather than the discrete path's 0xCE.
  const buildChainPage = ({
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
        validFlags: 0x84,
      }),
      buildAutocut(autocut),
      buildCutMode(autocut ? 0x08 : 0x00),
      buildMargin(0),
      buildCompressionMode(0x00),
    ];

    // Full raster line per row (no Z) — see buildPrintJob.
    for (const line of rasterLines) {
      segments.push(buildRasterLine(line));
    }

    segments.push(isLastPage ? buildPrintAndFeed() : buildPagePrint());

    return Buffer.concat(segments);
  };

  // After sending a job, drain status frames until the printer reports the
  // print is complete (or an error). Brother emits several status messages
  // per page (phase → printing → completed); waiting for completion before
  // the next copy is what stops jobs from piling up while the device is busy.
  const waitForPrintComplete = async (fd, totalTimeoutMs = 30000) => {
    const start = Date.now();
    let lastStatus = null;

    while (Date.now() - start < totalTimeoutMs) {
      let buffer;
      try {
        buffer = await readFromDevice(fd, STATUS_RESPONSE_LENGTH, 3000);
      } catch {
        // No status frame within the window. If completion was already seen
        // we are done; otherwise keep waiting until the overall timeout.
        if (lastStatus?.statusType === 'print-complete') return lastStatus;
        continue;
      }

      const parsed = parseStatusResponse(buffer);
      if (!parsed) continue;
      lastStatus = parsed;

      if (parsed.hasError || parsed.statusType === 'error') {
        throw new Error(`Print failed: ${parsed.errors.join(', ') || 'printer error'}`);
      }
      if (parsed.statusType === 'print-complete') return parsed;
    }

    return lastStatus;
  };

  // Send a prepared image to a Brother P-touch printer over USB.
  //
  // The caller (printing.js) has already converted the image to a
  // monochrome PNG sized for the target tape.  This function handles the
  // rasterization and protocol framing.
  const printJob = async ({
    filePath,
    files = null,
    printerConfig = {},
    tapeWidthMm = 0,
    copies = 1,
  }) => {
    const normalizedCopies = Math.max(1, Math.floor(Number(copies)) || 1);

    // Build the ordered list of page file paths. A non-empty `files` array means
    // distinct serial pages (one image per page); otherwise fall back to the
    // existing copies behavior (the same path repeated `normalizedCopies` times).
    const pagePaths = Array.isArray(files) && files.length > 0
      ? files
      : Array(normalizedCopies).fill(filePath);
    const totalPages = pagePaths.length;
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

      const pageLabel = totalPages > 1 ? ` x${totalPages}` : '';
      logStamp(`brother: printing${pageLabel} to ${modelName} at ${devicePath} (head ${headWidthPx}px, tape ${mediaWidthMm}mm)`);

      // Rasterize each DISTINCT path once and cache by path. Copies repeat the
      // same path, so this avoids re-rasterizing identical images; distinct
      // serial pages each rasterize once. The ordered per-page line arrays are
      // then read out of the cache in page order.
      const rasterCache = new Map();
      for (const pagePath of pagePaths) {
        if (rasterCache.has(pagePath)) {
          continue;
        }

        const { lines } = await rasterizeImage(pagePath, { headWidthPx, imPath });

        if (lines.length === 0) {
          throw new Error('Rasterized image produced zero raster lines');
        }

        rasterCache.set(pagePath, lines);
      }

      const pageLines = pagePaths.map(pagePath => rasterCache.get(pagePath));
      const firstPageLines = pageLines[0];

      logStamp(`brother: sending ${totalPages} page(s), first page ${firstPageLines.length} raster lines (${firstPageLines[0].length} bytes/line)${pageLabel}`);

      const autocut = printerConfig.brotherAutocut !== false;

      const chainEnabled = printerConfig.brotherChain === true && totalPages > 1;

      if (chainEnabled) {
        // EXPERIMENTAL: one multi-page job — invalidate + init once, then all
        // pages streamed back-to-back (0x0C between, 0x1A last), so the
        // head-to-cutter feed happens only once for the whole run. Wait for
        // completion once at the end rather than between pages, to keep the tape
        // moving continuously. Pages may be identical copies or distinct serial
        // labels — each carries its own raster.
        logStamp(`brother: chain printing ${totalPages} pages`);
        await writeToDevice(fd, buildInvalidate());
        await writeToDevice(fd, buildInitialize());

        for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
          const pageBuffer = buildChainPage({
            rasterLines: pageLines[pageIndex],
            mediaWidthMm,
            mediaLengthMm: 0,
            mediaType: status?.mediaType ?? 0x01,
            autocut,
            startingPage: pageIndex === 0,
            isLastPage: pageIndex === totalPages - 1,
          });
          await writeToDevice(fd, pageBuffer);
        }

        await waitForPrintComplete(fd);
      } else {
        // Each page is a complete discrete label (own init, ends with feed +
        // cut). Crucially, wait for the printer to report print-complete before
        // sending the next page — otherwise jobs stack up while the device is
        // still busy and writes fail or merge.
        for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
          if (pageIndex > 0) {
            logStamp(`brother: page ${pageIndex + 1}/${totalPages}`);
          }

          const jobBuffer = buildPrintJob({
            rasterLines: pageLines[pageIndex],
            mediaWidthMm,
            mediaLengthMm: 0,
            mediaType: status?.mediaType ?? 0x01,
            autocut,
          });

          await writeToDevice(fd, jobBuffer);
          await waitForPrintComplete(fd);
        }
      }

      logStamp(`brother: print job sent successfully to ${modelName}${totalPages > 1 ? ` (${totalPages} labels${chainEnabled ? ', chain' : ''})` : ''}`);
      return { devicePath, modelName, rasterLines: firstPageLines.length, copies: totalPages, pages: totalPages };
    } finally {
      await closeDevice(fd);
    }
  };

  // A USB printer device (/dev/usb/lp*) can only be opened by one writer at a
  // time — concurrent jobs (e.g. several distinct labels uploaded at once)
  // otherwise race to open it and all but one fail with EBUSY. Serialise every
  // print through a single promise chain so jobs queue instead of colliding.
  let printChain = Promise.resolve();
  const print = args => {
    const run = () => printJob(args);
    const result = printChain.then(run, run);
    // Keep the chain alive regardless of individual job success/failure.
    printChain = result.then(() => {}, () => {});
    return result;
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
