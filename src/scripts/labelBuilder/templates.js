// ╭──────────────────────────╮
// │  templates.js            │
// │  Builder document        │
// │  schema, local templates │
// │  and remote template UI  │
// ╰──────────────────────────╯
(function () {
  const namespace = window.PrintifyLabelBuilder = window.PrintifyLabelBuilder || {};

  namespace.register('templates', ctx => {
    const { constants, refs, settings, state } = ctx;

    const getLocalTemplates = () => {
      try {
        const rawValue = window.localStorage.getItem(constants.LOCAL_TEMPLATE_STORAGE_KEY);
        const parsedValue = JSON.parse(rawValue || '[]');
        return Array.isArray(parsedValue) ? parsedValue : [];
      } catch (error) {
        return [];
      }
    };

    const persistLocalTemplates = templates => {
      state.localTemplates = templates;
      try {
        window.localStorage.setItem(constants.LOCAL_TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
      } catch (error) {
        settings.onError(new Error('Could not persist local builder templates.'));
      }
    };

    const captureTemplateThumbnail = canvas => {
      const previewCanvas = document.createElement('canvas');
      const previewWidth = 320;
      const previewHeight = 180;
      previewCanvas.width = previewWidth;
      previewCanvas.height = previewHeight;
      const previewContext = previewCanvas.getContext('2d');

      if (!previewContext) {
        return null;
      }

      previewContext.fillStyle = '#ffffff';
      previewContext.fillRect(0, 0, previewWidth, previewHeight);

      const scale = Math.min(
        previewWidth / Math.max(1, canvas.getWidth()),
        previewHeight / Math.max(1, canvas.getHeight())
      );
      const drawWidth = canvas.getWidth() * scale;
      const drawHeight = canvas.getHeight() * scale;
      const drawLeft = Math.round((previewWidth - drawWidth) / 2);
      const drawTop = Math.round((previewHeight - drawHeight) / 2);

      previewContext.drawImage(
        canvas.lowerCanvasEl,
        0,
        0,
        canvas.lowerCanvasEl.width,
        canvas.lowerCanvasEl.height,
        drawLeft,
        drawTop,
        drawWidth,
        drawHeight
      );

      return previewCanvas.toDataURL('image/png');
    };

    const serializeCanvasObject = object => {
      if (object instanceof window.fabric.Textbox) {
        ctx.ensureTextboxSerialState(object);
        return {
          type: 'text',
          text: object.serialTemplateText || object.text || '',
          fontFamily: object.fontFamily || 'Arial',
          fontSize: object.fontSize || 28,
          fontWeight: object.fontWeight || '700',
          fill: object.fill || '#111111',
          textAlign: object.textAlign || 'center',
          padding: object.padding || 10,
          left: object.left || 0,
          top: object.top || 0,
          width: object.width || 0,
          frameWidth: object.frameWidth || object.width || 0,
          frameHeight: object.frameHeight || object.height || 0,
          angle: object.angle || 0,
          scaleX: object.scaleX || 1,
          scaleY: object.scaleY || 1,
          autoFitText: object.autoFitText !== false,
          autoFitWidth: Boolean(object.autoFitWidth),
          verticalAlign: object.verticalAlign || 'top',
          maxAutoFitFontSize: object.maxAutoFitFontSize || object.fontSize || 28,
          serialEnabled: Boolean(object.serialEnabled),
          serialCurrentValue: object.serialCurrentValue || 1,
          isPlaceholderText: Boolean(object.isPlaceholderText),
        };
      }

      if (ctx.isCodeObject(object)) {
        ctx.ensureCodeSerialState(object);
        return {
          type: 'code',
          codeText: object.codeText || '',
          codeFormat: object.codeFormat || 'qrcode',
          renderedCodeText: object.renderedCodeText || '',
          left: object.left || 0,
          top: object.top || 0,
          angle: object.angle || 0,
          scaleX: object.scaleX || 1,
          scaleY: object.scaleY || 1,
          width: object.width || 0,
          height: object.height || 0,
          serialEnabled: Boolean(object.serialEnabled),
          serialCurrentValue: object.serialCurrentValue || 1,
        };
      }

      if (ctx.isImageObject(object)) {
        const sourceUrl = object.sourceUrl || object.getElement?.()?.src || object._element?.src || '';
        return {
          type: 'image',
          sourceUrl,
          left: object.left || 0,
          top: object.top || 0,
          angle: object.angle || 0,
          scaleX: object.scaleX || 1,
          scaleY: object.scaleY || 1,
          width: object.width || 0,
          height: object.height || 0,
        };
      }

      return null;
    };

    const serializeCanvasToDocument = (canvas, builderState, options = {}) => {
      const includeThumbnail = options.includeThumbnail !== false;
      const includeTimestamps = options.includeTimestamps !== false;

      // This is intentionally a Printify-owned schema instead of raw Fabric
      // JSON so we can evolve builder features without hard-coupling saves to
      // Fabric internals or accidental private fields.
      const objects = canvas.getObjects()
        .map(serializeCanvasObject)
        .filter(Boolean);

      return {
        schemaVersion: constants.TEMPLATE_SCHEMA_VERSION,
        metadata: {
          displayName: refs.templateNameInput?.value?.trim() || `${builderState.currentPrinter?.displayName || 'Printify'} Template`,
          printerId: builderState.currentPrinter?.id || null,
          printerDisplayName: builderState.currentPrinter?.displayName || null,
          createdAt: includeTimestamps ? (builderState.templateCreatedAt || null) : null,
          updatedAt: includeTimestamps ? ctx.utils.getCurrentIsoTimestamp() : null,
          thumbnailDataUrl: includeThumbnail ? captureTemplateThumbnail(canvas) : null,
        },
        canvas: {
          width: canvas.getWidth(),
          height: canvas.getHeight(),
          density: builderState.currentPrinter?.density || null,
          isTape: Boolean(builderState.currentPrinter?.isTape),
        },
        builderState: {
          currentTapeWidthMm: builderState.currentTapeWidthMm,
          currentTapeLengthMm: builderState.currentTapeLengthMm,
          tapeMinimumLengthMm: builderState.tapeMinimumLengthMm,
          tapeAutoLengthEnabled: builderState.tapeAutoLengthEnabled,
          invertPrintEnabled: builderState.invertPrintEnabled,
        },
        objects,
      };
    };

    const buildCurrentTemplateSnapshot = async () => {
      const canvas = ctx.ensureCanvas();
      return ctx.withCanvasExportState(async () => {
        const documentPayload = serializeCanvasToDocument(canvas, state);
        return {
          document: documentPayload,
          thumbnailDataUrl: documentPayload.metadata.thumbnailDataUrl || captureTemplateThumbnail(canvas),
        };
      });
    };

    const hydrateTextObject = async templateObject => {
      const textbox = ctx.buildTextbox(ctx.ensureCanvas().getWidth(), ctx.ensureCanvas().getHeight(), {
        text: templateObject.text || '',
        left: templateObject.left || 0,
        top: templateObject.top || 0,
        width: templateObject.frameWidth || templateObject.width || 160,
        frameWidth: templateObject.frameWidth || templateObject.width || 160,
        frameHeight: templateObject.frameHeight || 72,
        fontFamily: templateObject.fontFamily || 'Arial',
        fontSize: templateObject.fontSize || 28,
        fontWeight: templateObject.fontWeight || '700',
        fill: templateObject.fill || '#111111',
        textAlign: templateObject.textAlign || 'center',
        padding: templateObject.padding || 10,
        autoFitText: templateObject.autoFitText !== false,
        autoFitWidth: Boolean(templateObject.autoFitWidth),
        verticalAlign: templateObject.verticalAlign || 'top',
        maxAutoFitFontSize: templateObject.maxAutoFitFontSize || templateObject.fontSize || 28,
      });

      textbox.set({
        left: templateObject.left || 0,
        top: templateObject.top || 0,
        angle: templateObject.angle || 0,
        scaleX: templateObject.scaleX || 1,
        scaleY: templateObject.scaleY || 1,
      });
      textbox.serialEnabled = Boolean(templateObject.serialEnabled);
      textbox.serialCurrentValue = templateObject.serialCurrentValue || 1;
      textbox.serialTemplateText = String(templateObject.text || '');
      textbox.isPlaceholderText = Boolean(templateObject.isPlaceholderText);
      ctx.refreshTextboxSerialPreview(textbox, { skipRender: true });
      textbox.setCoords();
      return textbox;
    };

    const hydrateImageObject = async templateObject => {
      if (!templateObject.sourceUrl) {
        return null;
      }

      const imageElement = await ctx.utils.loadImageElement(templateObject.sourceUrl);
      const FabricImageCtor = window.fabric.FabricImage || window.fabric.Image;
      const image = new FabricImageCtor(imageElement);
      ctx.applyBuilderObjectDefaults(image).set({
        printifyObjectType: 'image',
        sourceUrl: templateObject.sourceUrl,
        left: templateObject.left || 0,
        top: templateObject.top || 0,
        angle: templateObject.angle || 0,
        scaleX: templateObject.scaleX || 1,
        scaleY: templateObject.scaleY || 1,
      });
      image.setCoords();
      return image;
    };

    const hydrateCodeObject = async templateObject => {
      const codeObject = await ctx.buildCodeImage(
        templateObject.renderedCodeText || ctx.resolveFallbackCodeText(templateObject.codeFormat || 'qrcode'),
        templateObject.codeFormat || 'qrcode',
        templateObject.codeText || ''
      );

      codeObject.set({
        left: templateObject.left || 0,
        top: templateObject.top || 0,
        angle: templateObject.angle || 0,
        scaleX: templateObject.scaleX || 1,
        scaleY: templateObject.scaleY || 1,
      });
      codeObject.serialEnabled = Boolean(templateObject.serialEnabled);
      codeObject.serialCurrentValue = templateObject.serialCurrentValue || 1;
      codeObject.setCoords();
      return codeObject;
    };

    const hydrateCanvasFromDocument = async (templateDocument, runtime = ctx, options = {}) => {
      const builderCanvas = runtime.ensureCanvas();
      const templateBuilderState = templateDocument?.builderState || {};

      if (!state.currentPrinter) {
        return;
      }

      if (ctx.isTapePrinter(state.currentPrinter)) {
        state.currentTapeWidthMm = templateBuilderState.currentTapeWidthMm || ctx.utils.getResolvedDefaultTapeWidth(state.currentPrinter);
        state.currentTapeLengthMm = templateBuilderState.currentTapeLengthMm || constants.DEFAULT_TAPE_LENGTH_MM;
        state.tapeMinimumLengthMm = templateBuilderState.tapeMinimumLengthMm || state.currentTapeLengthMm;
        state.tapeAutoLengthEnabled = templateBuilderState.tapeAutoLengthEnabled !== false;
      }
      state.invertPrintEnabled = Boolean(templateBuilderState.invertPrintEnabled);

      builderCanvas.clear();
      const canvasMetrics = ctx.isTapePrinter(state.currentPrinter)
        ? ctx.getCurrentTapeCanvasSize(state.currentPrinter)
        : {
          width: templateDocument?.canvas?.width || ctx.utils.getPrinterCanvasSize(state.currentPrinter).width,
          height: templateDocument?.canvas?.height || ctx.utils.getPrinterCanvasSize(state.currentPrinter).height,
        };
      const currentWidth = Math.round(builderCanvas.getWidth() || 0);
      const currentHeight = Math.round(builderCanvas.getHeight() || 0);
      const nextWidth = Math.round(canvasMetrics.width || 0);
      const nextHeight = Math.round(canvasMetrics.height || 0);

      if (currentWidth !== nextWidth || currentHeight !== nextHeight) {
        builderCanvas.setDimensions(canvasMetrics);
      }
      builderCanvas.backgroundColor = '#ffffff';

      // Hydration rebuilds real builder objects through the same factories used
      // for new content so template restores keep textbox/code behavior intact.
      for (const templateObject of templateDocument?.objects || []) {
        let nextObject = null;

        if (templateObject.type === 'text') {
          nextObject = await hydrateTextObject(templateObject);
        } else if (templateObject.type === 'image') {
          nextObject = await hydrateImageObject(templateObject);
        } else if (templateObject.type === 'code') {
          nextObject = await hydrateCodeObject(templateObject);
        }

        if (nextObject) {
          builderCanvas.add(nextObject);
        }
      }

      if (!builderCanvas.getObjects().length) {
        runtime.resetCanvas(state.currentPrinter);
        return;
      }

      const selectionIndex = Number.isInteger(options.selectionIndex)
        ? options.selectionIndex
        : 0;
      const selectedObject = builderCanvas.getObjects()[selectionIndex] || builderCanvas.getObjects()[0] || null;
      if (selectedObject) {
        runtime.focusObject(selectedObject);
      } else {
        runtime.syncTextControls(null);
      }

      runtime.updateCanvasControlAppearance();
      runtime.applyCanvasViewportScale();
      runtime.syncTapeControls(state.currentPrinter);
      runtime.refreshBuilderMeta();
      runtime.syncPreviewButton();
      builderCanvas.requestRenderAll();

      if (options.skipHistoryReset !== true && typeof runtime.resetHistory === 'function') {
        await runtime.resetHistory();
      }
    };

    const remoteTemplateApi = {
      // Keep the fetch adapter shallow and isolated here so future folder tree,
      // rename/delete, or auth changes do not spill into canvas modules.
      async list(directoryPath = '') {
        const response = await fetch(`/label-builder/templates/remote?path=${encodeURIComponent(directoryPath)}`);
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || 'Could not list remote templates.');
        }
        return response.json();
      },

      async load(templatePath) {
        const response = await fetch(`/label-builder/templates/remote/file?path=${encodeURIComponent(templatePath)}`);
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || 'Could not load remote template.');
        }
        return response.json();
      },

      async save(payload) {
        const response = await fetch('/label-builder/templates/remote', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || 'Could not save remote template.');
        }

        return response.json();
      },

      async createFolder(directoryPath, name) {
        const response = await fetch('/label-builder/templates/remote/folders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            directoryPath,
            name,
          }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || 'Could not create remote folder.');
        }

        return response.json();
      },

      async delete(templatePath) {
        const response = await fetch(`/label-builder/templates/remote/file?path=${encodeURIComponent(templatePath)}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || 'Could not delete remote template.');
        }

        return response.json();
      },

      async deleteFolder(directoryPath) {
        const response = await fetch(`/label-builder/templates/remote/folders?path=${encodeURIComponent(directoryPath)}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || 'Could not delete remote folder.');
        }

        return response.json();
      },
    };

    const confirmTemplateDelete = async (item, options = {}) => {
      const itemName = item?.name || options.fallbackName || 'this item';
      const itemLabel = options.itemLabel || 'Template';
      const promptFn = typeof window.printifyShowPromptCard === 'function'
        ? window.printifyShowPromptCard
        : async options => window.confirm(options.message || options.title || 'Delete template?');

      return promptFn({
        tone: 'warning',
        eyebrow: `${itemLabel} Delete`,
        title: `Delete ${itemLabel}?`,
        message: `Delete ${itemName}? This can't be undone.`,
        subtext: options.subtext || (state.templateModalTab === 'local'
          ? 'This removes the template from this browser only.'
          : 'This removes the template file from the server template folder.'),
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
      });
    };

    const deleteLocalTemplate = async template => {
      const templates = getLocalTemplates().filter(entry => {
        if (template.id && entry.id) {
          return entry.id !== template.id;
        }

        return String(entry.name || '') !== String(template.name || '');
      });
      persistLocalTemplates(templates);
      await refreshTemplateListing();
      setTemplateFeedback(`Deleted ${template.name || 'template'}.`);
    };

    const deleteRemoteTemplate = async template => {
      await remoteTemplateApi.delete(template.path);
      await refreshTemplateListing();
      setTemplateFeedback(`Deleted ${template.name || 'template'}.`);
    };

    const deleteRemoteFolder = async folder => {
      await remoteTemplateApi.deleteFolder(folder.path);
      await refreshTemplateListing();
      setTemplateFeedback(`Deleted ${folder.name || 'folder'}.`);
    };

    const setTemplateFeedback = (message, isError = false) => {
      if (!refs.templateFeedback) return;
      refs.templateFeedback.hidden = !message;
      refs.templateFeedback.textContent = message || '';
      refs.templateFeedback.style.color = isError ? '#a63838' : '#1f6f43';
      window.clearTimeout(state.templateFeedbackTimer);
      if (message) {
        state.templateFeedbackTimer = window.setTimeout(() => {
          refs.templateFeedback.hidden = true;
          refs.templateFeedback.textContent = '';
        }, 2600);
      }
    };

    const syncTemplateTabButtons = () => {
      const isRemoteTab = state.templateModalTab === 'remote';

      refs.templateLocalTabButton?.classList.toggle('is-active', state.templateModalTab === 'local');
      refs.templateRemoteTabButton?.classList.toggle('is-active', isRemoteTab);
      if (refs.templateRemoteTools) {
        refs.templateRemoteTools.hidden = !isRemoteTab;
        refs.templateRemoteTools.style.display = isRemoteTab ? '' : 'none';
      }
      if (refs.templateSaveLocalButton) {
        refs.templateSaveLocalButton.hidden = isRemoteTab;
        refs.templateSaveLocalButton.style.display = isRemoteTab ? 'none' : '';
      }
      if (refs.templateSaveRemoteButton) {
        refs.templateSaveRemoteButton.hidden = !isRemoteTab;
        refs.templateSaveRemoteButton.style.display = isRemoteTab ? '' : 'none';
        refs.templateSaveRemoteButton.disabled = !isRemoteTab;
      }
      if (refs.templatePathLabel) {
        refs.templatePathLabel.textContent = state.remoteTemplatePath ? `/${state.remoteTemplatePath}` : '/';
      }
    };

    const renderTemplateCards = ({ folders = [], templates = [] }) => {
      if (!refs.templateGrid || !refs.templateEmpty) return;

      refs.templateGrid.innerHTML = '';
      const itemCount = folders.length + templates.length;
      refs.templateEmpty.hidden = itemCount > 0;

      folders.forEach(folder => {
        const folderCard = document.createElement('article');
        folderCard.className = 'printify-builder__template-card printify-builder__template-card--folder';
        folderCard.innerHTML = `
          <div class="printify-builder__template-corner-icon" aria-hidden="true">
            <img class="printify-builder__template-corner-icon-image" src="/assets/icons/folder.svg" alt="">
          </div>
          <div class="printify-builder__template-meta">
            <p class="printify-builder__template-name">${folder.name}</p>
            <p class="printify-builder__template-subcopy">Folder</p>
          </div>
          <div class="printify-builder__template-actions">
            <button class="printify-builder__template-icon-button" type="button" data-role="delete-folder" aria-label="Delete folder" title="Delete folder">
              <img class="printify-builder__template-icon" src="/assets/icons/trash.svg" alt="">
            </button>
            <button class="printer-card__button printer-card__button--secondary" type="button" data-role="open-folder">Open</button>
          </div>
        `;
        folderCard.querySelector('[data-role="open-folder"]')?.addEventListener('click', async () => {
          state.remoteTemplatePath = folder.path;
          await refreshTemplateListing();
        });
        folderCard.querySelector('[data-role="delete-folder"]')?.addEventListener('click', async () => {
          try {
            const accepted = await confirmTemplateDelete(folder, {
              itemLabel: 'Folder',
              subtext: 'This removes the folder and any templates or subfolders inside it from the server.',
            });
            if (!accepted) {
              return;
            }

            await deleteRemoteFolder(folder);
          } catch (error) {
            settings.onError(new Error(error.message || 'Could not delete folder.'));
          }
        });
        refs.templateGrid.append(folderCard);
      });

      templates.forEach(template => {
        const templateCard = document.createElement('article');
        templateCard.className = 'printify-builder__template-card';
        const updatedLabel = template.updatedAt ? new Date(template.updatedAt).toLocaleString() : 'Unknown update';
        templateCard.innerHTML = `
          <div class="printify-builder__template-thumb">
            ${template.thumbnailDataUrl ? `<img src="${template.thumbnailDataUrl}" alt="">` : ''}
            <p class="printify-builder__template-thumb-name" title="${template.name || 'Untitled Template'}">${template.name || 'Untitled Template'}</p>
          </div>
          <div class="printify-builder__template-meta">
            <p class="printify-builder__template-subcopy">${template.printerDisplayName || 'Any printer'} · ${updatedLabel}</p>
          </div>
          <div class="printify-builder__template-actions">
            <button class="printify-builder__template-icon-button" type="button" data-role="delete-template" aria-label="Delete template" title="Delete template">
              <img class="printify-builder__template-icon" src="/assets/icons/trash.svg" alt="">
            </button>
            <button class="printer-card__button printer-card__button--secondary" type="button" data-role="restore-template">Load</button>
          </div>
        `;
        templateCard.querySelector('[data-role="restore-template"]')?.addEventListener('click', async () => {
          try {
            const payload = state.templateModalTab === 'local'
              ? template
              : await remoteTemplateApi.load(template.path);
            await hydrateCanvasFromDocument(payload.document || payload, ctx);
            closeTemplateModal();
            setTemplateFeedback(`Loaded ${template.name || 'template'}.`);
          } catch (error) {
            settings.onError(new Error(error.message || 'Could not restore template.'));
          }
        });
        templateCard.querySelector('[data-role="delete-template"]')?.addEventListener('click', async () => {
          try {
            const accepted = await confirmTemplateDelete(template);
            if (!accepted) {
              return;
            }

            if (state.templateModalTab === 'local') {
              await deleteLocalTemplate(template);
            } else {
              await deleteRemoteTemplate(template);
            }
          } catch (error) {
            settings.onError(new Error(error.message || 'Could not delete template.'));
          }
        });
        refs.templateGrid.append(templateCard);
      });
    };

    const refreshLocalTemplateListing = () => {
      const templates = getLocalTemplates()
        .sort((left, right) => right.updatedAt?.localeCompare(left.updatedAt || '') || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
      state.localTemplates = templates;
      renderTemplateCards({ folders: [], templates });
    };

    const refreshRemoteTemplateListing = async () => {
      const payload = await remoteTemplateApi.list(state.remoteTemplatePath);
      state.remoteTemplatePath = payload.currentPath || '';
      state.remoteFolders = payload.folders || [];
      state.remoteTemplates = payload.templates || [];
      renderTemplateCards({
        folders: state.remoteFolders,
        templates: state.remoteTemplates,
      });
    };

    const refreshTemplateListing = async () => {
      syncTemplateTabButtons();
      if (state.templateModalTab === 'local') {
        refreshLocalTemplateListing();
        return;
      }

      await refreshRemoteTemplateListing();
    };

    const openTemplateModal = async () => {
      if (!refs.templateModal || !state.currentPrinter) return;

      state.templateModalOpen = true;
      refs.templateModal.hidden = false;
      if (refs.templateNameInput && !refs.templateNameInput.value.trim()) {
        refs.templateNameInput.value = `${state.currentPrinter.displayName} Template`;
      }
      await refreshTemplateListing();
    };

    const closeTemplateModal = () => {
      if (!refs.templateModal) return;
      state.templateModalOpen = false;
      refs.templateModal.hidden = true;
      setTemplateFeedback('');
    };

    const saveLocalTemplate = async () => {
      const templateName = ctx.utils.sanitizeTemplateName(refs.templateNameInput?.value) || `${state.currentPrinter?.displayName || 'Printify'} Template`;
      const snapshot = await buildCurrentTemplateSnapshot();
      const templates = getLocalTemplates();
      const existingIndex = templates.findIndex(template => template.name === templateName);
      const templateRecord = {
        id: `${templateName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
        name: templateName,
        createdAt: existingIndex >= 0 ? templates[existingIndex].createdAt : ctx.utils.getCurrentIsoTimestamp(),
        updatedAt: ctx.utils.getCurrentIsoTimestamp(),
        thumbnailDataUrl: snapshot.thumbnailDataUrl,
        document: snapshot.document,
      };

      if (existingIndex >= 0) {
        templates.splice(existingIndex, 1, templateRecord);
      } else {
        templates.push(templateRecord);
      }

      persistLocalTemplates(templates);
      await refreshTemplateListing();
      setTemplateFeedback(`Saved ${templateName} locally.`);
    };

    const saveRemoteTemplate = async () => {
      const templateName = ctx.utils.sanitizeTemplateName(refs.templateNameInput?.value) || `${state.currentPrinter?.displayName || 'Printify'} Template`;
      const snapshot = await buildCurrentTemplateSnapshot();
      await remoteTemplateApi.save({
        directoryPath: state.remoteTemplatePath,
        name: templateName,
        document: snapshot.document,
        thumbnailDataUrl: snapshot.thumbnailDataUrl,
      });
      await refreshTemplateListing();
      setTemplateFeedback(`Saved ${templateName} to /${state.remoteTemplatePath || ''}`.replace(/\/$/, ''));
    };

    const createRemoteTemplateFolder = async () => {
      const folderName = window.prompt('New remote template folder name');
      const sanitizedFolderName = ctx.utils.sanitizeTemplateName(folderName);
      if (!sanitizedFolderName) {
        return;
      }

      await remoteTemplateApi.createFolder(state.remoteTemplatePath, sanitizedFolderName);
      await refreshTemplateListing();
      setTemplateFeedback(`Created folder ${sanitizedFolderName}.`);
    };

    const bindTemplateEvents = () => {
      const openHandler = async () => {
        await openTemplateModal();
      };

      refs.templatesButton?.addEventListener('click', openHandler);
      refs.templateModalCloseButton?.addEventListener('click', closeTemplateModal);
      refs.templateLocalTabButton?.addEventListener('click', async () => {
        state.templateModalTab = 'local';
        await refreshTemplateListing();
      });
      refs.templateRemoteTabButton?.addEventListener('click', async () => {
        state.templateModalTab = 'remote';
        await refreshTemplateListing();
      });
      refs.templateRefreshButton?.addEventListener('click', async () => {
        await refreshTemplateListing();
      });
      refs.templateUpButton?.addEventListener('click', async () => {
        if (!state.remoteTemplatePath) return;
        state.remoteTemplatePath = state.remoteTemplatePath.includes('/')
          ? state.remoteTemplatePath.split('/').slice(0, -1).join('/')
          : '';
        await refreshTemplateListing();
      });
      refs.templateNewFolderButton?.addEventListener('click', async () => {
        try {
          await createRemoteTemplateFolder();
        } catch (error) {
          settings.onError(new Error(error.message || 'Could not create remote folder.'));
        }
      });
      refs.templateSaveLocalButton?.addEventListener('click', async () => {
        try {
          await saveLocalTemplate();
        } catch (error) {
          settings.onError(new Error(error.message || 'Could not save local template.'));
        }
      });
      refs.templateSaveRemoteButton?.addEventListener('click', async () => {
        try {
          await saveRemoteTemplate();
        } catch (error) {
          settings.onError(new Error(error.message || 'Could not save remote template.'));
        }
      });
    };

    return {
      bindTemplateEvents,
      buildCurrentTemplateSnapshot,
      captureTemplateThumbnail,
      closeTemplateModal,
      hydrateCanvasFromDocument,
      openTemplateModal,
      refreshTemplateListing,
      serializeCanvasToDocument,
    };
  });
}());
