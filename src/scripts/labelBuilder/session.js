// ╭──────────────────────────╮
// │  session.js              │
// │  Builder modal open/     │
// │  close/reset/restore     │
// │  flows                   │
// ╰──────────────────────────╯
(function () {
  const namespace = window.PrintifyLabelBuilder = window.PrintifyLabelBuilder || {};

  namespace.register('session', ctx => {
    const { refs, settings, state } = ctx;

    const applyPrinterCopy = printer => {
      if (refs.copy) {
        refs.copy.textContent = ctx.isTapePrinter(printer)
          ? `Build a tape label for ${printer.displayName}. Tape width sets label height, and length can expand to fit the content.`
          : `Build a label sized for ${printer.displayName}, then print it when you're ready.`;
      }
    };

    const resetCanvas = printer => {
      const builderCanvas = ctx.ensureCanvas();
      const { width, height } = ctx.getPrinterCanvasMetrics(printer);
      state.isSerialPreviewActive = false;
      state.isMonochromePreviewActive = false;
      ctx.hideMonochromePreview();

      // Reset always seeds the builder with the same textbox behavior as the
      // regular "Add Text" flow so the first object does not feel special.
      builderCanvas.clear();
      builderCanvas.setDimensions({ width, height });
      builderCanvas.backgroundColor = '#ffffff';

      state.defaultTextbox = ctx.createSeedTextbox();
      state.lastSelectedTextObject = state.defaultTextbox;
      state.lastSelectedCodeObject = null;
      builderCanvas.add(state.defaultTextbox);
      ctx.focusTextbox(state.defaultTextbox);
      ctx.beginTextboxEditing(state.defaultTextbox);
      ctx.updateCanvasControlAppearance();
      builderCanvas.requestRenderAll();
      ctx.applyCanvasViewportScale();
      ctx.syncTapeControls(printer);
      ctx.refreshBuilderMeta();
      applyPrinterCopy(printer);
      ctx.clearEnterPrintPrompt();
      ctx.syncPreviewButton();
      ctx.syncHistoryButtons();
      // Refine the auto-length canvas now that the seed textbox exists, so the
      // initial label fits its content without needing the toggle cycled.
      void ctx.syncAutoFitTapeCanvas();
      void ctx.resetHistory();
    };

    const restoreBuilderSession = printer => {
      const builderCanvas = ctx.ensureCanvas();
      const { width, height } = ctx.getPrinterCanvasMetrics(printer);

      builderCanvas.setDimensions({ width, height });
      builderCanvas.backgroundColor = '#ffffff';
      builderCanvas.getObjects().forEach(ctx.applyBuilderObjectDefaults);
      ctx.updateCanvasControlAppearance();
      ctx.applyCanvasViewportScale();
      ctx.syncTapeControls(printer);
      ctx.refreshBuilderMeta();
      applyPrinterCopy(printer);
      ctx.clearEnterPrintPrompt();
      ctx.syncPreviewButton();
      ctx.syncHistoryButtons();
      builderCanvas.requestRenderAll();
      ctx.syncTextControls(builderCanvas.getActiveObject() || null);
    };

    const closeTemplatesFirst = () => {
      if (state.templateModalOpen) {
        ctx.closeTemplateModal();
        return true;
      }

      return false;
    };

    const close = () => {
      if (closeTemplatesFirst()) {
        return;
      }

      ctx.clearEnterPrintPrompt();
      state.isSerialPreviewActive = false;
      void ctx.stopMonochromePreview();
      ctx.syncPreviewButton();
      ctx.syncHistoryButtons();
      ctx.utils.setClientOverlayActive('label-builder', false);
      window.clearTimeout(state.closeAnimationTimer);
      if (state.openAnimationFrame) {
        window.cancelAnimationFrame(state.openAnimationFrame);
        state.openAnimationFrame = null;
      }
      refs.root.classList.remove('is-open');
      refs.root.classList.add('is-closing');
      state.closeAnimationTimer = window.setTimeout(() => {
        refs.root.classList.remove('is-mounted', 'is-closing');
      }, ctx.constants.BUILDER_MODAL_CLOSE_MS);
    };

    const open = printer => {
      state.currentPrinter = printer;
      if (!state.currentPrinter) return;
      state.isMonochromePreviewActive = false;
      ctx.hideMonochromePreview();
      const nextPrinterKey = ctx.getPrinterStateKey(state.currentPrinter);
      const isRestoringSamePrinter = state.lastBuilderStatePrinterKey && state.lastBuilderStatePrinterKey === nextPrinterKey && ctx.ensureCanvas().getObjects().length > 0;

      // Re-opening the same printer intentionally preserves the current canvas
      // session so users can close the modal without losing in-progress work.
      if (!isRestoringSamePrinter) {
        state.currentTapeWidthMm = ctx.isTapePrinter(printer) ? ctx.utils.getResolvedDefaultTapeWidth(printer) : null;
        state.tapeMinimumLengthMm = ctx.constants.DEFAULT_TAPE_LENGTH_MM;
        state.tapeAutoLengthEnabled = true;
        // Seed the starting length from the auto floor (tape height) so the
        // first paint already reflects auto-length instead of the manual
        // default, which previously required toggling the option off and on.
        state.currentTapeLengthMm = ctx.isTapePrinter(printer)
          ? ctx.getAutoLengthFloorMm(printer)
          : ctx.constants.DEFAULT_TAPE_LENGTH_MM;
        state.invertPrintEnabled = Boolean(settings.getInvertPrintEnabled(printer?.id));
      }

      if (refs.title) refs.title.textContent = `${printer.displayName} Builder`;

      window.clearTimeout(state.closeAnimationTimer);
      refs.root.classList.remove('is-closing');
      refs.root.classList.add('is-mounted');
      ctx.utils.setClientOverlayActive('label-builder', true);
      if (isRestoringSamePrinter) {
        restoreBuilderSession(printer);
      } else {
        if (refs.copiesInput) refs.copiesInput.value = '1';
        resetCanvas(printer);
        state.lastBuilderStatePrinterKey = nextPrinterKey;
      }
      ctx.syncPreviewButton();
      ctx.syncHistoryButtons();
      state.openAnimationFrame = window.requestAnimationFrame(() => {
        ctx.applyCanvasViewportScale();
        state.openAnimationFrame = window.requestAnimationFrame(() => {
          refs.root.classList.add('is-open');
          state.openAnimationFrame = null;
        });
      });
    };

    return {
      close,
      open,
      resetCanvas,
      restoreBuilderSession,
    };
  });
}());
