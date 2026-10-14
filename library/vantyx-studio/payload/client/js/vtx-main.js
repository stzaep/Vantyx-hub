(function () {
    'use strict';

    var csInterface = typeof VantyxCSInterface !== 'undefined' ? new VantyxCSInterface() : null;

    var defaultState = {
        kits: [
            {
                name: "My First Kit",
                colors: ["#000000", "#FFFFFF", "#B0B0B0", "#777777", "#DCDCDC"]
            }
        ],
        currentKitIndex: 0,
        selectedColorIndex: 0,
        fonts: [], // { font: <postscript>, fontFamily, fontStyle }
        collapsedPanels: {}, // { kits: true/false, fonts: true/false, logo: true/false }
        theme: 'dark', // 'dark' | 'light'
        mediaItems: [] // { id, name, thumb }
    };

    var state = defaultState;
    try {
        var savedState = localStorage.getItem('vantyx_studio_state');
        if (savedState) {
            state = JSON.parse(savedState);
        }
    } catch (e) {}
    if (!state.fonts) state.fonts = []; // estados guardados antes de esta función
    if (!state.collapsedPanels) state.collapsedPanels = {}; // ídem
    if (!state.theme) state.theme = 'dark'; // ídem
    if (!state.mediaItems) state.mediaItems = []; // ídem

    function saveStateToDisk() {
        try {
            localStorage.setItem('vantyx_studio_state', JSON.stringify(state));
        } catch (e) {}
    }

    var kitSelect = document.getElementById('kitSelect');
    var currentKitTitle = document.getElementById('currentKitTitle');
    var swatchesContainer = document.getElementById('swatchesContainer');
    var selectedSwatchLabel = document.getElementById('selectedSwatchLabel');
    var hexDisplay = document.getElementById('hexDisplay');
    var manualColorPicker = document.getElementById('manualColorPicker');
    var hexInput = document.getElementById('hexInput');
    var statusBar = document.getElementById('statusBar');
    var fontsListContainer = document.getElementById('fontsListContainer');
    var btnAddFont = document.getElementById('btnAddFont');
    var btnSettings = document.getElementById('btnSettings');
    var settingsOverlay = document.getElementById('settingsOverlay');
    var btnCloseSettings = document.getElementById('btnCloseSettings');
    var btnThemeDark = document.getElementById('btnThemeDark');
    var btnThemeLight = document.getElementById('btnThemeLight');
    var logoListContainer = document.getElementById('logoListContainer');
    var btnAddMedia = document.getElementById('btnAddMedia');

    var btnAddColor = document.getElementById('btnAddColor');
    var btnRemoveColor = document.getElementById('btnRemoveColor');
    var btnNewKit = document.getElementById('btnNewKit');
    var btnRenameKit = document.getElementById('btnRenameKit');
    var btnDeleteKit = document.getElementById('btnDeleteKit');
    var btnEyedropper = document.getElementById('btnEyedropper');
    var btnPullLayers = document.getElementById('btnPullLayers');

    function init() {
        applyTheme(state.theme);
        renderKitsDropdown();
        renderSwatches();
        renderFonts();
        renderLogoItems();
        setupEventListeners();
        setupCollapsiblePanels();
        setupSettingsPanel();
    }

    function applyTheme(themeName) {
        var isLight = themeName === 'light';
        document.documentElement.classList.toggle('theme-light', isLight);

        if (btnThemeDark) btnThemeDark.classList.toggle('active', !isLight);
        if (btnThemeLight) btnThemeLight.classList.toggle('active', isLight);
    }

    function setupSettingsPanel() {
        if (!btnSettings || !settingsOverlay) return;

        btnSettings.addEventListener('click', function () {
            settingsOverlay.classList.add('is-open');
        });

        var closeSettings = function () {
            settingsOverlay.classList.remove('is-open');
        };

        if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettings);

        settingsOverlay.addEventListener('click', function (ev) {
            if (ev.target === settingsOverlay) closeSettings(); // clic fuera del modal
        });

        if (btnThemeDark) {
            btnThemeDark.addEventListener('click', function () {
                state.theme = 'dark';
                saveStateToDisk();
                applyTheme('dark');
            });
        }
        if (btnThemeLight) {
            btnThemeLight.addEventListener('click', function () {
                state.theme = 'light';
                saveStateToDisk();
                applyTheme('light');
            });
        }
    }

    function renderKitsDropdown() {
        kitSelect.innerHTML = '';
        state.kits.forEach(function (kit, idx) {
            var option = document.createElement('option');
            option.value = idx;
            option.textContent = kit.name + ' (' + kit.colors.length + ')';
            if (idx === state.currentKitIndex) option.selected = true;
            kitSelect.appendChild(option);
        });

        var currentKit = state.kits[state.currentKitIndex];
        if (currentKitTitle && currentKit) {
            currentKitTitle.textContent = currentKit.name;
        }
    }

    function renderSwatches() {
        swatchesContainer.innerHTML = '';
        var currentKit = state.kits[state.currentKitIndex];

        if (!currentKit || currentKit.colors.length === 0) {
            swatchesContainer.innerHTML = '<span style="color:var(--text-muted); font-size:10px;">No colors in this kit.</span>';
            updateColorControls(null, -1);
            return;
        }

        if (state.selectedColorIndex < 0 || state.selectedColorIndex >= currentKit.colors.length) {
            state.selectedColorIndex = 0;
        }

        currentKit.colors.forEach(function (hex, idx) {
            var swatch = document.createElement('div');
            swatch.className = 'swatch';
            swatch.style.backgroundColor = hex;
            swatch.style.boxShadow = '0 0 8px ' + hex + '66';

            if (idx === state.selectedColorIndex) {
                swatch.classList.add('selected');
            }

            swatch.addEventListener('click', function () {
                state.selectedColorIndex = idx;
                saveStateToDisk();
                renderSwatches();
                applyColorToActiveLayer(hex);
            });

            swatchesContainer.appendChild(swatch);
        });

        updateColorControls(currentKit.colors[state.selectedColorIndex], state.selectedColorIndex);
    }

    // Evita romper el CSS si un nombre de fuente trae comillas o backslashes
    function cssFontFamilyValue(name) {
        var safe = String(name || 'sans-serif').replace(/["\\]/g, '');
        return "'" + safe + "', sans-serif";
    }

    function renderFonts() {
        fontsListContainer.innerHTML = '';

        if (!state.fonts || state.fonts.length === 0) {
            fontsListContainer.innerHTML = '<div class="fonts-empty">No fonts saved yet.</div>';
            refreshPanelHeightIfOpen('fonts');
            return;
        }

        state.fonts.forEach(function (fontEntry, idx) {
            var card = document.createElement('div');
            card.className = 'font-card';

            var preview = document.createElement('div');
            preview.className = 'font-preview-box';
            preview.textContent = 'Aa';
            preview.style.fontFamily = cssFontFamilyValue(fontEntry.fontFamily || fontEntry.font);

            var info = document.createElement('div');
            info.className = 'font-info';

            var nameEl = document.createElement('div');
            nameEl.className = 'font-name';
            nameEl.textContent = fontEntry.fontFamily || fontEntry.font;

            var subEl = document.createElement('div');
            subEl.className = 'font-postscript';
            subEl.textContent = fontEntry.font;

            info.appendChild(nameEl);
            info.appendChild(subEl);

            var delBtn = document.createElement('button');
            delBtn.className = 'font-card-delete';
            delBtn.title = 'Remove font';
            delBtn.textContent = '×';
            delBtn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                state.fonts.splice(idx, 1);
                saveStateToDisk();
                renderFonts();
                showStatus("Font removed.");
            });

            card.appendChild(preview);
            card.appendChild(info);
            card.appendChild(delBtn);

            card.addEventListener('click', function () {
                applyFontToSelection(fontEntry.font);
            });

            fontsListContainer.appendChild(card);
        });

        refreshPanelHeightIfOpen('fonts');
    }

    function applyFontToSelection(postscriptFont) {
        if (!csInterface) return;
        showStatus("Applying font...");

        var script = "applyFontToSelectedTextLayers(" + JSON.stringify(postscriptFont) + ")";
        csInterface.evalScript(script, function (res) {
            if (res === 'NO_SELECTION') {
                showStatus("Select a text layer in timeline.");
                return;
            }
            if (res === 'NOT_TEXT_LAYER') {
                showStatus("Selected layer isn't a text layer.");
                return;
            }
            if (!res || res.indexOf('ERROR') === 0) {
                showStatus(res ? ("Error: " + res.substring(0, 120)) : "Could not apply font.");
                return;
            }
            showStatus("Font applied!");
        });
    }

    // Convierte una ruta de disco (Windows o Mac) en una URL file:// válida
    // para usarla como background-image.
    function pathToFileUrl(fsPath) {
        if (!fsPath) return '';
        var normalized = fsPath.replace(/\\/g, '/');
        if (normalized.charAt(0) !== '/') normalized = '/' + normalized; // C:/... -> /C:/...
        return 'file://' + encodeURI(normalized).replace(/#/g, '%23');
    }

    function renderLogoItems() {
        logoListContainer.innerHTML = '';

        if (!state.mediaItems || state.mediaItems.length === 0) {
            logoListContainer.innerHTML = '<div class="logo-empty">No media imported yet.</div>';
            refreshPanelHeightIfOpen('logo');
            return;
        }

        state.mediaItems.forEach(function (media, idx) {
            var card = document.createElement('div');
            card.className = 'logo-card';

            var thumb = document.createElement('div');
            thumb.className = 'logo-thumb';
            if (media.thumb) {
                thumb.style.backgroundImage = "url('" + pathToFileUrl(media.thumb) + "')";
            }

            var name = document.createElement('div');
            name.className = 'logo-name';
            name.textContent = media.name;
            name.title = media.name;

            var delBtn = document.createElement('button');
            delBtn.className = 'logo-card-delete';
            delBtn.title = 'Remove from list';
            delBtn.textContent = '×';
            delBtn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                state.mediaItems.splice(idx, 1);
                saveStateToDisk();
                renderLogoItems();
                showStatus("Removed from list.");
            });

            card.appendChild(thumb);
            card.appendChild(name);
            card.appendChild(delBtn);

            card.addEventListener('click', function () {
                insertMediaIntoComp(media.id, media.file, idx);
            });

            logoListContainer.appendChild(card);
        });

        refreshPanelHeightIfOpen('logo');
    }

    function insertMediaIntoComp(itemId, filePath, idx) {
        if (!csInterface) return;
        showStatus("Adding to composition...");

        var script = "insertMediaByIdOrPath(" + itemId + ", " + JSON.stringify(filePath || "") + ")";
        csInterface.evalScript(script, function (res) {
            if (res === 'NO_COMP') {
                showStatus("Open a composition first.");
                return;
            }
            if (res === 'ITEM_NOT_FOUND') {
                showStatus("Couldn't find or re-import that file.");
                return;
            }
            if (!res || res.indexOf('ERROR') === 0) {
                showStatus(res ? ("Error: " + res.substring(0, 120)) : "Could not add media.");
                return;
            }

            var result;
            try { result = JSON.parse(res); } catch (err) { result = null; }

            // Si tuvo que reimportarse (el item ya no estaba en el proyecto),
            // el id cambia: lo actualizamos para que el próximo clic sea directo.
            if (result && result.reimported && result.newId && typeof idx === 'number' && state.mediaItems[idx]) {
                state.mediaItems[idx].id = result.newId;
                saveStateToDisk();
            }

            showStatus("Added to composition!");
        });
    }

    function importMedia() {
        if (!csInterface) return;
        showStatus("Waiting for file selection...");

        csInterface.evalScript("importMediaFile()", function (res) {
            if (res === 'CANCELLED') {
                showStatus("Ready");
                return;
            }
            if (res === 'NO_VALID_FILES') {
                showStatus("Couldn't import those files.");
                return;
            }
            if (!res || res.indexOf('ERROR') === 0) {
                showStatus(res ? ("Error: " + res.substring(0, 120)) : "Could not import media.");
                return;
            }

            var imported;
            try {
                imported = JSON.parse(res);
            } catch (err) {
                showStatus("Could not read imported media.");
                return;
            }

            var addedCount = 0;
            imported.forEach(function (media) {
                var exists = state.mediaItems.some(function (m) { return m.id === media.id; });
                if (!exists) {
                    state.mediaItems.push(media);
                    addedCount++;
                }
            });

            saveStateToDisk();
            renderLogoItems();
            showStatus(addedCount > 0 ? ("Imported " + addedCount + " file(s)!") : "Already imported.");
        });
    }

    function applyColorToActiveLayer(hex) {
        if (!csInterface) return;
        var script = "app.beginUndoGroup('Apply Vantyx Color'); try { var sel = app.project.activeItem && app.project.activeItem instanceof CompItem ? app.project.activeItem.selectedLayers : []; var hexStr = '" + hex + "'; var hexClean = hexStr.replace('#', ''); var rgb = [parseInt(hexClean.substring(0,2),16)/255, parseInt(hexClean.substring(2,4),16)/255, parseInt(hexClean.substring(4,6),16)/255]; var applied = false; for (var i = 0; i < sel.length; i++) { var layer = sel[i]; try { var effects = layer.property('ADBE Effect Parade'); if (effects) { for (var e = 1; e <= effects.numProperties; e++) { var fx = effects.property(e); if (fx.property('Color')) { fx.property('Color').setValue(rgb); applied = true; } if (fx.property('Map Black To')) { fx.property('Map Black To').setValue(rgb); applied = true; } if (fx.property('Map White To')) { fx.property('Map White To').setValue(rgb); applied = true; } } } } catch(err1) {} try { var textProp = layer.property('Source Text'); if (textProp) { var doc = textProp.value; doc.fillColor = rgb; textProp.setValue(doc); applied = true; } } catch(err2) {} try { var contents = layer.property('Contents'); if (contents) { for (var c = 1; c <= contents.numProperties; c++) { var group = contents.property(c); if (group && group.property('Contents')) { var fill = group.property('Contents').property('Fill 1'); if (fill && fill.property('Color')) { fill.property('Color').setValue(rgb); applied = true; } } } } } catch(err3) {} } app.endUndoGroup(); applied; } catch(e) { app.endUndoGroup(); false; }";

        csInterface.evalScript(script, function (res) {
            if (res === "true") {
                showStatus("Color applied to layer/effect!");
            } else {
                showStatus("Swatch selected.");
            }
        });
    }

    function updateColorControls(hex, index) {
        if (!hex) {
            selectedSwatchLabel.textContent = "Manual Color (No Selection)";
            hexDisplay.textContent = "#------";
            hexInput.value = "";
            return;
        }

        selectedSwatchLabel.textContent = "Manual Color (Swatch " + (index + 1) + ")";
        hexDisplay.textContent = hex.toUpperCase();
        hexInput.value = hex.toUpperCase();
        manualColorPicker.value = hex;
    }

    function setPanelCollapsed(headerEl, contentEl, collapsed) {
        if (collapsed) {
            headerEl.classList.add('is-collapsed');
            contentEl.classList.add('is-collapsed');
            contentEl.style.maxHeight = '0px';
        } else {
            headerEl.classList.remove('is-collapsed');
            contentEl.classList.remove('is-collapsed');
            // scrollHeight real: el panel crece lo que haga falta sin cortar
            // contenido, por muchos elementos que se hayan guardado.
            contentEl.style.maxHeight = contentEl.scrollHeight + 'px';
        }
    }

    // Recalcula la altura de un panel ya abierto tras añadir/quitar
    // elementos (p.ej. al importar más media o guardar más fuentes).
    function refreshPanelHeightIfOpen(panelId) {
        var headerEl = document.querySelector('.collapsible-toggle[data-panel="' + panelId + '"]');
        var contentEl = document.getElementById(panelId + 'PanelContent');
        if (!headerEl || !contentEl) return;
        if (!headerEl.classList.contains('is-collapsed')) {
            contentEl.style.maxHeight = contentEl.scrollHeight + 'px';
        }
    }

    function setupCollapsiblePanels() {
        var toggles = document.querySelectorAll('.collapsible-toggle');
        toggles.forEach(function (headerEl) {
            var panelId = headerEl.getAttribute('data-panel');
            var contentEl = document.getElementById(panelId + 'PanelContent');
            if (!contentEl) return;

            var collapsed = !!state.collapsedPanels[panelId];
            setPanelCollapsed(headerEl, contentEl, collapsed);

            headerEl.addEventListener('click', function () {
                var nowCollapsed = !headerEl.classList.contains('is-collapsed');
                setPanelCollapsed(headerEl, contentEl, nowCollapsed);
                state.collapsedPanels[panelId] = nowCollapsed;
                saveStateToDisk();
            });
        });
    }

    function setupEventListeners() {
        btnAddMedia.addEventListener('click', function () {
            importMedia();
        });

        btnAddFont.addEventListener('click', function () {
            if (!csInterface) return;
            showStatus("Reading font from selection...");

            csInterface.evalScript("getSelectedTextLayerFont()", function (res) {
                if (res === 'NO_SELECTION') {
                    showStatus("Select a layer in timeline.");
                    return;
                }
                if (res === 'NOT_TEXT_LAYER') {
                    showStatus("Selected layer isn't a text layer.");
                    return;
                }
                if (!res || res.indexOf('ERROR') === 0) {
                    showStatus(res ? ("Error: " + res.substring(0, 120)) : "Could not read font.");
                    return;
                }

                var fontData;
                try {
                    fontData = JSON.parse(res);
                } catch (err) {
                    showStatus("Could not read font data.");
                    return;
                }
                if (!fontData || !fontData.font) {
                    showStatus("Could not read font data.");
                    return;
                }

                var alreadySaved = state.fonts.some(function (f) { return f.font === fontData.font; });
                if (alreadySaved) {
                    showStatus("That font is already saved.");
                    return;
                }

                state.fonts.push(fontData);
                saveStateToDisk();
                renderFonts();
                showStatus("Font saved: " + (fontData.fontFamily || fontData.font));
            });
        });

        btnAddColor.addEventListener('click', function () {
            state.kits[state.currentKitIndex].colors.push("#FFFFFF");
            state.selectedColorIndex = state.kits[state.currentKitIndex].colors.length - 1;
            saveStateToDisk();
            renderKitsDropdown();
            renderSwatches();
            showStatus("Color added!");
        });

        btnRemoveColor.addEventListener('click', function () {
            var currentColors = state.kits[state.currentKitIndex].colors;
            if (currentColors.length === 0) return;

            currentColors.splice(state.selectedColorIndex, 1);
            if (state.selectedColorIndex >= currentColors.length) {
                state.selectedColorIndex = currentColors.length - 1;
            }
            saveStateToDisk();
            renderKitsDropdown();
            renderSwatches();
            showStatus("Color removed.");
        });

        kitSelect.addEventListener('change', function (e) {
            state.currentKitIndex = parseInt(e.target.value, 10);
            state.selectedColorIndex = 0;
            saveStateToDisk();
            renderKitsDropdown();
            renderSwatches();
        });

        manualColorPicker.addEventListener('input', function (e) {
            updateSelectedColor(e.target.value);
            applyColorToActiveLayer(e.target.value);
        });

        hexInput.addEventListener('change', function (e) {
            var val = e.target.value.trim();
            if (!val.startsWith('#')) val = '#' + val;
            if (/^#[0-9A-F]{6}$/i.test(val)) {
                updateSelectedColor(val);
                applyColorToActiveLayer(val);
            }
        });

        btnNewKit.addEventListener('click', function () {
            var kitName = prompt("Name for the new kit:", "New Kit " + (state.kits.length + 1));
            if (kitName && kitName.trim() !== '') {
                state.kits.push({ name: kitName.trim(), colors: ["#FFFFFF"] });
                state.currentKitIndex = state.kits.length - 1;
                state.selectedColorIndex = 0;
                saveStateToDisk();
                renderKitsDropdown();
                renderSwatches();
                showStatus("Kit created!");
            }
        });

        btnRenameKit.addEventListener('click', function () {
            var currentKit = state.kits[state.currentKitIndex];
            var newName = prompt("Rename kit:", currentKit.name);
            if (newName && newName.trim() !== '') {
                currentKit.name = newName.trim();
                saveStateToDisk();
                renderKitsDropdown();
                showStatus("Kit renamed!");
            }
        });

        btnDeleteKit.addEventListener('click', function () {
            if (state.kits.length <= 1) {
                alert("You must keep at least one kit!");
                return;
            }

            var currentKit = state.kits[state.currentKitIndex];
            if (confirm('Are you sure you want to delete "' + currentKit.name + '"?')) {
                state.kits.splice(state.currentKitIndex, 1);
                state.currentKitIndex = Math.max(0, state.currentKitIndex - 1);
                state.selectedColorIndex = 0;
                saveStateToDisk();
                renderKitsDropdown();
                renderSwatches();
                showStatus("Kit deleted.");
            }
        });

        // BOTÓN PRINCIPAL: PULL COLORS
        // Llama a pullColorsFromSelectedLayers() definida en vtx-main.jsx, que muestrea
        // en cuadrícula el/los Footage seleccionados (imagen o vídeo) usando
        // sampleImage() real sobre el frame actual, descarta solo píxeles
        // transparentes (nunca por ser negros) y deduplica por tolerancia de
        // color (no por hex exacto), para no llenar la paleta de casi-duplicados.
        btnPullLayers.addEventListener('click', function () {
            showStatus("Sampling layer colors...");

            if (!csInterface) return;

            csInterface.evalScript("pullColorsFromSelectedLayers()", function (res) {
                if (res === 'NO_SELECTION') {
                    showStatus("Select a layer in timeline.");
                    return;
                }
                if (res === 'NO_COLORS') {
                    showStatus("No colors detected in layer.");
                    return;
                }
                if (res && res.indexOf('NO_COLORS_DEBUG:') === 0) {
                    showStatus("No colors. Debug: " + res.substring('NO_COLORS_DEBUG:'.length));
                    return;
                }
                if (!res || res.indexOf('ERROR') === 0) {
                    showStatus(res ? ("Error: " + res.substring(0, 120)) : "Could not sample layer.");
                    return;
                }

                var extracted;
                try {
                    extracted = JSON.parse(res);
                } catch (err) {
                    showStatus("Could not read sampled colors.");
                    return;
                }

                if (!extracted || extracted.length === 0) {
                    showStatus("No colors detected in layer.");
                    return;
                }

                var currentColors = state.kits[state.currentKitIndex].colors;
                var addedCount = 0;
                extracted.forEach(function (hex) {
                    var exists = false;
                    for (var i = 0; i < currentColors.length; i++) {
                        if (currentColors[i].toLowerCase() === hex.toLowerCase()) {
                            exists = true;
                            break;
                        }
                    }
                    if (!exists) {
                        currentColors.push(hex);
                        addedCount++;
                    }
                });

                if (addedCount > 0) {
                    saveStateToDisk();
                    renderKitsDropdown();
                    renderSwatches();
                    showStatus("Added " + addedCount + " colors to kit!");
                } else {
                    showStatus("All sampled colors were already in the kit.");
                }
            });
        });

        // BOTÓN: FROM SELECTION
        btnEyedropper.addEventListener('click', function () {
            showStatus("Reading selection...");
            if (!csInterface) return;

            csInterface.evalScript("getSelectedLayerRealColor()", function (res) {
                if (res === 'NO_SELECTION') {
                    showStatus("Select a layer in timeline.");
                    return;
                }
                if (res === 'NO_COLOR') {
                    showStatus("Could not read a color from that layer.");
                    return;
                }
                if (!res || res.indexOf('ERROR') === 0) {
                    showStatus(res ? ("Error: " + res.substring(0, 120)) : "Could not read selection.");
                    return;
                }
                if (res.indexOf('#') === 0) {
                    updateSelectedColor(res);
                    showStatus("Color captured!");
                } else {
                    showStatus("Select a valid layer.");
                }
            });
        });
    }

    function updateSelectedColor(hex) {
        var currentColors = state.kits[state.currentKitIndex].colors;
        if (currentColors.length > 0 && state.selectedColorIndex >= 0) {
            currentColors[state.selectedColorIndex] = hex;
            saveStateToDisk();
            renderSwatches();
        }
    }

    var _statusRevertTimer = null;

    function showStatus(msg) {
        statusBar.textContent = msg;
        // Ya no se auto-borra: si el proceso tarda varios segundos (el
        // render+decode puede llegar a 5s), el mensaje real desaparecía
        // antes de que se pudiera leer. Se queda fijo hasta la próxima acción.
        if (_statusRevertTimer) { clearTimeout(_statusRevertTimer); _statusRevertTimer = null; }
    }

    document.addEventListener('DOMContentLoaded', init);

})();