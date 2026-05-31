// ╭──────────────────────────╮
// │  printerManager.js       │
// │  Mutable runtime printer │
// │  registry and reloads    │
// ╰──────────────────────────╯
const fs = require('fs');
const {
  getNormalizedPrinters,
} = require('./configurator');

const createPrinterManager = ({
  runtimeConfig,
  printingService,
  serverSave,
  logStats,
  logStamp,
  errorLogStamp,
  onReload = () => {},
}) => {
  let configuredPrinters = {};
  let printerRegistry = {};
  let configWatcher = null;
  let watcherDebounceTimer = null;

  const rebuildRegistry = nextConfiguredPrinters => Object.fromEntries(
    Object.entries(nextConfiguredPrinters).map(([printerId, printerConfig]) => (
      [printerId, printingService.createPrinterConfig(printerId, printerConfig)]
    ))
  );

  const applyPrinters = nextConfiguredPrinters => {
    configuredPrinters = nextConfiguredPrinters;
    printerRegistry = rebuildRegistry(nextConfiguredPrinters);
    logStats?.syncPrinterRegistry?.(printerRegistry);
    serverSave?.setConfiguredPrinters?.(Object.keys(printerRegistry));
    serverSave?.syncPrinterCache?.();
  };

  const reload = reason => {
    const runtimeReloadResult = runtimeConfig?.reloadFromDisk
      ? runtimeConfig.reloadFromDisk()
      : { changes: [], options: {} };
    const parsedConfig = runtimeConfig?.readParsedConfig
      ? runtimeConfig.readParsedConfig()
      : {};
    const nextConfiguredPrinters = getNormalizedPrinters(parsedConfig);

    applyPrinters(nextConfiguredPrinters);
    onReload({
      type: 'printers-updated',
      reason: reason || 'reload',
      printerIds: Object.keys(printerRegistry),
      runtimeChanges: runtimeReloadResult.changes || [],
    });
    syncWatcher();

    return {
      printerIds: Object.keys(printerRegistry),
      printerCount: Object.keys(printerRegistry).length,
      changes: runtimeReloadResult.changes || [],
      runtimeChanges: runtimeReloadResult.changes || [],
    };
  };

  const stopWatching = () => {
    if (configWatcher) {
      configWatcher.close();
      configWatcher = null;
    }

    if (watcherDebounceTimer) {
      clearTimeout(watcherDebounceTimer);
      watcherDebounceTimer = null;
    }
  };

  const watchHandler = () => {
    if (watcherDebounceTimer) {
      clearTimeout(watcherDebounceTimer);
    }

    watcherDebounceTimer = setTimeout(() => {
      watcherDebounceTimer = null;

      try {
        reload('file-watch');
        logStamp('Reloaded printer config from file watch.');
      } catch (error) {
        errorLogStamp('Printer reload failed after file change:', error.message);
      }
    }, 180);
  };

  const syncWatcher = () => {
    const shouldWatch = Boolean(runtimeConfig?.getOption?.('fileWatchReload'));
    const configPath = runtimeConfig?.configPath;

    if (!shouldWatch || !configPath) {
      stopWatching();
      return;
    }

    if (configWatcher) {
      return;
    }

    configWatcher = fs.watch(configPath, watchHandler);
    configWatcher.on('error', error => {
      errorLogStamp('Config file watch failed:', error.message);
      stopWatching();
    });
  };

  applyPrinters(getNormalizedPrinters(runtimeConfig.readParsedConfig()));
  syncWatcher();

  return {
    getConfiguredPrinters: () => configuredPrinters,
    getPrinterRegistry: () => printerRegistry,
    getPrinterConfig(printerId) {
      return printerRegistry[String(printerId || '').trim()] || null;
    },
    hasPrinter(printerId) {
      return Boolean(printerRegistry[String(printerId || '').trim()]);
    },
    isPrinterOnline(printerId) {
      return serverSave?.isPrinterOnline
        ? serverSave.isPrinterOnline(String(printerId || '').trim())
        : true;
    },
    getVisiblePrinterRegistry() {
      // Every configured printer stays visible regardless of availability;
      // the UI surfaces an Offline badge (driven by isPrinterOnline) rather
      // than hiding printers that are unplugged or not responding.
      return printerRegistry;
    },
    reload,
    syncWatcher,
    stopWatching,
  };
};

module.exports = {
  createPrinterManager,
};
