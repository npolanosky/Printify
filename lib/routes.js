// ╭──────────────────────────╮
// │  routes.js               │
// │  Dynamic Express router  │
// │  for static pages, file  │
// │  uploads, and server     │
// │  metadata endpoints      │
// ╰──────────────────────────╯
const fs = require('fs');
const path = require('path');
const express = require('express');
const { resolveLoggedPath } = require('./filePaths');
const bwipjs = require('bwip-js');
const QRCode = require('qrcode');
const YAML = require('yaml');
const { buildPrinterIconResolver } = require('./icons');
const { compactObject } = require('./logger');
const { getNormalizedPrinters } = require('./configurator');
const { createLabelTemplateStore } = require('./labelTemplateStore');
const { DEFAULT_HEAD } = require('./brother/models');

const fileKindConfig = {
  pdf: {
    fieldName: 'pdfFile',
    sourceType: 'upload-pdf',
  },
  image: {
    fieldName: 'imgFile',
    sourceType: 'upload-image',
  },
  zip: {
    fieldName: 'zipFile',
    sourceType: 'upload-zip',
  },
};

const barcodeFormatConfig = {
  code128: {
    bcid: 'code128',
    scale: 3,
    height: 24,
  },
  code39: {
    bcid: 'code39',
    scale: 3,
    height: 24,
  },
  datamatrix: {
    bcid: 'datamatrix',
    scale: 6,
    height: 24,
  },
  pdf417: {
    bcid: 'pdf417',
    scale: 2,
    height: 20,
  },
  ean13: {
    bcid: 'ean13',
    scale: 3,
    height: 24,
  },
  upca: {
    bcid: 'upca',
    scale: 3,
    height: 24,
  },
};


// ┌────────────────────┐
// │  Route registrar   │
// └────────────────────┘
const registerRoutes = ({
  app,
  rootDir,
  staticDir,
  dataDir,
  configDir,
  configPath,
  iconsDir,
  labelTemplatesDir,
  printerManager,
  printingService,
  ingestService,
  previewer,
  serverSave,
  logStore,
  version,
  assistant,
  pluginLoader,
  runtimeConfig,
  reloadPrinters = null,
  errorLogStamp,
  logStamp,
  jobSystem,
}) => {
  const labelTemplateStore = createLabelTemplateStore({
    templatesDir: labelTemplatesDir || path.join(dataDir || rootDir, 'labelTemplates'),
  });
  const removeFileIfPresent = async filePath => {
    if (!filePath) return;

    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        errorLogStamp(`Temporary file cleanup failed for ${filePath}:`, error.message);
      }
    }
  };

  const printerIconResolver = buildPrinterIconResolver(iconsDir);
  const getPrinterRegistry = () => printerManager.getPrinterRegistry();
  const getVisiblePrinterRegistry = () => printerManager.getVisiblePrinterRegistry();
  const getPrinterConfig = printerId => printerManager.getPrinterConfig(printerId);
  const isPrinterOnline = printerId => printerManager.isPrinterOnline(printerId);
  const themesDir = path.join(staticDir || path.join(rootDir, 'src'), 'styles', 'themes');

  const formatPrinterLabel = printerConfig => (
    printerConfig.displayName || printerConfig.driverName || printerConfig.id
  );

  const formatThemeLabel = themeId => (
    String(themeId || '')
      .split(/[-_]+/g)
      .filter(Boolean)
      .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ') || 'Theme'
  );

  const listClientThemes = async () => {
    let themeFileNames = [];

    try {
      themeFileNames = await fs.promises.readdir(themesDir);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    return themeFileNames
      .filter(fileName => path.extname(fileName).toLowerCase() === '.css')
      .map(fileName => {
        const themeId = path.basename(fileName, '.css');

        return {
          value: themeId,
          label: formatThemeLabel(themeId),
          href: `/styles/themes/${fileName}`,
        };
      })
      .sort((leftTheme, rightTheme) => leftTheme.label.localeCompare(rightTheme.label));
  };

  const rejectOfflinePrinter = (res, printerId) => {
    res.status(423).json({
      error: `Printer "${printerId}" is offline`,
    });
  };

  const cleanupUploadedFiles = async uploadedFiles => {
    await Promise.all((uploadedFiles || []).map(file => removeFileIfPresent(file?.path)));
  };

  const handlePrinterUpload = async ({ req, res, printerId, fileKind, isMulti }) => {
    const printerConfig = getPrinterConfig(printerId);
    const uploadedFiles = isMulti ? (req.files || []) : (req.file ? [req.file] : []);
    let uploadedJobMetaList = [];

    if (!printerConfig) {
      await cleanupUploadedFiles(uploadedFiles);
      res.status(404).send('Printer not found');
      return;
    }

    if (!isPrinterOnline(printerId)) {
      await cleanupUploadedFiles(uploadedFiles);
      rejectOfflinePrinter(res, printerId);
      return;
    }

    if (!(printerConfig.acceptedKinds || []).includes(fileKind)) {
      await cleanupUploadedFiles(uploadedFiles);
      res.status(404).send('Printer route not found');
      return;
    }

    if (!uploadedFiles.length) {
      res.status(400).send('Missing upload');
      return;
    }

    try {
      uploadedJobMetaList = JSON.parse(req.body.jobMetaList || '[]');
      if (!Array.isArray(uploadedJobMetaList)) {
        uploadedJobMetaList = [];
      }
    } catch (error) {
      uploadedJobMetaList = [];
    }

    if (!uploadedJobMetaList.length && typeof req.body?.clientJobId === 'string' && req.body.clientJobId.trim()) {
      uploadedJobMetaList = [{
        clientJobId: req.body.clientJobId.trim(),
      }];
    }

    if (uploadedJobMetaList[0]?.clientJobId) {
      logStamp(
        '[id-debug] upload received',
        `printer=${printerId}`,
        `route=${req.path}`,
        `clientJobId=${uploadedJobMetaList[0].clientJobId}`,
        `files=${uploadedFiles.length}`
      );
    }

    try {
      const ingestResult = await ingestService.processUpload({
        requestPath: req.path,
        printerConfig,
        fileKind,
        uploadedFiles,
        uploadedJobMetaList,
        requestBody: req.body,
      });

      res.status(200).json(ingestResult);
    } catch (error) {
      errorLogStamp(`Upload route failed for ${req.path}:`, error.message);
      if (error?.code === 'INGEST_VALIDATION_FAILED') {
        res.status(error.status || 400).send(error.message || 'Upload could not be processed');
        return;
      }

      res.status(500).send('Print failed');
    }
  };

  const registerDynamicPrinterUploadRoute = (fileKind, mode) => {
    const kindConfig = fileKindConfig[fileKind];
    const isMulti = mode === 'multi';
    const routePath = `/:printerId/${fileKind}${isMulti ? '/multi' : ''}`;
    const assignPrinterId = (req, res, next) => {
      req.printifyPrinterId = String(req.params.printerId || '').trim();
      next();
    };
    const middleware = ingestService.createUploadMiddleware({
      fieldName: kindConfig.fieldName,
      isMulti,
    });

    app.post(routePath, assignPrinterId, middleware, async (req, res) => {
      await handlePrinterUpload({
        req,
        res,
        printerId: req.printifyPrinterId,
        fileKind,
        isMulti,
      });
    });
  };

  // ┌──────────────────┐
  // │  Static files    │
  // └──────────────────┘
  app.get('/files/:fileName', (req, res) => {
    const filePath = path.join(rootDir, req.params.fileName);

    res.sendFile(filePath, err => {
      if (err) {
        errorLogStamp(`Error sending file: ${err}`);
        res.status(err.status || 500).end();
      }
    });
  });

  app.get('/printers', (req, res) => {
    const serverData = serverSave.getData();
    const printerStatsById = serverData.printers || {};
    const printerList = Object.entries(getVisiblePrinterRegistry()).map(([printerId, printerConfig]) => ({
      ...(serverSave.getPrinterPreferences(printerId).lastTapeWidthMm
        ? { lastTapeWidthMm: serverSave.getPrinterPreferences(printerId).lastTapeWidthMm }
        : {}),
      id: printerId,
      displayName: formatPrinterLabel(printerConfig),
      driverName: printerConfig.driverName,
      printMode: printerConfig.printMode || null,
      output: printerConfig.output || null,
      acceptedKinds: printerConfig.acceptedKinds || [],
      iconUrl: printerIconResolver.getPrinterIconUrl(printerId, printerConfig),
      labelBuilder: Boolean(printerConfig.labelBuilder),
      bundleCopies: Boolean(printerConfig.bundleCopies),
      size: printerConfig.size || null,
      units: printerConfig.units || null,
      density: printerConfig.density || null,
      monochrome: Boolean(printerConfig.monochrome),
      monochromeBit: printerConfig.monochromeBit ?? null,
      monochromeDither: printerConfig.monochromeDither || null,
      isTape: Boolean(printerConfig.isTape),
      tapes: printerConfig.tapes || [],
      defaultTape: printerConfig.defaultTape || null,
      // For brother-mode tape printers, expose the physical print-head width
      // in mm so the label builder can size the canvas to the printable area
      // rather than the full tape width (which may include unused margins).
      // Uses the last-probed headWidthPx preference when available, falling
      // back to the 128px/180dpi default that covers most P-touch models.
      brotherMaxPrintableWidthMm: printerConfig.printMode === 'brother' && Boolean(printerConfig.isTape)
        ? (() => {
            const headWidthPx = serverSave.getPrinterPreferences(printerId).headWidthPx || DEFAULT_HEAD.headWidthPx;
            return Math.floor(headWidthPx * 25.4 / DEFAULT_HEAD.dpi);
          })()
        : null,
      sizePx: printerConfig.sizePx || null,
      sizePxWidth: printerConfig.sizePxWidth || null,
      sizePxHeight: printerConfig.sizePxHeight || null,
      printCounter: printerStatsById[printerId]?.printCounter ?? 0,
      pageCounter: printerStatsById[printerId]?.pageCounter ?? 0,
      actualPrintCounter: printerStatsById[printerId]?.actualPrintCounter ?? 0,
      actualPageCounter: printerStatsById[printerId]?.actualPageCounter ?? 0,
      testingPrintCounter: printerStatsById[printerId]?.testingPrintCounter ?? 0,
      testingPageCounter: printerStatsById[printerId]?.testingPageCounter ?? 0,
      paperAreaSquareMm: printerStatsById[printerId]?.paperAreaSquareMm ?? 0,
      actualPaperAreaSquareMm: printerStatsById[printerId]?.actualPaperAreaSquareMm ?? 0,
      testingPaperAreaSquareMm: printerStatsById[printerId]?.testingPaperAreaSquareMm ?? 0,
      online: printerStatsById[printerId]?.online !== false,
    }));

    res.status(200).json({
      printers: printerList,
    });
  });

  app.get('/themes', async (req, res) => {
    try {
      const themes = await listClientThemes();
      res.status(200).json({ themes });
    } catch (error) {
      errorLogStamp('Theme discovery failed:', error.message);
      res.status(500).json({
        error: 'Could not load themes',
      });
    }
  });

  app.post('/printers/:printerId/preferences/tape', (req, res) => {
    const printerId = String(req.params.printerId || '').trim();
    const printerConfig = getPrinterConfig(printerId);
    const tapeWidthMm = Number.parseInt(req.body?.tapeWidthMm, 10);

    if (!printerConfig || !printerConfig.isTape) {
      res.status(404).json({
        error: 'Tape printer not found',
      });
      return;
    }

    if (!isPrinterOnline(printerId)) {
      rejectOfflinePrinter(res, printerId);
      return;
    }

    if (!printerConfig.tapes.includes(tapeWidthMm)) {
      res.status(400).json({
        error: 'Unsupported tape width',
      });
      return;
    }

    const preferences = serverSave.setPrinterPreference(printerId, 'lastTapeWidthMm', tapeWidthMm);
    res.status(200).json({
      ok: true,
      preferences,
    });
  });

  app.get('/label-builder/templates/remote', (req, res) => {
    try {
      const result = labelTemplateStore.listDirectory(req.query.path || '');
      res.status(200).json(result);
    } catch (error) {
      const statusCode = /not found/i.test(error.message) ? 404 : 400;
      res.status(statusCode).json({
        error: error.message || 'Could not list remote templates',
      });
    }
  });

  app.get('/label-builder/templates/remote/file', (req, res) => {
    try {
      const template = labelTemplateStore.loadTemplate(req.query.path || '');
      res.status(200).json(template);
    } catch (error) {
      const statusCode = /not found/i.test(error.message) ? 404 : 400;
      res.status(statusCode).json({
        error: error.message || 'Could not load remote template',
      });
    }
  });

  app.post('/label-builder/templates/remote', (req, res) => {
    try {
      const result = labelTemplateStore.saveTemplate({
        directoryPath: req.body?.directoryPath || '',
        name: req.body?.name || '',
        document: req.body?.document || null,
        thumbnailDataUrl: req.body?.thumbnailDataUrl || null,
      });
      res.status(200).json({
        ok: true,
        ...result,
      });
    } catch (error) {
      errorLogStamp('Remote label template save failed:', error.message);
      res.status(400).json({
        error: error.message || 'Could not save remote template',
      });
    }
  });

  app.post('/label-builder/templates/remote/folders', (req, res) => {
    try {
      const result = labelTemplateStore.createFolder({
        directoryPath: req.body?.directoryPath || '',
        name: req.body?.name || '',
      });
      res.status(200).json({
        ok: true,
        ...result,
      });
    } catch (error) {
      errorLogStamp('Remote label template folder creation failed:', error.message);
      res.status(400).json({
        error: error.message || 'Could not create remote template folder',
      });
    }
  });

  app.delete('/label-builder/templates/remote/folders', (req, res) => {
    try {
      const result = labelTemplateStore.deleteFolder(req.query.path || '');
      res.status(200).json({
        ok: true,
        ...result,
      });
    } catch (error) {
      const statusCode = /not found/i.test(error.message) ? 404 : 400;
      errorLogStamp('Remote label template folder delete failed:', error.message);
      res.status(statusCode).json({
        error: error.message || 'Could not delete remote template folder',
      });
    }
  });

  app.delete('/label-builder/templates/remote/file', (req, res) => {
    try {
      const result = labelTemplateStore.deleteTemplate(req.query.path || '');
      res.status(200).json({
        ok: true,
        ...result,
      });
    } catch (error) {
      const statusCode = /not found/i.test(error.message) ? 404 : 400;
      errorLogStamp('Remote label template delete failed:', error.message);
      res.status(statusCode).json({
        error: error.message || 'Could not delete remote template',
      });
    }
  });

  app.post(
    '/printers/:printerId/preview/monochrome',
    ingestService.createUploadMiddleware({
      fieldName: 'imgFile',
      isMulti: false,
    }),
    async (req, res) => {
      const printerId = String(req.params.printerId || '').trim();
      const printerConfig = getPrinterConfig(printerId);
      const uploadedFile = req.file;

      if (!printerConfig) {
        await removeFileIfPresent(uploadedFile?.path);
        res.status(404).json({
          error: 'Printer not found',
        });
        return;
      }

      if (!isPrinterOnline(printerId)) {
        await removeFileIfPresent(uploadedFile?.path);
        rejectOfflinePrinter(res, printerId);
        return;
      }

      if (!printerConfig.monochrome) {
        await removeFileIfPresent(uploadedFile?.path);
        res.status(400).json({
          error: 'Printer is not configured for monochrome preview',
        });
        return;
      }

      if (!uploadedFile?.path) {
        res.status(400).json({
          error: 'Missing image upload',
        });
        return;
      }

      let outputImagePath = null;

      try {
        outputImagePath = await printingService.prepareImageForPrinter(uploadedFile.path, printerConfig, null, {
          invertPrint: req.body?.invertPrint === '1' || req.body?.invertPrint === 'true',
        });
        res.type('png');
        res.sendFile(outputImagePath, async err => {
          await removeFileIfPresent(uploadedFile.path);
          await removeFileIfPresent(outputImagePath);

          if (err && !res.headersSent) {
            errorLogStamp(`Preview send failed for printer "${printerId}":`, err.message);
            res.status(err.status || 500).end();
          }
        });
      } catch (error) {
        await removeFileIfPresent(uploadedFile.path);
        await removeFileIfPresent(outputImagePath);
        errorLogStamp(`Monochrome preview failed for printer "${printerId}":`, error.message);
        res.status(500).json({
          error: 'Could not prepare monochrome preview',
        });
      }
    }
  );

  app.get('/client-plugins', (req, res) => {
    res.status(200).json({
      plugins: pluginLoader?.getEnabledPluginList?.() || [],
    });
  });

  app.get('/client-plugins/:pluginId/library', (req, res) => {
    const pluginId = String(req.params.pluginId || '').trim();
    const pluginConfig = pluginLoader?.getPlugin?.(pluginId);

    if (!pluginConfig || !pluginLoader.isEnabled(pluginId)) {
      res.status(404).json({
        error: 'Client plugin not found',
      });
      return;
    }

    if (typeof pluginConfig.getLibrary !== 'function') {
      res.status(404).json({
        error: 'Client plugin library not found',
      });
      return;
    }

    res.status(200).json(pluginConfig.getLibrary());
  });

  app.get('/client-plugins/:pluginId/rom/:romId', (req, res) => {
    const pluginId = String(req.params.pluginId || '').trim();
    const romId = String(req.params.romId || '').trim();
    const pluginConfig = pluginLoader?.getPlugin?.(pluginId);

    if (!pluginConfig || !pluginLoader.isEnabled(pluginId)) {
      res.status(404).json({
        error: 'Client plugin not found',
      });
      return;
    }

    const romConfig = pluginConfig.findRom?.(romId);

    if (!romConfig || !fs.existsSync(romConfig.filePath)) {
      res.status(404).json({
        error: 'ROM not found on server',
      });
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.download(romConfig.filePath, romConfig.fileName);
  });

  app.get('/client-plugins/:pluginId/save/:romId/:slot', (req, res) => {
    const pluginId = String(req.params.pluginId || '').trim();
    const romId = String(req.params.romId || '').trim();
    const slotValue = req.params.slot;
    const pluginConfig = pluginLoader?.getPlugin?.(pluginId);

    if (!pluginConfig || !pluginLoader.isEnabled(pluginId)) {
      res.status(404).json({
        error: 'Client plugin not found',
      });
      return;
    }

    const saveTarget = pluginConfig.findSaveSlot?.(romId, slotValue);

    if (!saveTarget) {
      res.status(404).json({
        error: 'Save slot not found',
      });
      return;
    }

    if (!fs.existsSync(saveTarget.slot.filePath)) {
      res.status(204).end();
      return;
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(saveTarget.slot.filePath);
  });

  app.put('/client-plugins/:pluginId/save/:romId/:slot', express.raw({
    type: 'application/octet-stream',
    limit: '2mb',
  }), (req, res) => {
    const pluginId = String(req.params.pluginId || '').trim();
    const romId = String(req.params.romId || '').trim();
    const slotValue = req.params.slot;
    const pluginConfig = pluginLoader?.getPlugin?.(pluginId);

    if (!pluginConfig || !pluginLoader.isEnabled(pluginId)) {
      res.status(404).json({
        error: 'Client plugin not found',
      });
      return;
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({
        error: 'Missing save payload',
      });
      return;
    }

    const saveTarget = pluginConfig.findSaveSlot?.(romId, slotValue);

    if (!saveTarget) {
      res.status(404).json({
        error: 'Save slot not found',
      });
      return;
    }

    try {
      fs.mkdirSync(path.dirname(saveTarget.slot.filePath), { recursive: true });
      fs.writeFileSync(saveTarget.slot.filePath, req.body);
      res.status(200).json({
        ok: true,
        bytes: req.body.length,
        fileName: saveTarget.slot.fileName,
        romId: saveTarget.rom.id,
        slot: saveTarget.slot.slot,
      });
    } catch (error) {
      errorLogStamp(`Save write failed for client plugin "${pluginId}":`, error.message);
      res.status(500).json({
        error: 'Could not persist save file',
      });
    }
  });

  app.get('/label-builder/code', async (req, res) => {
    const codeText = String(req.query.text || '').trim();
    const codeFormat = String(req.query.format || 'qrcode').trim().toLowerCase();
    const requestedSize = Number.parseInt(req.query.size, 10);
    const codeSize = Number.isFinite(requestedSize)
      ? Math.min(Math.max(requestedSize, 128), 1024)
      : 384;

    if (!codeText) {
      res.status(400).send('Missing code text');
      return;
    }

    try {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');

      if (barcodeFormatConfig[codeFormat]) {
        const barcodeConfig = barcodeFormatConfig[codeFormat];
        const barcodeBuffer = await bwipjs.toBuffer({
          bcid: barcodeConfig.bcid,
          text: codeText,
          scale: barcodeConfig.scale,
          height: barcodeConfig.height,
          includetext: false,
          backgroundcolor: 'FFFFFF',
        });

        res.send(barcodeBuffer);
        return;
      }

      const qrBuffer = await QRCode.toBuffer(codeText, {
        errorCorrectionLevel: 'M',
        margin: 1,
        type: 'png',
        width: codeSize,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });

      res.send(qrBuffer);
    } catch (error) {
      errorLogStamp('Code image generation failed:', error.message);
      res.status(500).send('Code image generation failed');
    }
  });

  app.get('/', (req, res) => {
    const indexPagePath = path.join(rootDir, 'src', 'pages', 'index.html');

    res.sendFile(indexPagePath, err => {
      if (err) {
        errorLogStamp(`Error sending index page: ${err}`);
        res.status(err.status || 500).end();
      }
    });
  });

  // ┌─────────────────────┐
  // │  Printer routes     │
  // └─────────────────────┘
  Object.keys(fileKindConfig).forEach(fileKind => {
    registerDynamicPrinterUploadRoute(fileKind, 'single');
    registerDynamicPrinterUploadRoute(fileKind, 'multi');
  });

  app.post('/ingest/:sessionId/confirm', async (req, res) => {
    const sessionId = String(req.params.sessionId || '').trim();
    const approvedItemIds = Array.isArray(req.body?.approvedItemIds)
      ? req.body.approvedItemIds.map(value => String(value))
      : [];

    if (!sessionId) {
      res.status(400).json({
        error: 'Missing session id',
      });
      return;
    }

    try {
      const result = await ingestService.confirmPendingDuplicates({
        sessionId,
        approvedItemIds,
      });

      res.status(200).json(result);
    } catch (error) {
      if (error.code === 'SESSION_NOT_FOUND') {
        res.status(404).json({
          error: 'Pending ingest session not found',
        });
        return;
      }

      errorLogStamp('Pending ingest confirmation failed:', error.message);
      res.status(500).json({
        error: 'Could not confirm duplicate upload',
      });
    }
  });


  // ┌────────────────────────┐
  // │  Label-maker routes    │
  // └────────────────────────┘
  app.post('/labelmake', async (req, res) => {
    const tapeSize = parseInt(req.body.tapeSize || req.body.tapesize, 10);
    const labelText = (req.body.text || '').toString().replace(/\s+/g, ' ').trim();

    if (!labelText) {
      res.status(400).send('Missing label text');
      return;
    }

    if (![12, 24].includes(tapeSize)) {
      res.status(400).send('Invalid tape size');
      return;
    }

    try {
      await printingService.printLabelText(tapeSize, labelText);
      res.status(200).send('OK');
    } catch (error) {
      errorLogStamp('Label printing failed:', error.message);
      res.status(500).send('Print failed');
    }
  });
  // ┌────────────────────┐
  // │  Server metadata   │
  // └────────────────────┘
  app.get('/logs/recent', async (req, res) => {
    const requestedLookBack = Number.parseInt(req.query.lookBack, 10);
    const lookBackMinutes = Number.isFinite(requestedLookBack)
      ? Math.min(Math.max(requestedLookBack, 1), 7 * 24 * 60)
      : 60;
    try {
      const recentJobs = (await logStore.getRecentJobs({ lookBackMinutes }))
        .map(job => {
          const previewChecksum = job.chksum || null;

          return compactObject({
            jobId: job.jobId || null,
            timestamp: job.timestamp,
            printerId: job.printerId,
            printerName: job.printerName,
            displayName: getPrinterRegistry()[job.printerId]?.displayName || job.printerName,
            iconUrl: printerIconResolver.getPrinterIconUrl(job.printerId, {
              driverName: job.printerName,
            }),
            printMode: job.printMode || null,
            originalFilename: job.originalFilename,
            filePath: job.filePath || null,
            sourceFilePath: job.sourceFilePath || null,
            fileSizeBytes: job.fileSizeBytes ?? null,
            chksum: job.chksum || null,
            isReprint: Boolean(job.isReprint || job.sourceType === 'log-reprint'),
            reprintSourceTimestamp: job.reprintSourceTimestamp || null,
            previewUrl: previewer && previewer.hasPreview(previewChecksum)
              ? previewer.getPreviewUrl(previewChecksum)
              : null,
            thumbnailUrl: previewer && previewer.hasThumbnail(previewChecksum)
              ? previewer.getThumbnailUrl(previewChecksum)
              : null,
            testing: Boolean(job.testing),
            result: job.result || null,
            sourceType: job.sourceType || null,
            sourceRoute: job.sourceRoute || null,
            sourceArchiveName: job.sourceArchiveName || null,
            bundledSourceCount: job.bundledSourceCount ?? null,
            pages: job.pages ?? null,
            copyIndex: job.copyIndex ?? null,
            totalCopies: job.totalCopies ?? null,
            transportResponse: job.transportResponse || null,
            error: job.error || null,
          });
        });

      res.status(200).json({
        jobs: recentJobs,
        windowMinutes: lookBackMinutes,
      });
    } catch (error) {
      errorLogStamp('Recent log lookup failed:', error.message);
      res.status(500).json({
        error: 'Could not load recent log data',
      });
    }
  });

  app.get('/preview/:checksum', (req, res) => {
    const checksum = String(req.params.checksum || '').trim().toLowerCase();

    if (!/^[a-f0-9]{64}$/.test(checksum)) {
      res.status(400).send('Invalid preview checksum');
      return;
    }

    if (!previewer || !previewer.hasPreview(checksum)) {
      res.status(404).send('Preview not found');
      return;
    }

    res.sendFile(previewer.getPreviewPath(checksum), err => {
      if (err) {
        errorLogStamp(`Error sending preview: ${err.message}`);
        if (!res.headersSent) {
          res.status(err.status || 500).end();
        }
      }
    });
  });

  app.get('/preview-thumb/:checksum', (req, res) => {
    const checksum = String(req.params.checksum || '').trim().toLowerCase();

    if (!/^[a-f0-9]{64}$/.test(checksum)) {
      res.status(400).send('Invalid preview checksum');
      return;
    }

    if (!previewer || !previewer.hasThumbnail(checksum)) {
      res.status(404).send('Preview thumbnail not found');
      return;
    }

    res.sendFile(previewer.getThumbnailPath(checksum), err => {
      if (err) {
        errorLogStamp(`Error sending preview thumbnail: ${err.message}`);
        if (!res.headersSent) {
          res.status(err.status || 500).end();
        }
      }
    });
  });

  app.get('/logs/original', async (req, res) => {
    const chksum = String(req.query.chksum || '').trim().toLowerCase();
    const beforeTimestamp = String(req.query.beforeTimestamp || '').trim();

    if (!chksum) {
      res.status(400).json({
        error: 'Missing checksum',
      });
      return;
    }

    try {
      const originalJob = await logStore.findOriginalJob({
        chksum,
        beforeTimestamp: beforeTimestamp || null,
      });
      const previewChecksum = originalJob?.chksum || null;

      if (!originalJob) {
        res.status(404).json({
          error: 'Original log entry not found',
        });
        return;
      }

      res.status(200).json({
        job: compactObject({
          jobId: originalJob.jobId || null,
          timestamp: originalJob.timestamp,
          printerId: originalJob.printerId,
          printerName: originalJob.printerName,
          displayName: getPrinterRegistry()[originalJob.printerId]?.displayName || originalJob.printerName,
          iconUrl: printerIconResolver.getPrinterIconUrl(originalJob.printerId, {
            driverName: originalJob.printerName,
          }),
          printMode: originalJob.printMode || null,
          originalFilename: originalJob.originalFilename,
          filePath: originalJob.filePath || null,
          sourceFilePath: originalJob.sourceFilePath || null,
          chksum: originalJob.chksum || null,
          isReprint: Boolean(originalJob.isReprint || originalJob.sourceType === 'log-reprint'),
          reprintSourceTimestamp: originalJob.reprintSourceTimestamp || null,
          previewUrl: previewer && previewer.hasPreview(previewChecksum)
            ? previewer.getPreviewUrl(previewChecksum)
            : null,
          testing: Boolean(originalJob.testing),
          result: originalJob.result || null,
          sourceType: originalJob.sourceType || null,
          sourceRoute: originalJob.sourceRoute || null,
          sourceArchiveName: originalJob.sourceArchiveName || null,
          bundledSourceCount: originalJob.bundledSourceCount ?? null,
          pages: originalJob.pages ?? null,
          copyIndex: originalJob.copyIndex ?? null,
          totalCopies: originalJob.totalCopies ?? null,
          transportResponse: originalJob.transportResponse || null,
          error: originalJob.error || null,
        }),
      });
    } catch (error) {
      errorLogStamp('Original log lookup failed:', error.message);
      res.status(500).json({
        error: 'Could not resolve original log entry',
      });
    }
  });

  // Logged reprints should stay on the shared print path so testing mode and
  // audit metadata behave the same way as fresh uploads.
  app.post('/logs/reprint', async (req, res) => {
    const timestamp = String(req.body.timestamp || '').trim();
    const printerId = String(req.body.printerId || '').trim();
    const chksum = String(req.body.chksum || '').trim().toLowerCase();
    const clientJobId = String(req.body.clientJobId || '').trim() || null;
    const copyCount = Number.parseInt(req.body.copyCount, 10);
    const normalizedCopyCount = Number.isFinite(copyCount)
      ? Math.min(Math.max(copyCount, 1), 50)
      : 1;
    const printJob = await logStore.findPrintJob({ timestamp, printerId, chksum });
    const printerConfig = getPrinterConfig(printerId);

    if (!printJob) {
      res.status(404).send('Logged job not found');
      return;
    }

    if (!printerConfig) {
      res.status(404).send('Printer not found');
      return;
    }

    if (!isPrinterOnline(printerId)) {
      rejectOfflinePrinter(res, printerId);
      return;
    }

    const reprintSourcePath = resolveLoggedPath(printJob.sourceFilePath || printJob.filePath);

    if (!reprintSourcePath || !fs.existsSync(reprintSourcePath)) {
      res.status(410).send('Source file is no longer available');
      return;
    }

    try {
      if (clientJobId) {
        logStamp(
          '[id-debug] reprint request received',
          `printer=${printerId}`,
          `clientJobId=${clientJobId}`,
          `timestamp=${timestamp}`,
          `copyCount=${normalizedCopyCount}`
        );
      }

      await printingService.reprintLoggedJob({
        printJob,
        printerConfig,
        fileKind: 'pdf',
        requestBody: {
          copyCount: normalizedCopyCount,
        },
        sourceRoute: '/logs/reprint',
        jobMeta: {
          clientJobId,
        },
      });

      res.status(200).json({
        ok: true,
        copyCount: normalizedCopyCount,
      });
    } catch (error) {
      errorLogStamp('Logged reprint failed:', error.message);
      res.status(500).send('Reprint failed');
    }
  });

  app.get('/version', (req, res) => {
    const pageHits = serverSave.incrementPageHits();
    const {
      printCounter,
      pageCounter,
      actualPrintCounter,
      actualPageCounter,
      testingPrintCounter,
      testingPageCounter,
      paperAreaSquareMm,
      actualPaperAreaSquareMm,
      testingPaperAreaSquareMm,
      lastStartedAt,
      lastPrintAt,
      lastPrintJob,
      dailyStats,
      printers,
      dataVersion,
    } = serverSave.getData();
    const assistantPlugin = pluginLoader?.getPlugin?.('assistant') || null;
    const configuredAssistant = assistantPlugin?.getMascot?.() || assistant;
    const assistantPluginEnabled = assistantPlugin?.isEnabled?.() !== false;
    const testingEnabled = runtimeConfig
      ? runtimeConfig.getOption('testing')
      : false;

    res.status(200).json({
      version,
      assistant: assistantPluginEnabled ? configuredAssistant : 'none',
      testing: Boolean(testingEnabled),
      printCounter: Math.floor(printCounter / 50) * 50,
      exactPrintCounter: printCounter,
      pageCounter,
      actualPrintCounter,
      actualPageCounter,
      testingPrintCounter,
      testingPageCounter,
      paperAreaSquareMm,
      actualPaperAreaSquareMm,
      testingPaperAreaSquareMm,
      pageHits,
      lastStartedAt,
      lastPrintAt,
      lastPrintJob,
      dailyStats,
      printers,
      dataVersion,
      activeJobs: jobSystem?.getActiveJobs?.() || [],
    });
  });

  app.get('/config', (req, res) => {
    try {
      const rawConfig = runtimeConfig
        ? runtimeConfig.readRawConfig()
        : fs.readFileSync(configPath, 'utf8');

      res.status(200).json({
        rawConfig,
      });
    } catch (error) {
      errorLogStamp('Config read failed:', error.message);
      res.status(500).json({
        error: 'Could not read config/config.yaml',
      });
    }
  });

  app.post('/config', (req, res) => {
    try {
      const rawConfig = String(req.body.rawConfig || '');

      if (!rawConfig.trim()) {
        res.status(400).json({
          error: 'Config content cannot be empty',
        });
        return;
      }

      const parsedConfig = YAML.parse(rawConfig);
      getNormalizedPrinters(parsedConfig);

      if (runtimeConfig) {
        runtimeConfig.saveRawConfig(rawConfig);
      } else {
        fs.writeFileSync(configPath, rawConfig.endsWith('\n') ? rawConfig : `${rawConfig}\n`, 'utf8');
      }

      const reloadResult = typeof reloadPrinters === 'function'
        ? reloadPrinters('config-save')
        : null;

      res.status(200).json({
        ok: true,
        reloaded: Boolean(reloadResult),
      });
    } catch (error) {
      errorLogStamp('Config save failed:', error.message);
      res.status(400).json({
        error: `Config save failed: ${error.message}`,
      });
    }
  });

  app.post('/config/reload', (req, res) => {
    try {
      const reloadResult = typeof reloadPrinters === 'function'
        ? reloadPrinters('http')
        : null;

      res.status(200).json({
        ok: true,
        printerCount: reloadResult?.printerCount ?? Object.keys(getPrinterRegistry()).length,
        runtimeChanges: reloadResult?.runtimeChanges ?? [],
      });
    } catch (error) {
      errorLogStamp('Config reload failed:', error.message);
      res.status(400).json({
        error: `Config reload failed: ${error.message}`,
      });
    }
  });

  // Resolve top-level page slugs like /logs to matching src/pages/*.html files.
  app.get('/:pageName', (req, res, next) => {
    const pageFilePath = path.join(rootDir, 'src', 'pages', `${req.params.pageName}.html`);

    if (!fs.existsSync(pageFilePath)) {
      next();
      return;
    }

    res.sendFile(pageFilePath, err => {
      if (err) {
        errorLogStamp(`Error sending page: ${err}`);
        res.status(err.status || 500).end();
      }
    });
  });
};

module.exports = {
  registerRoutes,
};
