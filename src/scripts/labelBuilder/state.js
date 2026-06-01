// ╭──────────────────────────╮
// │  state.js                │
// │  Mutable builder session │
// │  state kept separate     │
// │  from DOM/canvas logic   │
// ╰──────────────────────────╯
(function () {
  const namespace = window.PrintifyLabelBuilder = window.PrintifyLabelBuilder || {};
  const constants = namespace.constants;

  // This is intentionally plain mutable state rather than a reactive layer.
  // The rest of the builder is event-driven and Fabric-centric already.
  const createBuilderState = () => ({
    currentPrinter: null,
    canvas: null,
    defaultTextbox: null,
    isSyncingFontInput: false,
    isSyncingFontSizeInput: false,
    isSyncingAutoFitInput: false,
    isSyncingAutoFitWidthInput: false,
    isSyncingTextSerialInput: false,
    isSyncingCodeSerialInput: false,
    isSyncingQrInput: false,
    qrUpdateTimer: null,
    pendingStateCommit: Promise.resolve(),
    isSerialPreviewActive: false,
    isMonochromePreviewActive: false,
    monochromePreviewUrl: null,
    monochromePreviewRequestId: 0,
    lastSelectedTextObject: null,
    lastSelectedCodeObject: null,
    lastSerialValue: 1,
    lastSerialDigits: constants.DEFAULT_SERIAL_DIGITS,
    lastBuilderStatePrinterKey: null,
    enterPrintArmed: false,
    enterPrintTimer: null,
    currentTapeWidthMm: null,
    currentTapeLengthMm: constants.DEFAULT_TAPE_LENGTH_MM,
    tapeMinimumLengthMm: constants.DEFAULT_TAPE_LENGTH_MM,
    tapeAutoLengthEnabled: true,
    invertPrintEnabled: false,
    currentViewportScale: 1,
    closeAnimationTimer: null,
    openAnimationFrame: null,
    templateModalOpen: false,
    templateModalTab: 'local',
    templateFeedbackTimer: null,
    remoteTemplatePath: '',
    localTemplates: [],
    remoteTemplates: [],
    remoteFolders: [],
    historyPast: [],
    historyFuture: [],
    isRestoringHistory: false,
    snapOverlayCanvas: null,
    snapOverlayContext: null,
    snapGuides: {
      vertical: null,
      horizontal: null,
    },
    snapLocks: {
      vertical: null,
      horizontal: null,
    },
  });

  namespace.state = {
    createBuilderState,
  };
}());
