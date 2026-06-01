// ╭──────────────────────────╮
// │  objects/textbox.js      │
// │  Textbox creation, frame │
// │  behavior, autofit, and  │
// │  serial-aware text state │
// ╰──────────────────────────╯
(function () {
  const namespace = window.PrintifyLabelBuilder = window.PrintifyLabelBuilder || {};

  namespace.register('textboxObjects', ctx => {
    const { state } = ctx;
    const getTextboxThemeColors = () => ctx.utils.getBuilderThemeColors();

    const ensureTextboxSerialState = textbox => {
      if (!(textbox instanceof window.fabric.Textbox)) return textbox;

      textbox.serialEnabled = Boolean(textbox.serialEnabled);
      textbox.serialCurrentValue = ctx.utils.normalizeSerialValue(textbox.serialCurrentValue);
      if (typeof textbox.serialTemplateText !== 'string') {
        textbox.serialTemplateText = String(textbox.text || '');
      }

      return textbox;
    };

    const fitTextboxFontToFrame = textObject => {
      if (!(textObject instanceof window.fabric.Textbox)) return;
      if (!textObject.autoFitText) return;
      if (!textObject.text?.trim()) return;

      const minSize = 8;
      const configuredMaxSize = Number.isFinite(textObject.maxAutoFitFontSize)
        ? Math.round(textObject.maxAutoFitFontSize)
        : Math.round(textObject.fontSize || minSize);
      const frameMaxSize = Math.round((textObject.frameHeight || textObject.height || 0) * 0.6);
      const maxSize = Math.max(minSize, Math.min(configuredMaxSize, frameMaxSize));
      const availableWidth = Math.max(12, (textObject.frameWidth || textObject.width) - (textObject.padding * 2));
      const availableHeight = Math.max(12, (textObject.frameHeight || textObject.height) - (textObject.padding * 2));
      const lockedLeft = textObject.left;
      const lockedTop = textObject.top;

      const measure = () => {
        textObject.set('width', textObject.frameWidth || textObject.width);
        textObject.initDimensions();
        const lineWidths = Array.isArray(textObject.__lineWidths) ? textObject.__lineWidths : [];
        const maxLineWidth = lineWidths.length ? Math.max(...lineWidths) : 0;
        const textHeight = typeof textObject.measureTextHeight === 'function' ? textObject.measureTextHeight() : textObject.height;

        return {
          maxLineWidth,
          textHeight,
        };
      };

      let nextSize = Math.max(minSize, Math.min(maxSize, Math.round(textObject.fontSize || minSize)));
      textObject.set('fontSize', nextSize);
      let metrics = measure();

      while (nextSize > minSize && (metrics.maxLineWidth > availableWidth || metrics.textHeight > availableHeight)) {
        nextSize -= 1;
        textObject.set('fontSize', nextSize);
        metrics = measure();
      }

      while (nextSize < maxSize) {
        textObject.set('fontSize', nextSize + 1);
        const nextMetrics = measure();
        if (nextMetrics.maxLineWidth > availableWidth || nextMetrics.textHeight > availableHeight) break;
        nextSize += 1;
        metrics = nextMetrics;
      }

      textObject.set('fontSize', nextSize);
      textObject.initDimensions();
      textObject.set({
        left: lockedLeft,
        top: lockedTop,
      });
    };

    const refreshTextboxSerialPreview = (textObject, options = {}) => {
      if (!(textObject instanceof window.fabric.Textbox)) return;

      ensureTextboxSerialState(textObject);
      if (textObject.isEditing) return;

      const nextText = options.useRenderedText
        ? ctx.utils.renderSerialText(textObject.serialTemplateText, textObject.serialEnabled, textObject.serialCurrentValue)
        : textObject.serialTemplateText;

      textObject.set('text', nextText);
      textObject.isPlaceholderText = false;
      textObject.width = textObject.frameWidth || textObject.width;

      if (textObject.autoFitText) {
        fitTextboxFontToFrame(textObject);
      } else {
        textObject.initDimensions();
      }

      textObject.setCoords();
      if (!options.skipRender) ctx.ensureCanvas().requestRenderAll();
    };

    const syncTextboxWrappingBehavior = textbox => {
      if (!(textbox instanceof window.fabric.Textbox)) return textbox;

      const availableWidth = Math.max(12, (textbox.frameWidth || textbox.width || 0) - (textbox.padding * 2));
      const lines = String(textbox.text || '').split(/\r?\n/);

      const shouldSplitLongWord = lines.some((line, lineIndex) => {
        const words = typeof textbox.wordSplit === 'function'
          ? textbox.wordSplit(line)
          : line.split(/\s+/);

        return words.some(word => {
          if (!word) return false;
          const graphemes = typeof textbox.graphemeSplit === 'function'
            ? textbox.graphemeSplit(word)
            : Array.from(word);
          const wordWidth = typeof textbox._measureWord === 'function'
            ? textbox._measureWord(graphemes, lineIndex, 0)
            : 0;
          return wordWidth > availableWidth;
        });
      });

      textbox.splitByGrapheme = shouldSplitLongWord;
      return textbox;
    };

    const attachTextboxFrameBehavior = textbox => {
      const baseCalcTextHeight = textbox.calcTextHeight.bind(textbox);

      // Textboxes carry extra builder-only frame metadata on top of Fabric's
      // native textbox behavior, since print layouts care about the frame box
      // even when the current text content is short.
      textbox.isPlaceholderText = false;
      textbox.autoFitText = textbox.autoFitText !== false;
      textbox.maxAutoFitFontSize = Number.isFinite(textbox.maxAutoFitFontSize)
        ? Math.max(8, Math.round(textbox.maxAutoFitFontSize))
        : Math.max(8, Math.round(textbox.fontSize || 8));
      textbox.frameWidth = Math.max(textbox.frameWidth || 0, textbox.width || 0);
      textbox.frameHeight = Math.max(textbox.frameHeight || 0, textbox.height || 0);
      textbox.measureTextHeight = () => baseCalcTextHeight();
      textbox.calcTextHeight = function calcTextHeight() {
        return Math.max(baseCalcTextHeight(), this.frameHeight || 0);
      };

      // Fabric renders text starting at -height/2 (top of the bounding box).
      // verticalAlign shifts text within the extra space when the frame is
      // taller than the current text content.
      //   'top'    — text at top of frame (default Fabric behaviour)
      //   'middle' — text centred vertically in the frame
      //   'bottom' — text pinned to the bottom of the frame
      const baseGetTopOffset = textbox._getTopOffset.bind(textbox);
      textbox._getTopOffset = function _getTopOffset() {
        const base = baseGetTopOffset();
        const align = this.verticalAlign || 'top';
        if (align === 'top') return base;
        const realTextHeight = this.measureTextHeight ? this.measureTextHeight() : baseCalcTextHeight();
        const slack = Math.max(0, (this.frameHeight || 0) - realTextHeight);
        if (align === 'middle') return base + slack / 2;
        if (align === 'bottom') return base + slack;
        return base;
      };

      // Seed the default alignment so it persists in history snapshots.
      if (!textbox.verticalAlign) textbox.verticalAlign = 'top';

      textbox.splitByGrapheme = false;
      ensureTextboxSerialState(textbox);
      syncTextboxWrappingBehavior(textbox);
      textbox.on('editing:exited', () => {
        ensureTextboxSerialState(textbox);
        textbox.serialTemplateText = String(textbox.text || '');
        refreshTextboxSerialPreview(textbox, { skipRender: true });
        ctx.syncTextControls(textbox);
        ctx.ensureCanvas().requestRenderAll();
        void ctx.recordHistoryCheckpoint();
      });
      textbox.width = textbox.frameWidth;
      textbox.initDimensions();
      textbox.setCoords();

      return textbox;
    };

    const applyTextboxPlaceholder = (textbox, placeholderText = ctx.constants.DEFAULT_TEXTBOX_PLACEHOLDER) => {
      if (!(textbox instanceof window.fabric.Textbox)) return textbox;

      textbox.maxAutoFitFontSize = Math.max(8, Math.round(textbox.fontSize || 8));
      textbox.serialTemplateText = placeholderText;
      textbox.set('text', placeholderText);
      textbox.isPlaceholderText = true;
      textbox.initDimensions();
      textbox.setCoords();
      return textbox;
    };

    const buildTextbox = (canvasWidth, canvasHeight, overrides = {}) => {
      const themeColors = getTextboxThemeColors();

      return attachTextboxFrameBehavior(ctx.applyBuilderObjectDefaults(new window.fabric.Textbox(Object.prototype.hasOwnProperty.call(overrides, 'text') ? overrides.text : '', {
      left: Math.round(canvasWidth * 0.08),
      top: Math.round(canvasHeight * 0.08),
      width: Math.round(canvasWidth * 0.58),
      fontSize: 28,
      fontFamily: ctx.getPreferredFontFamily(state.currentPrinter?.id),
      fontWeight: '700',
      fill: '#111111',
      textAlign: 'center',
      editable: true,
      cursorColor: themeColors.accent,
      cursorWidth: 2,
      selectionColor: themeColors.accentSoft,
      transparentCorners: false,
      cornerStyle: 'circle',
      cornerColor: themeColors.accent,
      borderColor: themeColors.accent,
      borderScaleFactor: 2,
      padding: 10,
      frameHeight: Math.max(48, Math.round(canvasHeight * 0.46)),
      ...overrides,
    })));
    };

    const getInitialTextboxFontSize = ({ frameWidth, frameHeight }) => {
      const widthLimitedSize = frameWidth * 0.14;
      const heightLimitedSize = frameHeight * 0.22;

      return Math.max(
        24,
        Math.min(
          72,
          Math.round(Math.min(widthLimitedSize, heightLimitedSize))
        )
      );
    };

    const focusTextbox = textObject => {
      state.lastSelectedTextObject = textObject;
      ctx.ensureCanvas().setActiveObject(textObject);
      ctx.syncTextControls(textObject);
      ctx.ensureCanvas().requestRenderAll();
    };

    const beginTextboxEditing = textObject => {
      if (!(textObject instanceof window.fabric.Textbox)) return;

      // Serial-enabled textboxes temporarily switch back to their template text
      // while editing so placeholder tokens are never lost to preview output.
      ensureTextboxSerialState(textObject);
      if (textObject.isPlaceholderText) {
        textObject.set('text', '');
        textObject.serialTemplateText = '';
        textObject.isPlaceholderText = false;
        textObject.initDimensions();
        textObject.setCoords();
      } else if (textObject.serialEnabled) {
        textObject.set('text', textObject.serialTemplateText);
        textObject.initDimensions();
        textObject.setCoords();
      }

      textObject.enterEditing();
      textObject.selectAll();
      ctx.syncTextControls(textObject);
      ctx.ensureCanvas().requestRenderAll();
    };

    const addTextbox = () => {
      const builderCanvas = ctx.ensureCanvas();
      const textboxCount = builderCanvas.getObjects().filter(object => object instanceof window.fabric.Textbox).length;
      const frameWidth = Math.round(builderCanvas.getWidth() * 0.58);
      const frameHeight = Math.max(48, Math.round(builderCanvas.getHeight() * 0.34));
      const fontSize = getInitialTextboxFontSize({ frameWidth, frameHeight });
      const topStep = Math.max(34, Math.round(fontSize * 1.35));
      const textbox = buildTextbox(builderCanvas.getWidth(), builderCanvas.getHeight(), {
        text: '',
        left: Math.round((builderCanvas.getWidth() - frameWidth) / 2),
        width: frameWidth,
        frameWidth,
        top: Math.round(builderCanvas.getHeight() * 0.12) + (textboxCount * topStep),
        fontSize,
        frameHeight,
        autoFitText: false,
      });

      builderCanvas.add(textbox);
      focusTextbox(textbox);
      beginTextboxEditing(textbox);
      ctx.refreshBuilderMeta();
      void ctx.syncAutoFitTapeCanvas();
      void ctx.recordHistoryCheckpoint();
    };

    const createSeedTextbox = () => {
      const builderCanvas = ctx.ensureCanvas();
      const frameWidth = Math.round(builderCanvas.getWidth() * 0.6);
      const frameHeight = Math.max(48, Math.round(builderCanvas.getHeight() * 0.6));
      const fontSize = getInitialTextboxFontSize({ frameWidth, frameHeight });

      return buildTextbox(builderCanvas.getWidth(), builderCanvas.getHeight(), {
        text: '',
        left: Math.round((builderCanvas.getWidth() - frameWidth) / 2),
        top: Math.round((builderCanvas.getHeight() - frameHeight) / 2),
        width: frameWidth,
        frameWidth,
        frameHeight,
        fontSize,
        autoFitText: false,
      });
    };

    const updateSelectedTextbox = updates => {
      const textObject = ctx.getTextboxForControls();
      if (!textObject) return;

      textObject.set(updates);
      textObject.isPlaceholderText = false;
      if (Object.prototype.hasOwnProperty.call(updates, 'fontSize')) {
        textObject.maxAutoFitFontSize = Math.max(8, Math.round(updates.fontSize || textObject.fontSize || 8));
      }
      textObject.frameWidth = Math.max(textObject.frameWidth || textObject.width || 0, 48);
      textObject.frameHeight = Math.max(textObject.frameHeight || 0, 32);
      textObject.width = textObject.frameWidth;
      syncTextboxWrappingBehavior(textObject);
      if (textObject.autoFitText) fitTextboxFontToFrame(textObject);
      textObject.initDimensions();
      textObject.setCoords();
      ctx.syncTextControls(textObject);
      ctx.ensureCanvas().requestRenderAll();
      void ctx.syncAutoFitTapeCanvas();
      void ctx.recordHistoryCheckpoint();
    };

    const applyTextboxLayoutPreset = layoutMode => {
      const textObject = ctx.getTextboxForControls();
      if (!(textObject instanceof window.fabric.Textbox)) return;

      const builderCanvas = ctx.ensureCanvas();
      const nextFrameHeight = Math.max(32, Math.round(textObject.frameHeight || textObject.height || 0));
      const nextFrameWidth = layoutMode === 'fill'
        ? Math.round(builderCanvas.getWidth() * 0.84)
        : Math.round(builderCanvas.getWidth() * 0.58);
      const nextLeft = Math.round((builderCanvas.getWidth() - nextFrameWidth) / 2);
      const nextTop = Math.max(0, Math.round((builderCanvas.getHeight() - nextFrameHeight) / 2));

      textObject.set({
        left: nextLeft,
        top: nextTop,
        width: nextFrameWidth,
        frameWidth: nextFrameWidth,
      });

      syncTextboxWrappingBehavior(textObject);
      if (textObject.autoFitText) fitTextboxFontToFrame(textObject);
      textObject.initDimensions();
      textObject.setCoords();
      ctx.syncTextControls(textObject);
      builderCanvas.requestRenderAll();
      void ctx.syncAutoFitTapeCanvas();
      void ctx.recordHistoryCheckpoint();
    };

    const commitTextboxState = (textObject, options = {}) => {
      if (!(textObject instanceof window.fabric.Textbox)) return;

      ensureTextboxSerialState(textObject);

      if (typeof textObject.exitEditing === 'function' && textObject.isEditing && options.exitEditing) {
        textObject.exitEditing();
        return;
      }

      if (textObject.isEditing) {
        textObject.serialTemplateText = String(textObject.text || '');
        return;
      }

      refreshTextboxSerialPreview(textObject, {
        skipRender: options.skipRender,
        useRenderedText: options.useRenderedText,
      });
    };

    const applyTextboxSerialDigits = (textObject, digits, options = {}) => {
      if (!(textObject instanceof window.fabric.Textbox)) return;

      ensureTextboxSerialState(textObject);
      const nextTemplateText = ctx.utils.replaceSerialTokenDigits(textObject.serialTemplateText || textObject.text || '', digits);
      textObject.serialTemplateText = nextTemplateText;

      if (textObject.isEditing) {
        textObject.set('text', nextTemplateText);
        textObject.initDimensions();
        textObject.setCoords();
        if (!options.skipRender) ctx.ensureCanvas().requestRenderAll();
        return;
      }

      refreshTextboxSerialPreview(textObject, {
        skipRender: options.skipRender,
      });

      if (!options.skipHistory) {
        void ctx.recordHistoryCheckpoint();
      }
    };

    const bakeTextboxScale = event => {
      const textObject = event?.target;

      if (!(textObject instanceof window.fabric.Textbox)) return;

      // Shift-resize intentionally means "scale font", while ordinary resize
      // means "reshape the text frame". That distinction is easy to regress.
      if (event.e?.shiftKey) {
        const nextFontSize = Math.max(8, Math.round(textObject.fontSize * Math.max(textObject.scaleX, textObject.scaleY)));

        textObject.set({
          fontSize: nextFontSize,
          autoFitText: false,
          scaleX: 1,
          scaleY: 1,
        });
        textObject.maxAutoFitFontSize = nextFontSize;
      } else {
        const nextWidth = Math.max(56, Math.round(textObject.width * textObject.scaleX));
        const nextHeight = Math.max(32, Math.round((textObject.frameHeight || textObject.height) * textObject.scaleY));

        textObject.set({
          frameWidth: nextWidth,
          width: nextWidth,
          frameHeight: nextHeight,
          scaleX: 1,
          scaleY: 1,
        });
        if (textObject.autoFitText) fitTextboxFontToFrame(textObject);
      }

      textObject.initDimensions();
      textObject.setCoords();
      ctx.syncTextControls(textObject);
      ctx.ensureCanvas().requestRenderAll();
    };

    return {
      addTextbox,
      applyTextboxLayoutPreset,
      applyTextboxPlaceholder,
      applyTextboxSerialDigits,
      bakeTextboxScale,
      beginTextboxEditing,
      buildTextbox,
      createSeedTextbox,
      commitTextboxState,
      ensureTextboxSerialState,
      fitTextboxFontToFrame,
      focusTextbox,
      refreshTextboxSerialPreview,
      syncTextboxWrappingBehavior,
      updateSelectedTextbox,
    };
  });
}());
