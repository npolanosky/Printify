// ╭──────────────────────────╮
// │  events.js               │
// │  Fabric canvas events,   │
// │  DOM listeners, and      │
// │  keyboard affordances    │
// ╰──────────────────────────╯
(function () {
  const namespace = window.PrintifyLabelBuilder = window.PrintifyLabelBuilder || {};

  namespace.register('events', ctx => {
    const { refs, settings, state } = ctx;

    const bindCanvasEvents = () => {
      const builderCanvas = ctx.ensureCanvas();

      // Selection transitions are where pending edits get committed back into
      // object state, so these listeners are a common regression point.
      builderCanvas.on('selection:created', event => {
        ctx.syncTextControls(event.selected?.[0] || null);
        void ctx.syncAutoFitTapeCanvas();
      });

      builderCanvas.on('selection:updated', event => {
        for (const object of event.deselected || []) {
          ctx.queueStateCommit(() => ctx.commitObjectState(object, {
            skipControlSync: true,
            skipRender: true,
            useControlValues: false,
          }));
        }
        ctx.syncTextControls(event.selected?.[0] || null);
        void ctx.syncAutoFitTapeCanvas();
      });

      builderCanvas.on('selection:cleared', event => {
        for (const object of event.deselected || []) {
          ctx.queueStateCommit(() => ctx.commitObjectState(object, {
            skipControlSync: true,
            skipRender: true,
            useControlValues: false,
          }));
        }
        ctx.syncTextControls(null);
        void ctx.syncAutoFitTapeCanvas();
      });

      builderCanvas.on('text:changed', event => {
        if (event.target instanceof window.fabric.Textbox) {
          ctx.ensureTextboxSerialState(event.target);
          event.target.serialTemplateText = String(event.target.text || '');
          event.target.isPlaceholderText = false;
          event.target.width = event.target.frameWidth || event.target.width;
          ctx.syncTextboxWrappingBehavior(event.target);
          if (event.target.autoFitText) ctx.fitTextboxFontToFrame(event.target);
          event.target.initDimensions();
          event.target.setCoords();
        }
        ctx.syncTextControls(event.target || null);
        ctx.refreshBuilderMeta();
        void ctx.syncAutoFitTapeCanvas();
      });

      builderCanvas.on('mouse:down', event => {
        if (!(event.target instanceof window.fabric.Textbox)) return;
        if (!event.target.isPlaceholderText) return;
        builderCanvas.setActiveObject(event.target);
        ctx.beginTextboxEditing(event.target);
      });

      builderCanvas.on('object:modified', async event => {
        ctx.bakeTextboxScale(event);
        ctx.refreshBuilderMeta();
        await ctx.syncAutoFitTapeCanvas();
        await ctx.recordHistoryCheckpoint();
      });

      builderCanvas.on('object:rotating', event => {
        if (!event.target) return;
        ctx.applyBuilderObjectDefaults(event.target);
      });

      builderCanvas.on('mouse:dblclick', event => {
        if (!(event.target instanceof window.fabric.Textbox)) return;
        builderCanvas.setActiveObject(event.target);
        ctx.beginTextboxEditing(event.target);
      });
    };

    const bindDomEvents = () => {
      const isFabricHiddenTextarea = element => {
        const activeTextbox = ctx.getEditableTextObject();
        return element instanceof window.HTMLTextAreaElement
          && Boolean(
            activeTextbox?.hiddenTextarea === element
            || element.getAttribute('data-fabric-hiddentextarea') !== null
          );
      };

      // Keep builder affordances centralized here so future feature modules can
      // expose helpers without each owning another slice of global DOM wiring.
      refs.addImageButton?.addEventListener('click', () => {
        if (ctx.keepWorkingOnActiveObject('image')) return;
        refs.imageInput?.click();
      });
      refs.imageInput?.addEventListener('change', async () => {
        const [file] = Array.from(refs.imageInput.files || []);
        await ctx.addImageFromFile(file);
        refs.imageInput.value = '';
      });

      refs.addTextButton?.addEventListener('click', () => {
        if (ctx.keepWorkingOnActiveObject('text')) return;
        ctx.addTextbox();
      });
      refs.addQrButton?.addEventListener('click', () => {
        if (ctx.keepWorkingOnActiveObject('code')) return;
        ctx.addQrCode();
      });
      refs.alignLeftButton?.addEventListener('click', () => ctx.updateSelectedTextbox({ textAlign: 'left' }));
      refs.alignCenterButton?.addEventListener('click', () => ctx.updateSelectedTextbox({ textAlign: 'center' }));
      refs.alignRightButton?.addEventListener('click', () => ctx.updateSelectedTextbox({ textAlign: 'right' }));
      refs.verticalTopButton?.addEventListener('click', () => ctx.updateSelectedTextbox({ verticalAlign: 'top' }));
      refs.verticalMiddleButton?.addEventListener('click', () => ctx.updateSelectedTextbox({ verticalAlign: 'middle' }));
      refs.verticalBottomButton?.addEventListener('click', () => ctx.updateSelectedTextbox({ verticalAlign: 'bottom' }));
      refs.boxCenterButton?.addEventListener('click', () => ctx.applyTextboxLayoutPreset('center'));
      refs.boxFillButton?.addEventListener('click', () => ctx.applyTextboxLayoutPreset('fill'));
      refs.imageBoxCenterButton?.addEventListener('click', () => ctx.applyVisualObjectLayoutPreset('center'));
      refs.imageBoxFillButton?.addEventListener('click', () => ctx.applyVisualObjectLayoutPreset('fill'));
      refs.codeBoxCenterButton?.addEventListener('click', () => ctx.applyVisualObjectLayoutPreset('center'));
      refs.codeBoxFillButton?.addEventListener('click', () => ctx.applyVisualObjectLayoutPreset('fill'));
      refs.tapeWidthSelect?.addEventListener('change', async () => {
        if (!state.currentPrinter || !ctx.isTapePrinter(state.currentPrinter)) return;

        const nextTapeWidthMm = Number.parseInt(refs.tapeWidthSelect.value, 10);
        if (!Number.isFinite(nextTapeWidthMm)) return;

        state.currentTapeWidthMm = nextTapeWidthMm;
        await ctx.applyTapeCanvasSize(state.currentPrinter);
      });
      refs.tapeLengthInput?.addEventListener('input', async () => {
        if (!state.currentPrinter || !ctx.isTapePrinter(state.currentPrinter)) return;

        state.tapeMinimumLengthMm = ctx.utils.normalizeTapeLengthMm(refs.tapeLengthInput.value);
        state.currentTapeLengthMm = state.tapeAutoLengthEnabled
          ? Math.max(state.tapeMinimumLengthMm, ctx.getRequiredTapeLengthMm(state.currentPrinter))
          : state.tapeMinimumLengthMm;
        ctx.refreshBuilderMeta();
        await ctx.applyTapeCanvasSize(state.currentPrinter);
      });
      refs.tapeAutoLengthInput?.addEventListener('change', async () => {
        if (!state.currentPrinter || !ctx.isTapePrinter(state.currentPrinter)) return;

        state.tapeAutoLengthEnabled = Boolean(refs.tapeAutoLengthInput.checked);

        if (state.tapeAutoLengthEnabled) {
          // Compute the required length NOW and apply immediately.  We must
          // call applyTapeCanvasSize directly because syncAutoFitTapeCanvas
          // compares against state.currentTapeLengthMm — if we update that
          // first it would see no change and bail without resizing the canvas.
          state.currentTapeLengthMm = Math.max(
            state.tapeMinimumLengthMm,
            ctx.getRequiredTapeLengthMm(state.currentPrinter)
          );
          ctx.refreshBuilderMeta();
          await ctx.applyTapeCanvasSize(state.currentPrinter);
        } else {
          state.currentTapeLengthMm = state.tapeMinimumLengthMm;
          ctx.refreshBuilderMeta();
          await ctx.applyTapeCanvasSize(state.currentPrinter);
        }

        ctx.syncLengthInputState();
      });
      refs.invertPrintInput?.addEventListener('change', () => {
        state.invertPrintEnabled = Boolean(refs.invertPrintInput.checked);
        settings.setInvertPrintEnabled(state.currentPrinter?.id, state.invertPrintEnabled);
      });

      refs.canvasShell?.addEventListener('dragenter', event => {
        event.preventDefault();
        refs.canvasShell.classList.add('is-drop-target');
      });
      refs.canvasShell?.addEventListener('dragover', event => {
        event.preventDefault();
        refs.canvasShell.classList.add('is-drop-target');
      });
      refs.canvasShell?.addEventListener('dragleave', event => {
        if (event.target === refs.canvasShell) {
          refs.canvasShell.classList.remove('is-drop-target');
        }
      });
      refs.canvasShell?.addEventListener('drop', async event => {
        event.preventDefault();
        refs.canvasShell.classList.remove('is-drop-target');
        const [file] = Array.from(event.dataTransfer?.files || []);
        await ctx.addImageFromFile(file);
      });

      refs.closeButton?.addEventListener('click', ctx.close);
      refs.cancelButton?.addEventListener('click', ctx.close);
      refs.undoButton?.addEventListener('click', () => {
        void ctx.undoHistory();
      });
      refs.redoButton?.addEventListener('click', () => {
        void ctx.redoHistory();
      });
      refs.resetButton?.addEventListener('click', () => {
        ctx.clearEnterPrintPrompt();
        void ctx.stopMonochromePreview();
        if (state.currentPrinter) {
          state.currentTapeWidthMm = ctx.isTapePrinter(state.currentPrinter) ? ctx.utils.getResolvedDefaultTapeWidth(state.currentPrinter) : null;
          state.currentTapeLengthMm = ctx.constants.DEFAULT_TAPE_LENGTH_MM;
          state.tapeMinimumLengthMm = ctx.constants.DEFAULT_TAPE_LENGTH_MM;
          state.tapeAutoLengthEnabled = true;
          state.invertPrintEnabled = Boolean(settings.getInvertPrintEnabled(state.currentPrinter?.id));
          ctx.resetCanvas(state.currentPrinter);
          state.lastBuilderStatePrinterKey = ctx.getPrinterStateKey(state.currentPrinter);
        }
      });
      refs.printButton?.addEventListener('click', ctx.print);
      refs.previewButtons.forEach(previewButton => {
        ctx.utils.bindHoldAction(previewButton, ctx.startSerialPreview, ctx.stopSerialPreview);
      });
      ctx.utils.bindHoldAction(refs.monochromePreviewButton, ctx.startMonochromePreview, ctx.stopMonochromePreview);

      window.addEventListener('pointerup', async () => {
        await ctx.stopSerialPreview();
        await ctx.stopMonochromePreview();
      });
      window.addEventListener('pointercancel', async () => {
        await ctx.stopSerialPreview();
        await ctx.stopMonochromePreview();
      });
      window.addEventListener('blur', async () => {
        await ctx.stopSerialPreview();
        await ctx.stopMonochromePreview();
      });
      window.addEventListener('resize', () => {
        if (!refs.root.classList.contains('is-open')) return;
        ctx.applyCanvasViewportScale();
      });
      window.visualViewport?.addEventListener('resize', () => {
        if (!refs.root.classList.contains('is-open')) return;
        ctx.applyCanvasViewportScale();
      });
      refs.root.addEventListener('mousedown', event => {
        if (!refs.root.classList.contains('is-open')) return;
        if (state.templateModalOpen && event.target === refs.templateModal) {
          ctx.closeTemplateModal();
          return;
        }
        if (event.target !== refs.root) return;
        ctx.close();
      });
      document.addEventListener('keydown', event => {
        if (!refs.root.classList.contains('is-open')) return;

        const activeTextbox = ctx.getEditableTextObject();
        const isEditingTextbox = Boolean(activeTextbox?.isEditing);
        const activeElement = document.activeElement;
        const isTypingIntoField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement?.tagName)
          && !isFabricHiddenTextarea(activeElement);

        if (event.key === 'Escape') {
          if (state.templateModalOpen) {
            ctx.closeTemplateModal();
            return;
          }
          if (state.enterPrintArmed) {
            ctx.clearEnterPrintPrompt();
            return;
          }
          ctx.close();
          return;
        }

        if (state.templateModalOpen) {
          return;
        }

        const lowerKey = String(event.key || '').toLowerCase();
        const usesPrimaryModifier = event.metaKey || event.ctrlKey;

        if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
          if (isEditingTextbox || isTypingIntoField) return;

          event.preventDefault();

          if (state.enterPrintArmed) {
            ctx.print();
            return;
          }

          ctx.showEnterPrintPrompt();
          return;
        }

        ctx.clearEnterPrintPrompt();

        if (usesPrimaryModifier && !event.altKey && !isEditingTextbox && !isTypingIntoField) {
          const isUndoShortcut = lowerKey === 'z' && !event.shiftKey;
          const isRedoShortcut = lowerKey === 'y' || (lowerKey === 'z' && event.shiftKey);

          if (isUndoShortcut) {
            event.preventDefault();
            void ctx.undoHistory();
            return;
          }

          if (isRedoShortcut) {
            event.preventDefault();
            void ctx.redoHistory();
            return;
          }
        }

        if (ctx.utils.isArrowNudgeKey(event.key) && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditingTextbox && !isTypingIntoField) {
          if (ctx.nudgeActiveObject(event.key)) {
            event.preventDefault();
          }
          return;
        }

        if ((event.key === 'Delete' || event.key === 'Backspace') && !isEditingTextbox && !isTypingIntoField) {
          if (ctx.deleteActiveObject()) {
            event.preventDefault();
          }
        }
      });
    };

    return {
      bindCanvasEvents,
      bindDomEvents,
    };
  });
}());
