// ╭──────────────────────────╮
// │  controls.js             │
// │  Inspector sync between  │
// │  active canvas objects   │
// │  and builder form inputs │
// ╰──────────────────────────╯
(function () {
  const namespace = window.PrintifyLabelBuilder = window.PrintifyLabelBuilder || {};

  namespace.register('controls', ctx => {
    const { refs, settings, state } = ctx;

    const rememberSerialSettings = (serialValue, serialDigits) => {
      state.lastSerialValue = ctx.utils.normalizeSerialValue(serialValue);
      state.lastSerialDigits = ctx.utils.normalizeSerialDigits(serialDigits);
    };

    const syncPreviewButton = () => {
      refs.previewButtons.forEach(previewButton => {
        previewButton.classList.toggle('is-active', state.isSerialPreviewActive);
        previewButton.disabled = !state.currentPrinter;
      });

      if (refs.monochromePreviewButton) {
        const isMonochromePrinter = Boolean(state.currentPrinter?.monochrome);
        refs.monochromePreviewButton.hidden = !isMonochromePrinter;
        refs.monochromePreviewButton.disabled = !isMonochromePrinter;
        refs.monochromePreviewButton.classList.toggle('is-active', state.isMonochromePreviewActive);
      }
    };

    const syncHistoryButtons = () => {
      const hasUndoHistory = Boolean(state.currentPrinter) && ctx.canUndoHistory();
      const hasRedoHistory = Boolean(state.currentPrinter) && ctx.canRedoHistory();

      [
        [refs.undoButton, hasUndoHistory],
        [refs.redoButton, hasRedoHistory],
      ].forEach(([button, isAvailable]) => {
        if (!button) return;
        button.disabled = !isAvailable;
        button.classList.toggle('is-available', isAvailable);
      });
    };

    const clearEnterPrintPrompt = () => {
      state.enterPrintArmed = false;
      window.clearTimeout(state.enterPrintTimer);
      if (refs.enterConfirm) refs.enterConfirm.hidden = true;
    };

    const showEnterPrintPrompt = () => {
      state.enterPrintArmed = true;
      if (refs.enterConfirm) refs.enterConfirm.hidden = false;
      window.clearTimeout(state.enterPrintTimer);
      state.enterPrintTimer = window.setTimeout(() => {
        clearEnterPrintPrompt();
      }, 2200);
    };

    const syncFontInput = textObject => {
      if (!refs.fontSelect) return;

      state.isSyncingFontInput = true;
      refs.fontSelect.value = textObject?.fontFamily || 'Arial';
      refs.fontSelect.disabled = !textObject;
      state.isSyncingFontInput = false;
    };

    const syncFontSizeInput = textObject => {
      if (!refs.fontSizeInput) return;

      state.isSyncingFontSizeInput = true;
      refs.fontSizeInput.value = textObject?.fontSize ? String(Math.round(textObject.fontSize)) : '';
      refs.fontSizeInput.disabled = !textObject;
      state.isSyncingFontSizeInput = false;
    };

    const syncAutoFitInput = textObject => {
      if (!refs.autoFitInput) return;

      state.isSyncingAutoFitInput = true;
      refs.autoFitInput.checked = Boolean(textObject?.autoFitText);
      refs.autoFitInput.disabled = !textObject;
      state.isSyncingAutoFitInput = false;
    };

    const syncTextSerialInputs = textObject => {
      if (!refs.textSerialEnabledInput || !refs.textSerialValueInput || !refs.textSerialValueField) return;

      const preparedTextbox = textObject instanceof window.fabric.Textbox ? ctx.ensureTextboxSerialState(textObject) : null;

      state.isSyncingTextSerialInput = true;
      refs.textSerialEnabledInput.checked = Boolean(preparedTextbox?.serialEnabled);
      refs.textSerialEnabledInput.disabled = !preparedTextbox;
      refs.textSerialValueField.hidden = !(preparedTextbox?.serialEnabled);
      refs.textSerialValueInput.value = String(preparedTextbox?.serialCurrentValue || 1);
      refs.textSerialValueInput.disabled = !preparedTextbox?.serialEnabled;
      if (refs.textSerialDigitsInput) {
        refs.textSerialDigitsInput.value = String(ctx.utils.getSerialTokenDigits(preparedTextbox?.serialTemplateText || preparedTextbox?.text || ''));
        refs.textSerialDigitsInput.disabled = !preparedTextbox?.serialEnabled;
      }
      state.isSyncingTextSerialInput = false;
    };

    const syncCodeSerialInputs = codeObject => {
      if (!refs.codeSerialEnabledInput || !refs.codeSerialValueInput || !refs.codeSerialValueField) return;

      const preparedCodeObject = ctx.isCodeObject(codeObject) ? ctx.ensureCodeSerialState(codeObject) : null;

      state.isSyncingCodeSerialInput = true;
      refs.codeSerialEnabledInput.checked = Boolean(preparedCodeObject?.serialEnabled);
      refs.codeSerialEnabledInput.disabled = !preparedCodeObject;
      refs.codeSerialValueField.hidden = !(preparedCodeObject?.serialEnabled);
      refs.codeSerialValueInput.value = String(preparedCodeObject?.serialCurrentValue || 1);
      refs.codeSerialValueInput.disabled = !preparedCodeObject?.serialEnabled;
      if (refs.codeSerialDigitsInput) {
        refs.codeSerialDigitsInput.value = String(ctx.utils.getSerialTokenDigits(preparedCodeObject?.codeText || ''));
        refs.codeSerialDigitsInput.disabled = !preparedCodeObject?.serialEnabled;
      }
      state.isSyncingCodeSerialInput = false;
    };

    const syncAlignmentButtons = textObject => {
      const buttons = [
        [refs.alignLeftButton, 'left'],
        [refs.alignCenterButton, 'center'],
        [refs.alignRightButton, 'right'],
      ];

      buttons.forEach(([button, value]) => {
        if (!button) return;
        button.disabled = !textObject;
        button.classList.toggle('is-active', textObject?.textAlign === value);
      });
    };

    const syncVerticalAlignButtons = textObject => {
      const buttons = [
        [refs.verticalTopButton, 'top'],
        [refs.verticalMiddleButton, 'middle'],
        [refs.verticalBottomButton, 'bottom'],
      ];

      buttons.forEach(([button, value]) => {
        if (!button) return;
        button.disabled = !textObject;
        // Default to 'top' if the property is not yet set.
        button.classList.toggle('is-active', (textObject?.verticalAlign || 'top') === value);
      });
    };

    const syncTextboxLayoutButtons = textObject => {
      [refs.boxCenterButton, refs.boxFillButton].forEach(button => {
        if (!button) return;
        button.disabled = !(textObject instanceof window.fabric.Textbox);
        button.classList.remove('is-active');
      });
    };

    const syncMediaLayoutButtons = activeObject => {
      const mediaLayoutButtons = [
        [refs.imageBoxCenterButton, ctx.isImageObject(activeObject)],
        [refs.imageBoxFillButton, ctx.isImageObject(activeObject)],
        [refs.codeBoxCenterButton, ctx.isCodeObject(activeObject)],
        [refs.codeBoxFillButton, ctx.isCodeObject(activeObject)],
      ];

      mediaLayoutButtons.forEach(([button, enabled]) => {
        if (!button) return;
        button.disabled = !enabled;
        button.classList.remove('is-active');
      });
    };

    const syncCodeInputs = codeObject => {
      if (!refs.qrTextInput || !refs.qrFormatSelect) return;

      state.isSyncingQrInput = true;
      refs.qrTextInput.value = codeObject?.codeText || '';
      refs.qrTextInput.disabled = !codeObject;
      refs.qrFormatSelect.value = codeObject?.codeFormat || 'qrcode';
      refs.qrFormatSelect.disabled = !codeObject;
      state.isSyncingQrInput = false;
    };

    const syncTextControls = activeObject => {
      const textObject = activeObject instanceof window.fabric.Textbox ? activeObject : null;
      const imageObject = ctx.isImageObject(activeObject) ? activeObject : null;
      const codeObject = ctx.isCodeObject(activeObject) ? activeObject : null;

      if (textObject) state.lastSelectedTextObject = textObject;
      if (codeObject) state.lastSelectedCodeObject = codeObject;

      if (refs.textCard) refs.textCard.hidden = !textObject;
      if (refs.imageCard) refs.imageCard.hidden = !imageObject;
      if (refs.qrCard) refs.qrCard.hidden = !codeObject;
      syncFontInput(textObject);
      syncFontSizeInput(textObject);
      syncAutoFitInput(textObject);
      syncTextSerialInputs(textObject);
      syncAlignmentButtons(textObject);
      syncVerticalAlignButtons(textObject);
      syncTextboxLayoutButtons(textObject);
      syncMediaLayoutButtons(activeObject);
      syncCodeInputs(codeObject);
      syncCodeSerialInputs(codeObject);
    };

    const bindControlInputs = () => {
      // Guard flags prevent programmatic control sync from feeding back into
      // change handlers and mutating the active object twice.
      refs.fontSelect?.addEventListener('change', () => {
        if (state.isSyncingFontInput) return;
        const nextFontFamily = refs.fontSelect.value || 'Arial';
        settings.setSavedFontFamily(state.currentPrinter?.id, nextFontFamily);
        ctx.updateSelectedTextbox({
          fontFamily: nextFontFamily,
        });
      });

      refs.fontSizeInput?.addEventListener('focus', () => {
        refs.fontSizeInput.select();
      });

      refs.fontSizeInput?.addEventListener('input', () => {
        if (state.isSyncingFontSizeInput) return;

        const parsedValue = Number.parseInt(refs.fontSizeInput.value || '', 10);
        if (!Number.isFinite(parsedValue)) return;

        // Do not apply values below the minimum while the user is still
        // typing. Without this guard, typing "36" triggers the handler on
        // "3" → clamps to 8 → field resets to "8" → "6" appends → "86".
        // Values ≥ 8 apply live for immediate canvas feedback; low/partial
        // values (e.g. the leading digit of "36") are left in the field
        // until the user commits with blur or Enter.
        if (parsedValue < 8) return;

        if (refs.autoFitInput) refs.autoFitInput.checked = false;
        ctx.updateSelectedTextbox({
          fontSize: parsedValue,
          autoFitText: false,
        });
      });

      // On blur or Enter, clamp and normalize whatever is in the field so it
      // always reflects a valid font size — e.g. if the user typed "3" and
      // clicked away, clamp to 8 and update both the textbox and the field.
      refs.fontSizeInput?.addEventListener('change', () => {
        if (state.isSyncingFontSizeInput) return;

        const parsedValue = Number.parseInt(refs.fontSizeInput.value || '', 10);
        const clamped = Number.isFinite(parsedValue) ? Math.max(8, parsedValue) : null;
        if (clamped === null) return;

        if (refs.autoFitInput) refs.autoFitInput.checked = false;
        ctx.updateSelectedTextbox({
          fontSize: clamped,
          autoFitText: false,
        });
      });

      refs.autoFitInput?.addEventListener('change', () => {
        if (state.isSyncingAutoFitInput) return;

        const textObject = ctx.getTextboxForControls();
        if (!textObject) return;

        textObject.set('autoFitText', refs.autoFitInput.checked);
        if (textObject.autoFitText) ctx.fitTextboxFontToFrame(textObject);
        textObject.initDimensions();
        textObject.setCoords();
        syncTextControls(textObject);
        ctx.ensureCanvas().requestRenderAll();
        void ctx.recordHistoryCheckpoint();
      });

      refs.textSerialEnabledInput?.addEventListener('change', () => {
        if (state.isSyncingTextSerialInput) return;

        const textObject = ctx.getTextboxForControls();
        if (!textObject) return;

        ctx.ensureTextboxSerialState(textObject);
        textObject.serialTemplateText = textObject.isEditing ? String(textObject.text || '') : String(textObject.serialTemplateText || textObject.text || '');
        textObject.serialEnabled = refs.textSerialEnabledInput.checked;

        if (textObject.serialEnabled) {
          textObject.serialCurrentValue = state.lastSerialValue;
          if (!/\{x+\}/i.test(textObject.serialTemplateText || '')) {
            const nextTemplateText = ctx.utils.appendSerialToken(textObject.serialTemplateText, state.lastSerialDigits);
            textObject.serialTemplateText = nextTemplateText;
            if (textObject.isEditing) {
              textObject.set('text', nextTemplateText);
              textObject.initDimensions();
              textObject.setCoords();
            }
          } else {
            textObject.serialTemplateText = ctx.utils.replaceSerialTokenDigits(textObject.serialTemplateText, state.lastSerialDigits);
          }
        } else {
          const nextTemplateText = ctx.utils.removeSerialTokens(textObject.serialTemplateText);
          textObject.serialTemplateText = nextTemplateText;
          if (textObject.isEditing) {
            textObject.set('text', nextTemplateText);
            textObject.initDimensions();
            textObject.setCoords();
          }
        }

        ctx.refreshTextboxSerialPreview(textObject);
        syncTextControls(textObject);
        void ctx.recordHistoryCheckpoint();
      });

      refs.textSerialValueInput?.addEventListener('input', () => {
        if (state.isSyncingTextSerialInput) return;

        const textObject = ctx.getEditableTextObject();
        if (!textObject) return;

        ctx.ensureTextboxSerialState(textObject);
        textObject.serialCurrentValue = ctx.utils.normalizeSerialValue(refs.textSerialValueInput.value);
        rememberSerialSettings(textObject.serialCurrentValue, refs.textSerialDigitsInput?.value);
        ctx.refreshTextboxSerialPreview(textObject);
        syncTextControls(textObject);
        void ctx.recordHistoryCheckpoint();
      });

      refs.textSerialDigitsInput?.addEventListener('input', () => {
        if (state.isSyncingTextSerialInput) return;

        const textObject = ctx.getTextboxForControls();
        if (!textObject) return;

        rememberSerialSettings(textObject.serialCurrentValue, refs.textSerialDigitsInput.value);
        ctx.applyTextboxSerialDigits(textObject, refs.textSerialDigitsInput.value);
        syncTextControls(textObject);
        void ctx.recordHistoryCheckpoint();
      });

      refs.qrTextInput?.addEventListener('input', () => {
        if (state.isSyncingQrInput) return;

        const codeObject = ctx.getCodeObjectForControls();
        if (!codeObject) return;

        window.clearTimeout(state.qrUpdateTimer);
        state.qrUpdateTimer = window.setTimeout(() => {
          ctx.updateSelectedCode(refs.qrTextInput.value || '', refs.qrFormatSelect?.value || codeObject.codeFormat, {
            preserveWhenBlank: true,
            skipIncompatibleInput: true,
          });
        }, 500);
      });

      refs.qrFormatSelect?.addEventListener('change', () => {
        if (state.isSyncingQrInput) return;

        const codeObject = ctx.getCodeObjectForControls();
        if (!codeObject) return;

        ctx.updateSelectedCode(refs.qrTextInput?.value || codeObject.codeText || '', refs.qrFormatSelect.value || 'qrcode');
      });

      refs.codeSerialEnabledInput?.addEventListener('change', () => {
        if (state.isSyncingCodeSerialInput) return;

        const codeObject = ctx.getCodeObjectForControls();
        if (!codeObject) return;

        ctx.ensureCodeSerialState(codeObject);
        codeObject.serialEnabled = refs.codeSerialEnabledInput.checked;
        codeObject.serialCurrentValue = codeObject.serialEnabled ? state.lastSerialValue : ctx.utils.normalizeSerialValue(codeObject.serialCurrentValue);

        const nextCodeText = codeObject.serialEnabled
          ? ctx.utils.appendSerialToken(codeObject.codeText || '', state.lastSerialDigits)
          : ctx.utils.removeSerialTokens(codeObject.codeText || '');

        ctx.updateCodeObject(codeObject, nextCodeText, codeObject.codeFormat || 'qrcode', {
          preserveWhenBlank: true,
        });
      });

      refs.codeSerialValueInput?.addEventListener('input', () => {
        if (state.isSyncingCodeSerialInput) return;

        const codeObject = ctx.getCodeObjectForControls();
        if (!codeObject) return;

        ctx.ensureCodeSerialState(codeObject);
        codeObject.serialCurrentValue = ctx.utils.normalizeSerialValue(refs.codeSerialValueInput.value);
        rememberSerialSettings(codeObject.serialCurrentValue, refs.codeSerialDigitsInput?.value);
        ctx.updateCodeObject(codeObject, codeObject.codeText || '', codeObject.codeFormat || 'qrcode', {
          preserveWhenBlank: true,
        });
      });

      refs.codeSerialDigitsInput?.addEventListener('input', () => {
        if (state.isSyncingCodeSerialInput) return;

        const codeObject = ctx.getCodeObjectForControls();
        if (!codeObject) return;

        rememberSerialSettings(codeObject.serialCurrentValue, refs.codeSerialDigitsInput.value);
        ctx.applyCodeSerialDigits(codeObject, refs.codeSerialDigitsInput.value);
      });
    };

    return {
      bindControlInputs,
      clearEnterPrintPrompt,
      rememberSerialSettings,
      showEnterPrintPrompt,
      syncHistoryButtons,
      syncPreviewButton,
      syncTextControls,
    };
  });
}());
