// ╭──────────────────────────╮
// │  printing.js             │
// │  Print job prep and      │
// │  dispatch helpers for    │
// │  files sent to printers  │
// ╰──────────────────────────╯
const fs                        = require('fs');
const path                      = require('path');
const pdfToPrinter              = require('pdf-to-printer');
const { PDFDocument }           = require('pdf-lib');
const { execFile, spawn }       = require('child_process');
const { resolveLoggedPath }     = require('./filePaths');
const { createBrotherService } = require('./brother');

const buildQueueJobId = jobMeta => {
  const baseClientJobId = String(jobMeta?.clientJobId || '').trim();

  if (!baseClientJobId) {
    return null;
  }

  const copySuffix = Number.isFinite(Number(jobMeta?.copyIndex))
    ? `-copy-${Number(jobMeta.copyIndex)}`
    : '';

  return `${baseClientJobId}${copySuffix}`;
};

const buildQueueGroupId = jobMeta => {
  const baseClientJobId = String(jobMeta?.uploadGroupId || jobMeta?.clientJobId || '').trim();
  return baseClientJobId || null;
};


// ┌──────────────────────┐
// │  Printing service    │
// └──────────────────────┘
const createPrintingService = ({
  testing,            // Startup fallback for whether print transport should be skipped.
  getTesting,         // Reads the current testing-mode flag for live config changes.
  serverSave,         // Persists print counters and notifies listeners about new jobs.
  logStore,           // Appends and reads structured print history entries.
  deduplicator,       // Detects recent duplicate jobs before dispatching work.
  logStamp,           // Writes normal printing lifecycle messages to the server console.
  errorLogStamp,      // Writes printing failures and transport diagnostics.
  converter,          // Converts images into printer-ready PDFs when needed.
  previewer,          // Generates checksum-keyed thumbnails for recent log entries.
  jobSystem,          // Shared owner for job ids, queue state, and log entry shaping.
  imPath,             // ImageMagick binary path for brother rasterizer.
}) => {
  const brotherService = createBrotherService({ imPath, logStamp, errorLogStamp });
  const formatPrinterTarget = printerConfig => (
    printerConfig?.displayName
    || printerConfig?.driverName
    || printerConfig?.id
    || printerConfig?.cliCommand
    || 'unknown-printer'
  );

  const createPrinterConfig = (printerId, printerConfig) => ({
    id: printerId,
    ...printerConfig,
  });

  const resolvePlatformPrinterConfig = printerConfig => {
    if (printerConfig.printMode === 'cli' || printerConfig.printMode === 'brother') {
      return { ...printerConfig };
    }

    return {
      ...printerConfig,
      printMode: process.platform === 'linux' ? 'lp' : 'pdfToPrinter',
    };
  };

  const resolvePrintArgs = (jobMetaOrCallback, callback) => {
    if (typeof jobMetaOrCallback === 'function') {
      return {
        done: jobMetaOrCallback,
        jobMeta: {},
      };
    }

    return {
      done: typeof callback === 'function' ? callback : () => {},
      jobMeta: jobMetaOrCallback || {},
    };
  };

  const buildBundledPdfPath = (sourceFilePath, printerConfig) => (
    path.join(
      path.dirname(sourceFilePath),
      `${Date.now()}-${path.parse(sourceFilePath).name}-${printerConfig.id || 'printer'}-bundle.pdf`
    )
  );

  const buildBundledImagePath = (sourceFilePath, printerConfig) => (
    path.join(
      path.dirname(sourceFilePath),
      `${Date.now()}-${path.parse(sourceFilePath).name}-${printerConfig.id || 'printer'}-bundle.png`
    )
  );

  const buildPreparedImagePath = (sourceFilePath, printerConfig) => (
    path.join(
      path.dirname(sourceFilePath),
      `${Date.now()}-${path.parse(sourceFilePath).name}-${printerConfig.id || 'printer'}-prepared.png`
    )
  );

  const prepareImageForPrinter = (filePath, printerConfig, outputImagePath, options = {}) => (
    converter.convertImgsToPng(
      [filePath],
      printerConfig,
      outputImagePath || buildPreparedImagePath(filePath, printerConfig),
      options
    )
  );

  const formatCopiedJobName = (fileName, copyCount) => {
    if (!fileName || copyCount <= 1) {
      return fileName || null;
    }

    const parsedPath = path.parse(fileName);
    const normalizedBaseName = parsedPath.name.replace(/(?: x\d+)+$/i, '');
    return `${normalizedBaseName} x${copyCount}${parsedPath.ext}`;
  };

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

  const getPrinterPageAreaSquareMm = printerConfig => {
    if (printerConfig?.isTape) {
      return null;
    }

    const parsedSize = parseDecimalSize(printerConfig?.size);
    const normalizedUnits = String(printerConfig?.units || '').trim().toLowerCase();
    const density = Number.parseFloat(printerConfig?.density);

    if (!parsedSize) {
      return null;
    }

    switch (normalizedUnits) {
      case 'mm':
      case 'millimeter':
      case 'millimeters':
        return parsedSize.width * parsedSize.height;
      case 'cm':
      case 'centimeter':
      case 'centimeters':
        return (parsedSize.width * 10) * (parsedSize.height * 10);
      case 'inch':
      case 'inches':
      case 'in':
        return (parsedSize.width * 25.4) * (parsedSize.height * 25.4);
      case 'px':
      case 'pixel':
      case 'pixels':
        if (Number.isFinite(density) && density > 0) {
          return ((parsedSize.width / density) * 25.4) * ((parsedSize.height / density) * 25.4);
        }

        return null;
      default:
        return null;
    }
  };

  const getPdfPageCount = async filePath => {
    if (!filePath || String(filePath).toLowerCase().endsWith('.pdf') === false) {
      return null;
    }

    const sourceBuffer = await fs.promises.readFile(filePath);
    const sourceDocument = await PDFDocument.load(sourceBuffer);
    return sourceDocument.getPageCount();
  };

  // Keep PDF copy bundling in-process so reprints behave the same way across
  // platforms and produce an auditable artifact beside the source file.
  const createBundledPdfCopy = async ({ sourceFilePath, outputPdfPath, copyCount }) => {
    const sourceBuffer = await fs.promises.readFile(sourceFilePath);
    const sourceDocument = await PDFDocument.load(sourceBuffer);
    const bundledDocument = await PDFDocument.create();
    const sourcePageIndexes = sourceDocument.getPageIndices();

    for (let copyIndex = 0; copyIndex < copyCount; copyIndex += 1) {
      const copiedPages = await bundledDocument.copyPages(sourceDocument, sourcePageIndexes);
      copiedPages.forEach(page => {
        bundledDocument.addPage(page);
      });
    }

    const bundledBytes = await bundledDocument.save();
    await fs.promises.writeFile(outputPdfPath, bundledBytes);
    return outputPdfPath;
  };

  const getRequestedCopies = requestBody => {
    const requestedCopies = parseInt(requestBody?.printCount || requestBody?.copyCount, 10);
    return Number.isFinite(requestedCopies) && requestedCopies > 0
      ? Math.min(requestedCopies, 50)
      : 1;
  };

  const getCliJobMeta = requestBody => ({
    tapeWidthMm: Number.isFinite(Number(requestBody?.tapeWidthMm))
      ? Number.parseInt(requestBody.tapeWidthMm, 10)
      : null,
    lengthMm: Number.isFinite(Number(requestBody?.lengthMm))
      ? Number.parseInt(requestBody.lengthMm, 10)
      : null,
    invertPrint: requestBody?.invertPrint === true
      || requestBody?.invertPrint === 'true'
      || requestBody?.invertPrint === '1',
  });

  const getTapeAreaSquareMm = jobMeta => {
    const tapeWidthMm = Number(jobMeta?.tapeWidthMm);
    const lengthMm = Number(jobMeta?.lengthMm);

    if (!Number.isFinite(tapeWidthMm) || tapeWidthMm <= 0 || !Number.isFinite(lengthMm) || lengthMm <= 0) {
      return null;
    }

    return tapeWidthMm * lengthMm;
  };

  const printPdfWithCopies = async ({
    filePath,
    printerConfig,
    copyCount = 1,
    jobMeta = {},
    bundledSourceType = 'upload-pdf-bundled',
  }) => {
    const normalizedCopyCount = Number.isFinite(copyCount) && copyCount > 0
      ? Math.min(copyCount, 50)
      : 1;
    const shouldBundleCopies = Boolean(
      printerConfig?.bundleCopies
      && normalizedCopyCount > 1
      && String(filePath || '').toLowerCase().endsWith('.pdf')
    );
    const sourcePageCount = String(filePath || '').toLowerCase().endsWith('.pdf')
      ? await getPdfPageCount(jobMeta.sourceFilePath || filePath).catch(() => null)
      : null;

    if (shouldBundleCopies) {
      const bundledPdfPath = buildBundledPdfPath(filePath, printerConfig);
      const sourceFilePath = jobMeta.sourceFilePath || filePath;

      await createBundledPdfCopy({
        sourceFilePath,
        outputPdfPath: bundledPdfPath,
        copyCount: normalizedCopyCount,
      });

      await printPDF(bundledPdfPath, printerConfig, {
        ...jobMeta,
        sourceFilePath,
        originalFilename: formatCopiedJobName(
          jobMeta.originalFilename || path.basename(sourceFilePath),
          normalizedCopyCount
        ),
        sourceType: bundledSourceType,
        totalCopies: normalizedCopyCount,
        bundledSourceCount: normalizedCopyCount,
        pages: Number.isInteger(sourcePageCount) ? sourcePageCount * normalizedCopyCount : null,
      });

      return 1;
    }

    await Promise.all(Array.from({ length: normalizedCopyCount }, (_, index) => (
      printPDF(filePath, printerConfig, {
        ...jobMeta,
        sourceFilePath: jobMeta.sourceFilePath || filePath,
        originalFilename: formatCopiedJobName(
          jobMeta.originalFilename || path.basename(filePath),
          normalizedCopyCount
        ),
        pages: sourcePageCount,
        copyIndex: normalizedCopyCount > 1 ? index + 1 : null,
        totalCopies: normalizedCopyCount > 1 ? normalizedCopyCount : null,
      })
    )));

    return 1;
  };

  const reprintLoggedJob = async ({
    printJob,
    printerConfig,
    fileKind,
    requestBody = {},
    sourceRoute = '/logs/reprint',
    jobMeta = {},
  }) => {
    const sourceFilePath = resolveLoggedPath(printJob?.sourceFilePath || printJob?.filePath || null);

    if (!sourceFilePath || !fs.existsSync(sourceFilePath)) {
      throw new Error('Source file is no longer available');
    }

    const copyCount = getRequestedCopies(requestBody);

    if (String(sourceFilePath || '').toLowerCase().endsWith('.pdf')) {
      return printPdfWithCopies({
        filePath: sourceFilePath,
        printerConfig,
        copyCount,
        bundledSourceType: 'log-reprint-bundled',
        jobMeta: {
          ...jobMeta,
          originalFilename: printJob.originalFilename || path.basename(sourceFilePath),
          sourceFilePath,
          sourceRoute,
          sourceType: 'log-reprint',
          chksum: printJob.chksum || null,
          tapeWidthMm: printJob.tapeWidthMm || null,
          lengthMm: printJob.lengthMm || null,
          isReprint: true,
          reprintSourceTimestamp: printJob.timestamp || null,
        },
      });
    }

    await Promise.all(Array.from({ length: copyCount }, (_, index) => (
      printPDF(sourceFilePath, printerConfig, {
        ...jobMeta,
        originalFilename: formatCopiedJobName(
          printJob.originalFilename || path.basename(sourceFilePath),
          copyCount
        ),
        sourceFilePath,
        sourceRoute,
        sourceType: 'log-reprint',
        chksum: printJob.chksum || null,
        pages: Number.isInteger(printJob.pages) ? printJob.pages : 1,
        tapeWidthMm: printJob.tapeWidthMm || null,
        lengthMm: printJob.lengthMm || null,
        isReprint: true,
        reprintSourceTimestamp: printJob.timestamp || null,
        copyIndex: copyCount > 1 ? index + 1 : null,
        totalCopies: copyCount > 1 ? copyCount : null,
      })
    )));

    return 1;
  };

  // Shared success/failure bookkeeping so each transport logs the same way.
  const recordPrintJob = async (filePath, printerConfig, result, jobMeta = {}, extra = {}) => {
    let chksum = extra.chksum ?? jobMeta.chksum ?? null;
    let fileSizeBytes = extra.fileSizeBytes ?? jobMeta.fileSizeBytes ?? null;
    let pages = extra.pages ?? jobMeta.pages ?? null;
    let paperAreaSquareMm = extra.paperAreaSquareMm ?? jobMeta.paperAreaSquareMm ?? null;
    const checksumFilePath = jobMeta.checksumFilePath || jobMeta.sourceFilePath || filePath;

    if (!chksum) {
      try {
        chksum = await jobSystem.createFileChecksum(checksumFilePath);
      } catch (error) {
        errorLogStamp('Checksum failed:', error.message);
      }
    }

    if (!Number.isFinite(fileSizeBytes) && filePath) {
      try {
        const fileStat = await fs.promises.stat(filePath);
        fileSizeBytes = fileStat.size;
      } catch (error) {
        errorLogStamp('File size lookup failed:', error.message);
      }
    }

    if (!Number.isInteger(pages) && filePath) {
      try {
        pages = await getPdfPageCount(filePath);
      } catch (error) {
        errorLogStamp('Page count lookup failed:', error.message);
      }
    }

    if (!Number.isFinite(paperAreaSquareMm)) {
      const pageAreaSquareMm = printerConfig?.isTape
        ? getTapeAreaSquareMm(jobMeta)
        : getPrinterPageAreaSquareMm(printerConfig);

      if (Number.isFinite(pageAreaSquareMm) && Number.isInteger(pages) && pages > 0) {
        paperAreaSquareMm = pageAreaSquareMm * pages;
      }
    }

    if (previewer && chksum) {
      await previewer.ensurePreviewForJob({
        checksum: chksum,
        sourceFilePath: checksumFilePath,
        sourceType: jobMeta.sourceType,
        bundledSourceCount: extra.bundledSourceCount ?? jobMeta.bundledSourceCount ?? null,
      });
    }

    const printJob = jobSystem.createJobLogEntry({
      filePath,
      printerConfig,
      testing,
      result,
      ...jobMeta,
      ...extra,
      fileSizeBytes,
      chksum,
      pages,
      paperAreaSquareMm,
    });

    try {
      await logStore.addPrintJob(printJob);
    } catch (error) {
      errorLogStamp('Print job log append failed:', error.message);
    }

    if (deduplicator) {
      try {
        await deduplicator.addPrintJob(printJob);
      } catch (error) {
        errorLogStamp('Checksum index append failed:', error.message);
      }
    }

    await serverSave.addPrintJob(printJob);
    return printJob;
  };

  const finishPrint = async (filePath, printerConfig, jobMeta, transportResponse) => {
    logStamp('Printing file:', filePath, `to printer: ${formatPrinterTarget(printerConfig)}`);
    await recordPrintJob(filePath, printerConfig, 'printed', jobMeta, { transportResponse });
  };

  const formatCommandForLog = (command, args = []) => (
    [command, ...args]
      .map(value => {
        const text = String(value ?? '');
        return /\s|["']/.test(text) ? JSON.stringify(text) : text;
      })
      .join(' ')
  );

  const logPlannedTransport = (filePath, printerConfig, jobMeta = {}) => {
    const platformPrinterConfig = resolvePlatformPrinterConfig(printerConfig);

    switch (platformPrinterConfig?.printMode) {
      case 'pdfToPrinter':
        logStamp('Planned print transport:', formatCommandForLog('pdf-to-printer', [
          '--printer',
          platformPrinterConfig.driverName,
          '--scale',
          'fit',
          '--landscape',
          'false',
          filePath,
        ]));
        return;
      case 'unixPrint':
      case 'lp': {
        const args = [];
        if (platformPrinterConfig.driverName) {
          args.push('-d', platformPrinterConfig.driverName);
        }
        args.push(filePath);
        logStamp('Planned print transport:', formatCommandForLog('lp', args));
        return;
      }
      case 'cli': {
        const cliArgs = (platformPrinterConfig.cliArgs || []).map(arg => (
          arg
            .replaceAll('{file}', filePath)
            .replaceAll('{tapeWidthMm}', jobMeta.tapeWidthMm ? String(jobMeta.tapeWidthMm) : '')
            .replaceAll('{lengthMm}', jobMeta.lengthMm ? String(jobMeta.lengthMm) : '')
        ));
        logStamp('Planned print transport:', formatCommandForLog(platformPrinterConfig.cliCommand, cliArgs));
        return;
      }
      case 'brother':
        logStamp('Planned print transport: brother-usb', filePath);
        return;
      default:
        return;
    }
  };

  const runPdfToPrinter = (filePath, printerConfig, done) => (
    (() => {
      const options = {
        printer: printerConfig.driverName,
        scale: 'fit',
        landscape: false,
      };

      logStamp('Running print transport:', formatCommandForLog('pdf-to-printer', [
        '--printer',
        options.printer,
        '--scale',
        options.scale,
        '--landscape',
        String(options.landscape),
        filePath,
      ]));

      return pdfToPrinter.print(filePath, options);
    })()
      .then(jobId => {
        done(null, jobId);
        return jobId;
      })
      .catch(error => {
        errorLogStamp('Printing failed:', error);
        done(error);
        throw error;
      })
  );

  const runUnixPrint = (filePath, printerConfig, done) => {
    const args = [];
    if (printerConfig.driverName) {
      args.push('-d', printerConfig.driverName);
    }
    args.push(filePath);

    logStamp('Running print transport:', formatCommandForLog('lp', args));

    return new Promise((resolve, reject) => {
      execFile('lp', args, (error, stdout, stderr) => {
        if (error) {
          errorLogStamp('Printing failed:', stderr || error.message);
          done(error);
          reject(error);
          return;
        }

        done(null, stdout);
        resolve(stdout);
      });
    });
  };

  const runCliPrint = (filePath, printerConfig, done, jobMeta = {}) => {
    const cliCommand = printerConfig.cliCommand;
    const cliArgs = (printerConfig.cliArgs || []).map(arg => (
      arg
        .replaceAll('{file}', filePath)
        .replaceAll('{tapeWidthMm}', jobMeta.tapeWidthMm ? String(jobMeta.tapeWidthMm) : '')
        .replaceAll('{lengthMm}', jobMeta.lengthMm ? String(jobMeta.lengthMm) : '')
    ));

    if (!cliCommand) {
      const error = new Error('CLI printMode requires cliCommand');
      done(error);
      return Promise.reject(error);
    }

    logStamp('Running print transport:', formatCommandForLog(cliCommand, cliArgs));

    return new Promise((resolve, reject) => {
      const child = spawn(cliCommand, cliArgs, { stdio: 'pipe' });
      let stderr = '';
      let stdout = '';

      child.stdout.on('data', chunk => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });

      child.on('error', error => {
        done(error);
        reject(error);
      });

      child.on('close', code => {
        if (code !== 0) {
          const error = new Error(stderr || `CLI print failed with code ${code}`);
          errorLogStamp('Printing failed:', error.message);
          done(error);
          reject(error);
          return;
        }

        done(null, stdout);
        resolve(stdout);
      });
    });
  };

  const runBrotherPrint = (filePath, printerConfig, done, jobMeta = {}) => {
    logStamp('Running print transport: brother-usb', filePath);

    return brotherService.print({
      filePath,
      printerConfig,
      tapeWidthMm: jobMeta.tapeWidthMm || 0,
      copies: jobMeta.totalCopies || 1,
    })
      .then(result => {
        done(null, JSON.stringify(result));
        return result;
      })
      .catch(error => {
        errorLogStamp('Brother print failed:', error.message);
        done(error);
        throw error;
      });
  };

  const printPdfItems = async ({ items, printerConfig, printCopies }) => {
    await Promise.all(items.map(item => (
      printPdfWithCopies({
        filePath: item.file.path,
        printerConfig,
        copyCount: printCopies,
        bundledSourceType: 'upload-pdf-bundled',
        jobMeta: {
          ...item.jobMeta,
          chksum: item.checksum || item.jobMeta.chksum || null,
        },
      })
    )));

    return items.length;
  };

  const printImageItems = async ({ items, printerConfig, printCopies }) => {
    if (!items.length) {
      return 0;
    }

    const cliPrefersPng = printerConfig.printMode === 'cli' && printerConfig.output === 'png';

    if (printCopies > 1) {
      if (items.length === 1) {
        logStamp(`Printing ${printCopies} labels`);
      } else {
        logStamp(`Printing ${items.length} image files with ${printCopies} copies each`);
      }
    }

    if (cliPrefersPng) {
      if (items.length > 1 || printCopies > 1) {
        const bundledFiles = items.flatMap(({ file }) => (
          Array.from({ length: printCopies }, () => file.path)
        ));
        const primaryItem = items[0];
        const bundledLengthMm = items.every(item => Number.isFinite(Number(item.jobMeta?.lengthMm)))
          ? items.reduce((total, item) => total + (Number(item.jobMeta.lengthMm) * printCopies), 0)
          : null;

        await converter
          .convertImgsToPng(
            bundledFiles,
            printerConfig,
            buildBundledImagePath(primaryItem.file.path, printerConfig),
            primaryItem.jobMeta
          )
          .then(outputImagePath => printPDF(outputImagePath, printerConfig, {
            ...primaryItem.jobMeta,
            originalFilename: items.length === 1
              ? `${primaryItem.file.originalname} x${printCopies}`
              : `${items.length} image files bundled`,
            checksumFilePath: outputImagePath,
            sourceFilePath: outputImagePath,
            sourceType: 'upload-image-bundled',
            totalCopies: printCopies > 1 ? printCopies : null,
            bundledSourceCount: bundledFiles.length,
            pages: bundledFiles.length,
            chksum: null,
            lengthMm: bundledLengthMm,
          }));

        return items.length;
      }

      await Promise.all(items.flatMap(item => (
        Array.from({ length: printCopies }, (_, index) => {
          const jobMeta = {
            ...item.jobMeta,
            chksum: item.checksum || item.jobMeta.chksum || null,
            pages: 1,
            copyIndex: printCopies > 1 ? index + 1 : null,
            totalCopies: printCopies > 1 ? printCopies : null,
          };

          if (!printerConfig.monochrome) {
            return printPDF(item.file.path, printerConfig, jobMeta);
          }

          return converter
            .convertImgsToPng(
              [item.file.path],
              printerConfig,
              buildPreparedImagePath(item.file.path, printerConfig),
              jobMeta
            )
            .then(outputImagePath => printPDF(outputImagePath, printerConfig, {
              ...jobMeta,
              checksumFilePath: outputImagePath,
              sourceFilePath: outputImagePath,
              chksum: null,
            }));
        })
      )));

      return items.length;
    }

    // Brother USB: the device is a single USB file handle — parallel writes
    // corrupt the job. Convert once and hand the copy count to the brother
    // service, which sends one complete job per copy sequentially on a single
    // open handle (waiting for each to settle) rather than racing N writes.
    if (printerConfig.printMode === 'brother') {
      const primaryItem = items[0];
      const outputPath = await converter.convertImgToPdf(
        primaryItem.file.path, printerConfig, undefined, primaryItem.jobMeta
      );
      await printPDF(outputPath, printerConfig, {
        ...primaryItem.jobMeta,
        chksum: primaryItem.checksum || primaryItem.jobMeta.chksum || null,
        pages: 1,
        totalCopies: printCopies > 1 ? printCopies : null,
      });
      return items.length;
    }

    if (printerConfig.bundleCopies && (items.length > 1 || printCopies > 1)) {
      const bundledFiles = items.flatMap(({ file }) => (
        Array.from({ length: printCopies }, () => file.path)
      ));
      const primaryItem = items[0];

      await converter
        .convertImgsToPdf(
          bundledFiles,
          printerConfig,
          buildBundledPdfPath(primaryItem.file.path, printerConfig),
          primaryItem.jobMeta
        )
        .then(outputPdfPath => printPDF(outputPdfPath, printerConfig, {
          ...primaryItem.jobMeta,
          originalFilename: items.length === 1
            ? `${primaryItem.file.originalname} x${printCopies}`
            : `${items.length} image files bundled`,
          checksumFilePath: primaryItem.file.path,
          sourceType: 'upload-image-bundled',
          totalCopies: printCopies > 1 ? printCopies : null,
          bundledSourceCount: bundledFiles.length,
          pages: bundledFiles.length,
          chksum: primaryItem.checksum || primaryItem.jobMeta.chksum || null,
        }));

      return items.length;
    }

    await Promise.all(items.flatMap(item => (
      Array.from({ length: printCopies }, (_, index) => (
        converter
          .convertImgToPdf(item.file.path, printerConfig, undefined, item.jobMeta)
          .then(outputPdfPath => printPDF(outputPdfPath, printerConfig, {
            ...item.jobMeta,
            chksum: item.checksum || item.jobMeta.chksum || null,
            pages: 1,
            copyIndex: printCopies > 1 ? index + 1 : null,
            totalCopies: printCopies > 1 ? printCopies : null,
          }))
      ))
    )));

    return items.length;
  };

  const printStagedItems = async ({
    items,
    fileKind,
    printerConfig,
    requestBody = {},
  }) => {
    if (!items.length) {
      return 0;
    }

    const itemsWithRequestMeta = items.map(item => ({
      ...item,
      jobMeta: {
        ...item.jobMeta,
        ...getCliJobMeta(requestBody),
      },
    }));

    if (fileKind === 'image') {
      return printImageItems({
        items: itemsWithRequestMeta,
        printerConfig,
        printCopies: getRequestedCopies(requestBody),
      });
    }

    return printPdfItems({
      items: itemsWithRequestMeta,
      printerConfig,
      printCopies: getRequestedCopies(requestBody),
    });
  };


  // ┌─────────────────┐
  // │  Print a PDF    │
  // └─────────────────┘
  const printPDF = (filePath, printerConfig, jobMetaOrCallback, callback) => {
    const { done, jobMeta } = resolvePrintArgs(jobMetaOrCallback, callback);
    const platformPrinterConfig = resolvePlatformPrinterConfig(printerConfig);
    const requiresDriverName = platformPrinterConfig?.printMode !== 'cli'
      && platformPrinterConfig?.printMode !== 'brother';
    const queueJobId = jobSystem?.startTrackedJob({
      id: buildQueueJobId(jobMeta) || jobSystem?.createJobId?.(),
      groupId: buildQueueGroupId(jobMeta),
      clientJobId: String(jobMeta?.clientJobId || '').trim() || null,
      printerId: platformPrinterConfig?.id || printerConfig?.id || null,
      originalFilename: jobMeta.originalFilename || path.basename(jobMeta.sourceFilePath || filePath || ''),
      sourceRoute: jobMeta.sourceRoute || null,
      sourceType: jobMeta.sourceType || null,
      copyIndex: jobMeta.copyIndex ?? null,
      totalCopies: jobMeta.totalCopies ?? null,
    });
    logStamp(
      '[id-debug] print start',
      `printer=${platformPrinterConfig?.id || printerConfig?.id || 'unknown'}`,
      `clientJobId=${jobMeta.clientJobId || 'none'}`,
      `queueJobId=${queueJobId || 'none'}`,
      `sourceRoute=${jobMeta.sourceRoute || 'none'}`,
      `file=${path.basename(jobMeta.sourceFilePath || filePath || '')}`
    );

    if (!platformPrinterConfig || (requiresDriverName && !platformPrinterConfig.driverName)) {
      const error = new Error('printPDF requires a printer object with a driverName for driver printing');
      if (queueJobId) {
        jobSystem.failTrackedJob(queueJobId, error, {
          printerId: platformPrinterConfig?.id || printerConfig?.id || null,
        });
      }
      done(error);
      return Promise.reject(error);
    }

    const testingEnabled = typeof getTesting === 'function' ? getTesting() : testing;
    logPlannedTransport(filePath, printerConfig, jobMeta);

    if (testingEnabled) {
      logStamp('Testing mode: skipped printing', filePath, `to printer: ${formatPrinterTarget(platformPrinterConfig)}`);
      return recordPrintJob(filePath, platformPrinterConfig, 'skipped-testing', jobMeta)
        .then(() => {
          if (queueJobId) {
            jobSystem.completeTrackedJob(queueJobId, {
              printerId: platformPrinterConfig.id || printerConfig?.id || null,
              message: 'Testing mode completed',
            });
          }
          done(null);
        })
        .catch(error => {
          if (queueJobId) {
            jobSystem.failTrackedJob(queueJobId, error, {
              printerId: platformPrinterConfig.id || printerConfig?.id || null,
            });
          }
          throw error;
        });
    }

    let printPromise;

    switch (platformPrinterConfig.printMode) {
      case 'pdfToPrinter':
        printPromise = runPdfToPrinter(filePath, platformPrinterConfig, done);
        break;
      case 'unixPrint':
      case 'lp':
        printPromise = runUnixPrint(filePath, platformPrinterConfig, done);
        break;
      case 'cli':
        printPromise = runCliPrint(filePath, platformPrinterConfig, done, jobMeta);
        break;
      case 'brother':
        printPromise = runBrotherPrint(filePath, platformPrinterConfig, done, jobMeta);
        break;
      default: {
        const error = new Error(`Unsupported printMode: ${platformPrinterConfig.printMode}`);
        done(error);
        return Promise.reject(error);
      }
    }

    return printPromise
      .then(async result => {
        await finishPrint(filePath, platformPrinterConfig, jobMeta, result);
        if (queueJobId) {
          jobSystem.completeTrackedJob(queueJobId, {
            printerId: platformPrinterConfig.id || printerConfig?.id || null,
          });
        }
        logStamp(
          '[id-debug] print success',
          `printer=${platformPrinterConfig?.id || printerConfig?.id || 'unknown'}`,
          `clientJobId=${jobMeta.clientJobId || 'none'}`,
          `queueJobId=${queueJobId || 'none'}`
        );
        return result;
      })
      .catch(async error => {
        await recordPrintJob(filePath, platformPrinterConfig, 'failed', jobMeta, { error });
        if (queueJobId) {
          jobSystem.failTrackedJob(queueJobId, error, {
            printerId: platformPrinterConfig.id || printerConfig?.id || null,
          });
        }
        errorLogStamp(
          '[id-debug] print failed',
          `printer=${platformPrinterConfig?.id || printerConfig?.id || 'unknown'}`,
          `clientJobId=${jobMeta.clientJobId || 'none'}`,
          `queueJobId=${queueJobId || 'none'}`,
          error.message
        );
        throw error;
      });
  };
  // ┌──────────────────────┐
  // │  Print label text    │
  // └──────────────────────┘
  const printLabelText = async (tapeSize, labelText) => {
    void spawn;
    throw new Error(`Label printing is not implemented for ${tapeSize}mm tape: ${labelText}`);
  };

    return {
      createFileChecksum: jobSystem.createFileChecksum,
      createPrinterConfig,
      printStagedItems,
      reprintLoggedJob,
      convertImgsToPdf: (imgFilePaths, printerConfig, pdfFilePath, jobMeta = {}) => (
      converter
        .convertImgsToPdf(imgFilePaths, printerConfig, pdfFilePath, jobMeta)
        .then(outputPdfPath => printPDF(outputPdfPath, printerConfig, jobMeta))
    ),
    convertImgToPdf: (imgFilePath, printerConfig, pdfFilePath, jobMeta = {}) => (
      converter
        .convertImgToPdf(imgFilePath, printerConfig, pdfFilePath, jobMeta)
        .then(outputPdfPath => printPDF(outputPdfPath, printerConfig, jobMeta))
    ),
    printBundledImages: (imgFilePaths, printerConfig, jobMeta = {}) => (
      converter
        .convertImgsToPdf(imgFilePaths, printerConfig, buildBundledPdfPath(imgFilePaths[0], printerConfig), jobMeta)
        .then(outputPdfPath => printPDF(outputPdfPath, printerConfig, {
          ...jobMeta,
          bundledSourceCount: imgFilePaths.length,
        }))
    ),
    prepareImageForPrinter,
    printLabelText,
    printPDF,
  };
};

module.exports = {
  createPrintingService,
};
