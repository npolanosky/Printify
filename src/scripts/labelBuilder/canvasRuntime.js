// ╭──────────────────────────╮
// │  canvasRuntime.js        │
// │  Fabric canvas boot,     │
// │  viewport scaling, and   │
// │  shared canvas helpers   │
// ╰──────────────────────────╯
(function () {
  const namespace = window.PrintifyLabelBuilder = window.PrintifyLabelBuilder || {};
  const constants = namespace.constants;
  const utils = namespace.utils;

  namespace.register('canvasRuntime', ctx => {
    const { refs, settings, state } = ctx;

    const ensureSnapOverlay = () => {
      const builderCanvas = ensureCanvas();
      const container = builderCanvas.wrapperEl;

      if (!container) {
        return null;
      }

      if (state.snapOverlayCanvas && state.snapOverlayCanvas.isConnected) {
        return state.snapOverlayCanvas;
      }

      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.className = 'printify-builder__snap-overlay';
      overlayCanvas.setAttribute('aria-hidden', 'true');
      overlayCanvas.style.position = 'absolute';
      overlayCanvas.style.inset = '0';
      overlayCanvas.style.pointerEvents = 'none';
      overlayCanvas.style.zIndex = '2';
      overlayCanvas.style.borderRadius = '12px';
      overlayCanvas.style.display = 'block';
      container.style.position = container.style.position || 'relative';
      container.appendChild(overlayCanvas);

      state.snapOverlayCanvas = overlayCanvas;
      state.snapOverlayContext = overlayCanvas.getContext('2d');
      return overlayCanvas;
    };

    const syncSnapOverlayViewport = () => {
      const builderCanvas = ensureCanvas();
      const overlayCanvas = ensureSnapOverlay();
      const lowerCanvas = builderCanvas.lowerCanvasEl;

      if (!overlayCanvas || !lowerCanvas) {
        return;
      }

      const logicalWidth = Math.max(1, Math.round(builderCanvas.getWidth()));
      const logicalHeight = Math.max(1, Math.round(builderCanvas.getHeight()));
      const lowerCanvasRect = lowerCanvas.getBoundingClientRect();

      overlayCanvas.width = logicalWidth;
      overlayCanvas.height = logicalHeight;
      overlayCanvas.style.left = '0';
      overlayCanvas.style.top = '0';
      overlayCanvas.style.width = `${lowerCanvasRect.width}px`;
      overlayCanvas.style.height = `${lowerCanvasRect.height}px`;
    };

    const withCanvasTransitionMask = async work => {
      const builderCanvas = ensureCanvas();
      const container = builderCanvas.wrapperEl;
      const lowerCanvas = builderCanvas.lowerCanvasEl;
      const upperCanvas = builderCanvas.upperCanvasEl;
      const shell = refs.canvasShell;
      const wrap = refs.canvasWrap;

      if (!container || !lowerCanvas || !upperCanvas || !shell || !wrap) {
        return work();
      }

      let maskElement = null;
      const frozenElements = [wrap, shell, container, lowerCanvas, upperCanvas];
      const frozenDimensions = frozenElements.map(element => ({
        element,
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        inlineWidth: element.style.width,
        inlineHeight: element.style.height,
      }));

      try {
        const lowerCanvasRect = lowerCanvas.getBoundingClientRect();
        const snapshotUrl = lowerCanvas.toDataURL('image/png');
        const shellRect = shell.getBoundingClientRect();

        frozenDimensions.forEach(({ element, width, height }) => {
          element.style.width = `${width}px`;
          element.style.height = `${height}px`;
        });

        maskElement = document.createElement('img');
        maskElement.className = 'printify-builder__transition-mask';
        maskElement.alt = '';
        maskElement.setAttribute('aria-hidden', 'true');
        maskElement.src = snapshotUrl;
        maskElement.style.position = 'absolute';
        maskElement.style.left = `${lowerCanvasRect.left - shellRect.left}px`;
        maskElement.style.top = `${lowerCanvasRect.top - shellRect.top}px`;
        maskElement.style.width = `${lowerCanvasRect.width}px`;
        maskElement.style.height = `${lowerCanvasRect.height}px`;
        maskElement.style.pointerEvents = 'none';
        maskElement.style.zIndex = '4';
        maskElement.style.borderRadius = '12px';
        maskElement.style.display = 'block';
        shell.style.position = shell.style.position || 'relative';
        shell.appendChild(maskElement);
      } catch (error) {
        maskElement = null;
      }

      try {
        return await work();
      } finally {
        if (!maskElement) {
          return;
        }

        await new Promise(resolve => {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(resolve);
          });
        });
        maskElement.remove();
        frozenDimensions.forEach(({ element, inlineWidth, inlineHeight }) => {
          element.style.width = inlineWidth;
          element.style.height = inlineHeight;
        });
      }
    };

    const ensureCanvas = () => {
      if (state.canvas) {
        return state.canvas;
      }

      // Keep the canvas singleton inside builder state so multiple helper
      // modules can safely compose around the same Fabric instance.
      state.canvas = new window.fabric.Canvas(settings.canvasId, {
        preserveObjectStacking: true,
        backgroundColor: '#ffffff',
        enableRetinaScaling: false,
        uniformScaling: true,
        uniScaleKey: null,
      });
      syncSnapOverlayViewport();

      return state.canvas;
    };

    const getPreferredFontFamily = printerId => {
      const savedFontFamily = String(settings.getSavedFontFamily(printerId) || '').trim();
      return savedFontFamily || 'Arial';
    };

    const getCanvasControlSizing = () => {
      const pageZoom = Math.max(0.2, Number(window.visualViewport?.scale) || 1);
      const effectiveScale = Math.max((state.currentViewportScale || 1) * pageZoom, 0.12);
      const controlScale = Math.max(1, Math.min(5, 1 / effectiveScale));
      return {
        cornerSize: Math.round(constants.BUILDER_HANDLE_BASE_SIZE * controlScale),
        touchCornerSize: Math.round(constants.BUILDER_HANDLE_TOUCH_SIZE * controlScale),
      };
    };

    const updateCanvasControlAppearance = () => {
      const builderCanvas = ensureCanvas();
      const { cornerSize, touchCornerSize } = getCanvasControlSizing();

      builderCanvas.getObjects().forEach(object => {
        object.set({
          cornerSize,
          touchCornerSize,
        });
        object.setCoords();
      });
    };

    const syncMonochromePreviewViewport = () => {
      const builderCanvas = ensureCanvas();
      const container = builderCanvas.wrapperEl;

      if (!refs.canvasWrap || !container || !refs.monochromePreviewShell) {
        return;
      }

      refs.monochromePreviewShell.style.left = `${container.offsetLeft}px`;
      refs.monochromePreviewShell.style.top = `${container.offsetTop}px`;
      refs.monochromePreviewShell.style.width = `${container.offsetWidth}px`;
      refs.monochromePreviewShell.style.height = `${container.offsetHeight}px`;
    };

    const applyCanvasViewportScale = () => {
      const builderCanvas = ensureCanvas();
      const container = builderCanvas.wrapperEl;
      const lowerCanvas = builderCanvas.lowerCanvasEl;
      const upperCanvas = builderCanvas.upperCanvasEl;

      if (!refs.canvasShell || !container || !lowerCanvas || !upperCanvas) {
        return;
      }

      const logicalWidth = builderCanvas.getWidth();
      const logicalHeight = builderCanvas.getHeight();
      const shellStyles = window.getComputedStyle(refs.canvasShell);
      const horizontalPadding = (
        Number.parseFloat(shellStyles.paddingLeft || '0')
        + Number.parseFloat(shellStyles.paddingRight || '0')
      );
      const availableWidth = Math.max(240, refs.canvasShell.clientWidth - horizontalPadding);
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || logicalHeight;
      const availableHeight = Math.max(180, Math.floor(viewportHeight * 0.46));
      const displayScale = Math.min(1, availableWidth / logicalWidth, availableHeight / logicalHeight);
      const displayWidth = Math.max(1, logicalWidth * displayScale);
      const displayHeight = Math.max(1, logicalHeight * displayScale);
      state.currentViewportScale = displayScale;

      [container, lowerCanvas, upperCanvas].forEach(element => {
        element.style.width = `${displayWidth}px`;
        element.style.height = `${displayHeight}px`;
      });

      syncSnapOverlayViewport();
      updateCanvasControlAppearance();
      syncMonochromePreviewViewport();
      builderCanvas.calcOffset();
      builderCanvas.requestRenderAll();
    };

    const isCodeObject = object => object?.printifyObjectType === 'code';
    const isImageObject = object => object?.printifyObjectType === 'image';
    const isTapePrinter = printer => Boolean(printer?.isTape);

    const applyBuilderObjectDefaults = object => {
      if (!object) return object;
      const { cornerSize, touchCornerSize } = getCanvasControlSizing();
      const themeColors = utils.getBuilderThemeColors();

      // Rotation snapping is already part of current builder behavior, so it
      // stays in the shared object defaults even as positional snapping grows.
      object.set({
        transparentCorners: false,
        cornerStyle: 'circle',
        cornerColor: themeColors.accent,
        borderColor: themeColors.accent,
        borderScaleFactor: 2,
        cornerSize,
        touchCornerSize,
        snapAngle: constants.BUILDER_ROTATION_SNAP_ANGLE,
        snapThreshold: constants.BUILDER_ROTATION_SNAP_THRESHOLD,
      });

      if (object.controls?.mtr) {
        object.controls.mtr.cursorStyleHandler = () => 'grab';
      }

      return object;
    };

    const getCurrentTapeCanvasSize = printer => {
      const tapeWidthMm = state.currentTapeWidthMm || utils.getResolvedDefaultTapeWidth(printer) || 12;
      const tapeLengthMm = utils.normalizeTapeLengthMm(state.currentTapeLengthMm);
      const width = utils.mmToPixels(tapeLengthMm, printer?.density);
      // Cap the canvas height to the printer's physical head width when known.
      // This means selecting "24mm tape" on a printer with an 18mm head sizes
      // the canvas to 18mm (the printable area) rather than 24mm — the user
      // designs for what will actually print, not the full tape width.
      const maxPrintableMm = printer?.brotherMaxPrintableWidthMm || null;
      const effectiveTapeWidthMm = maxPrintableMm ? Math.min(tapeWidthMm, maxPrintableMm) : tapeWidthMm;
      const height = utils.mmToPixels(effectiveTapeWidthMm, printer?.density);

      return {
        width: Number.isFinite(width) ? width : constants.DEFAULT_CANVAS_SIZE.width,
        height: Number.isFinite(height) ? height : constants.DEFAULT_CANVAS_SIZE.height,
      };
    };

    const getTapeExportLengthMm = printer => (
      isTapePrinter(printer)
        ? utils.normalizeTapeLengthMm(state.currentTapeLengthMm)
        : null
    );

    const describeBuilderSize = printer => {
      const builderCanvas = ensureCanvas();

      if (!isTapePrinter(printer)) {
        return `${builderCanvas.getWidth()} x ${builderCanvas.getHeight()} px`;
      }

      const exportLengthMm = getTapeExportLengthMm(printer);
      const lengthLabel = state.tapeAutoLengthEnabled
        ? `${exportLengthMm}mm auto`
        : `${utils.normalizeTapeLengthMm(state.currentTapeLengthMm)}mm`;

      return `${state.currentTapeWidthMm}mm tape • ${lengthLabel} • ${builderCanvas.getWidth()} x ${builderCanvas.getHeight()} px`;
    };

    const refreshBuilderMeta = () => {
      if (state.currentPrinter && refs.size) {
        refs.size.textContent = describeBuilderSize(state.currentPrinter);
      }
    };

    const syncTapeControls = printer => {
      const tapeMode = isTapePrinter(printer);

      if (refs.tapeControls) {
        refs.tapeControls.hidden = !tapeMode;
        refs.tapeControls.style.display = tapeMode ? '' : 'none';
      }

      if (refs.invertWrap) {
        const showInvertToggle = tapeMode && Boolean(printer?.monochrome) && Number(printer?.monochromeBit) === 1;
        refs.invertWrap.hidden = !showInvertToggle;
      }

      if (!tapeMode) {
        return;
      }

      if (refs.tapeWidthSelect) {
        const printerTapes = Array.isArray(printer?.tapes) ? printer.tapes : [];
        const maxPrintableMm = printer?.brotherMaxPrintableWidthMm || null;
        refs.tapeWidthSelect.innerHTML = printerTapes.map(tapeWidth => {
          const printableMm = maxPrintableMm ? Math.min(tapeWidth, maxPrintableMm) : tapeWidth;
          const label = (maxPrintableMm && tapeWidth > maxPrintableMm)
            ? `${tapeWidth} mm (${printableMm} mm printable)`
            : `${tapeWidth} mm`;
          return `<option value="${tapeWidth}">${label}</option>`;
        }).join('');

        if (state.currentTapeWidthMm && printerTapes.includes(state.currentTapeWidthMm)) {
          refs.tapeWidthSelect.value = String(state.currentTapeWidthMm);
        }
      }

      if (refs.tapeLengthInput) {
        refs.tapeLengthInput.value = String(utils.normalizeTapeLengthMm(state.tapeMinimumLengthMm));
        // Disable manual length entry while auto-fit is active; the canvas
        // size is driven by content so a user-typed value would have no effect.
        refs.tapeLengthInput.disabled = state.tapeAutoLengthEnabled;
      }

      if (refs.tapeAutoLengthInput) {
        refs.tapeAutoLengthInput.checked = state.tapeAutoLengthEnabled;
      }

      if (refs.invertPrintInput) {
        refs.invertPrintInput.checked = state.invertPrintEnabled;
      }
    };

    const persistTapePreference = async printer => {
      if (!isTapePrinter(printer) || !state.currentTapeWidthMm) {
        return;
      }

      try {
        await fetch(`/printers/${encodeURIComponent(printer.id)}/preferences/tape`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tapeWidthMm: state.currentTapeWidthMm,
          }),
        });
      } catch (error) {
        // Keep tape preference persistence best-effort so the builder stays usable offline.
      }
    };

    const getContentBounds = () => {
      const builderCanvas = ensureCanvas();
      const objects = builderCanvas.getObjects().filter(object => !object.excludeFromExport);

      if (!objects.length) {
        return null;
      }

      const bounds = objects
        .map(object => object.getBoundingRect())
        .filter(boundary => Number.isFinite(boundary?.left) && Number.isFinite(boundary?.top));

      if (!bounds.length) {
        return null;
      }

      const right = Math.max(...bounds.map(boundary => boundary.left + boundary.width));
      const bottom = Math.max(...bounds.map(boundary => boundary.top + boundary.height));

      return { right, bottom };
    };

    const getRequiredTapeLengthMm = printer => {
      const bounds = getContentBounds();
      const density = Number(printer?.density);
      const paddingPx = utils.mmToPixels(constants.TAPE_EXPORT_PADDING_MM, density) || 0;

      if (!bounds || !Number.isFinite(density) || density <= 0) {
        return utils.normalizeTapeLengthMm(state.tapeMinimumLengthMm);
      }

      return Math.max(
        utils.normalizeTapeLengthMm(state.tapeMinimumLengthMm),
        Math.ceil(((bounds.right + paddingPx) / density) * 25.4)
      );
    };

    const getPrinterCanvasMetrics = printer => (
      isTapePrinter(printer)
        ? getCurrentTapeCanvasSize(printer)
        : utils.getPrinterCanvasSize(printer)
    );

    const applyTapeCanvasSize = async printer => {
      if (!printer || !isTapePrinter(printer)) {
        return;
      }

      // Tape printers can change label length dynamically, so this path clamps
      // existing objects back into the new pixel box after every resize.
      const builderCanvas = ensureCanvas();
      const { width, height } = getCurrentTapeCanvasSize(printer);

      builderCanvas.setDimensions({ width, height });
      builderCanvas.getObjects().forEach(object => {
        if (object instanceof window.fabric.Textbox) {
          object.frameWidth = Math.max(48, Math.min(object.frameWidth || object.width || 0, width));
          object.frameHeight = Math.max(32, Math.min(object.frameHeight || object.height || 0, height));
          object.width = object.frameWidth;
          if (object.autoFitText) {
            ctx.fitTextboxFontToFrame(object);
          } else {
            object.initDimensions();
          }
        }

        const bounds = object.getBoundingRect();
        const nextLeft = Math.max(0, Math.min(object.left || 0, width - bounds.width));
        const nextTop = Math.max(0, Math.min(object.top || 0, height - bounds.height));

        object.set({
          left: Math.round(nextLeft),
          top: Math.round(nextTop),
        });
        object.setCoords();
      });

      refreshBuilderMeta();
      applyCanvasViewportScale();
      builderCanvas.requestRenderAll();
      await persistTapePreference(printer);
    };

    // Keep the length input's disabled/value state in sync whenever the
    // auto-fit flag or the current length changes.  syncTapeControls only
    // runs on printer changes, so this must be called after any toggle.
    const syncLengthInputState = () => {
      if (!refs.tapeLengthInput) return;
      refs.tapeLengthInput.disabled = state.tapeAutoLengthEnabled;
      if (!state.tapeAutoLengthEnabled) {
        refs.tapeLengthInput.value = String(utils.normalizeTapeLengthMm(state.tapeMinimumLengthMm));
      }
    };

    const syncAutoFitTapeCanvas = async () => {
      if (!state.currentPrinter || !isTapePrinter(state.currentPrinter) || !state.tapeAutoLengthEnabled) {
        return;
      }

      const requiredLengthMm = getRequiredTapeLengthMm(state.currentPrinter);
      const nextLengthMm = Math.max(utils.normalizeTapeLengthMm(state.tapeMinimumLengthMm), requiredLengthMm);

      if (nextLengthMm === utils.normalizeTapeLengthMm(state.currentTapeLengthMm)) {
        refreshBuilderMeta();
        return;
      }

      state.currentTapeLengthMm = nextLengthMm;
      await applyTapeCanvasSize(state.currentPrinter);
    };

    const getPrinterStateKey = printer => String(printer?.id || printer?.key || printer?.name || printer?.displayName || '');

    const hasCanvasObject = object => Boolean(object) && ensureCanvas().getObjects().includes(object);

    const focusObject = object => {
      const builderCanvas = ensureCanvas();
      if (object instanceof window.fabric.Textbox) state.lastSelectedTextObject = object;
      if (isCodeObject(object)) state.lastSelectedCodeObject = object;
      builderCanvas.setActiveObject(object);
      ctx.syncTextControls(object || null);
      builderCanvas.requestRenderAll();
    };

    const getEditableTextObject = () => {
      const activeObject = ensureCanvas().getActiveObject();
      return activeObject instanceof window.fabric.Textbox ? activeObject : null;
    };

    const getEditableCodeObject = () => {
      const activeObject = ensureCanvas().getActiveObject();
      return isCodeObject(activeObject) ? activeObject : null;
    };

    const getTextboxForControls = () => {
      const activeTextbox = getEditableTextObject();
      if (activeTextbox) return activeTextbox;
      return hasCanvasObject(state.lastSelectedTextObject) ? state.lastSelectedTextObject : null;
    };

    const getCodeObjectForControls = () => {
      const activeCodeObject = getEditableCodeObject();
      if (activeCodeObject) return activeCodeObject;
      return hasCanvasObject(state.lastSelectedCodeObject) ? state.lastSelectedCodeObject : null;
    };

    const keepWorkingOnActiveObject = expectedType => {
      const activeObject = ensureCanvas().getActiveObject();
      if (!activeObject || activeObject instanceof window.fabric.ActiveSelection) return false;

      const typeMatches = (
        (expectedType === 'text' && activeObject instanceof window.fabric.Textbox) ||
        (expectedType === 'image' && isImageObject(activeObject)) ||
        (expectedType === 'code' && isCodeObject(activeObject))
      );

      if (!typeMatches) {
        return false;
      }

      focusObject(activeObject);
      return true;
    };

    const queueStateCommit = work => {
      // Selection changes can race against async code/image updates; serializing
      // commit work here avoids stale control state and export surprises.
      state.pendingStateCommit = state.pendingStateCommit
        .catch(() => {})
        .then(() => work());
      return state.pendingStateCommit;
    };

    const deleteActiveObject = () => {
      const builderCanvas = ensureCanvas();
      const activeObject = builderCanvas.getActiveObject();

      if (!activeObject) return false;
      if (activeObject instanceof window.fabric.ActiveSelection) {
        activeObject.getObjects().forEach(object => builderCanvas.remove(object));
      } else {
        if (activeObject === state.lastSelectedTextObject) state.lastSelectedTextObject = null;
        if (activeObject === state.lastSelectedCodeObject) state.lastSelectedCodeObject = null;
        builderCanvas.remove(activeObject);
      }

      builderCanvas.discardActiveObject();
      ctx.syncTextControls(null);
      builderCanvas.requestRenderAll();
      refreshBuilderMeta();
      void ctx.recordHistoryCheckpoint();
      return true;
    };

    const nudgeActiveObject = key => {
      const builderCanvas = ensureCanvas();
      const activeObject = builderCanvas.getActiveObject();

      if (!activeObject) return false;

      const delta = {
        ArrowUp: { left: 0, top: -1 },
        ArrowDown: { left: 0, top: 1 },
        ArrowLeft: { left: -1, top: 0 },
        ArrowRight: { left: 1, top: 0 },
      }[key];

      if (!delta) return false;

      const applyDelta = object => {
        object.set({
          left: Math.round((object.left || 0) + delta.left),
          top: Math.round((object.top || 0) + delta.top),
        });
        object.setCoords();
      };

      if (activeObject instanceof window.fabric.ActiveSelection) {
        activeObject.getObjects().forEach(applyDelta);
        activeObject.setCoords();
      } else {
        applyDelta(activeObject);
      }

      builderCanvas.requestRenderAll();
      refreshBuilderMeta();
      void syncAutoFitTapeCanvas().then(() => ctx.recordHistoryCheckpoint());
      return true;
    };

    return {
      applyBuilderObjectDefaults,
      applyCanvasViewportScale,
      applyTapeCanvasSize,
      deleteActiveObject,
      describeBuilderSize,
      ensureCanvas,
      focusObject,
      getCodeObjectForControls,
      getContentBounds,
      getCurrentTapeCanvasSize,
      getEditableCodeObject,
      getEditableTextObject,
      getPreferredFontFamily,
      getPrinterCanvasMetrics,
      getPrinterStateKey,
      getRequiredTapeLengthMm,
      getTapeExportLengthMm,
      getTextboxForControls,
      hasCanvasObject,
      isCodeObject,
      isImageObject,
      isTapePrinter,
      keepWorkingOnActiveObject,
      nudgeActiveObject,
      queueStateCommit,
      refreshBuilderMeta,
      syncAutoFitTapeCanvas,
      syncLengthInputState,
      syncMonochromePreviewViewport,
      syncSnapOverlayViewport,
      syncTapeControls,
      updateCanvasControlAppearance,
      withCanvasTransitionMask,
    };
  });
}());
