/**
 * APP.JS - Hacienda El Copihue - Mobile Management App
 */

(() => {
    let map;
    let lotesLayer;
    let selectedLote = null;
    let isOnline = true;
    let highlightedLayer = null;
    let userMarker = null;

    const ESTADO_COLORS = {
        'Disponible': { fill: '#22c55e', stroke: '#16a34a', opacity: 0.45 },
        'Reservada': { fill: '#eab308', stroke: '#ca8a04', opacity: 0.5 },
        'Vendida': { fill: '#ef4444', stroke: '#dc2626', opacity: 0.45 },
    };

    function init() {
        try {
            showLoading();
            DataModule.init();
            initMap();
            renderLotes();
            updateStats();
            setupEventListeners();
            simulateOnlineStatus();

            let loaded = false;
            const forceLoad = setTimeout(() => {
                if (!loaded) {
                    console.warn('Sync taking too long, showing map with local data...');
                    hideLoading();
                    loaded = true;
                }
            }, 5000);

            // ── Sync con Google Sheets ──
            if (typeof SyncModule !== 'undefined') {
                SyncModule.init('El Copihue')
                    .then(function() {
                        renderLotes();
                        updateStats();
                    })
                    .finally(() => {
                        if (!loaded) {
                            clearTimeout(forceLoad);
                            hideLoading();
                            loaded = true;
                        }
                    });
            } else {
                hideLoading();
                loaded = true;
            }
        } catch (error) {
            console.error('Error during El Copihue initialization:', error);
            hideLoading();
        }
    }

    window.refreshMap = function() {
        renderLotes();
        updateStats();
    };

    function showLoading() {
        const bar = document.querySelector('.loading-bar-inner');
        if (bar) {
            let w = 0;
            const interval = setInterval(() => {
                w += Math.random() * 25;
                if (w > 90) w = 90; // Stay at 90 until hideLoading completes
                bar.style.width = w + '%';
                if (w >= 90) clearInterval(interval);
            }, 100);
        }
    }

    function hideLoading() {
        const bar = document.querySelector('.loading-bar-inner');
        if (bar) bar.style.width = '100%';

        setTimeout(() => {
            const screen = document.querySelector('.loading-screen');
            if (screen) {
                screen.classList.add('fade-out');
                setTimeout(() => screen.remove(), 500);
            }
        }, 600);
    }

    function initMap() {
        map = L.map('map', {
            zoomControl: false,
            maxZoom: 20,
            minZoom: 13,
            attributionControl: false
        });

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 20
        }).addTo(map);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
            maxZoom: 20, opacity: 0.6
        }).addTo(map);

        // Center on El Copihue
        map.setView([-36.1205, -71.7770], 16);

        map.on('locationfound', onLocationFound);
        map.on('locationerror', onLocationError);

        function updateLabelsVisibility() {
            if (map.getZoom() < 16) map.getContainer().classList.add('map-low-zoom');
            else map.getContainer().classList.remove('map-low-zoom');
        }
        map.on('zoomend', updateLabelsVisibility);
        updateLabelsVisibility();

        map.on('click', (e) => {
            if (!e.originalEvent._loteClicked) closeBottomSheet();
        });
    }

    function renderLotes() {
        if (lotesLayer) map.removeLayer(lotesLayer);
        const collection = DataModule.getAll();

        // ── Filter invalid geometries to prevent Leaflet crash ──
        const validFeatures = collection.features.filter(f => 
            f.geometry && f.geometry.coordinates && f.geometry.coordinates.length > 0
        );
        const validCollection = { ...collection, features: validFeatures };

        lotesLayer = L.geoJSON(validCollection, {
            style: (feature) => {
                const colors = ESTADO_COLORS[feature.properties.estado] || ESTADO_COLORS['Disponible'];
                return { fillColor: colors.fill, fillOpacity: colors.opacity, color: colors.stroke, weight: 2 };
            },
            onEachFeature: (feature, layer) => {
                layer.bindTooltip(`Lote ${feature.properties.id_lote}`, {
                    permanent: true, direction: 'center', className: 'lote-label'
                });
                layer.on('click', (e) => {
                    e.originalEvent._loteClicked = true;
                    selectLote(feature, layer);
                });
            }
        }).addTo(map);
    }

    function selectLote(feature, layer) {
        selectedLote = feature;
        if (highlightedLayer) {
            const prev = ESTADO_COLORS[highlightedLayer.feature.properties.estado] || ESTADO_COLORS['Disponible'];
            highlightedLayer.setStyle({ weight: 2, fillOpacity: prev.opacity });
        }
        highlightedLayer = layer;
        layer.setStyle({ weight: 4, fillOpacity: 0.8, color: '#fff' });

        const props = feature.properties;
        const estado = props.estado || props.Estado || 'Disponible'; // Fallback safety
        const isVendida = estado === 'Vendida';

        document.getElementById('bs-lote-id').textContent = `Lote ${props.id_lote}`;
        document.getElementById('bs-lote-area').textContent = props.area;
        
        const displayPrice = (props.precio !== undefined && props.precio !== null) ? DataModule.formatPrice(props.precio) : DataModule.formatPrice(33000000);
        const finalPriceDisplay = isVendida ? DataModule.formatPrice(0) : (props.precio_display || displayPrice);
        document.getElementById('bs-price-value').textContent = finalPriceDisplay;
        
        const badge = document.getElementById('bs-current-status');
        badge.className = `bottomsheet__current-status bottomsheet__current-status--${estado.toLowerCase()}`;
        badge.innerHTML = `<span>●</span> ${estado}`;

        // Buttons
        document.querySelectorAll('.status-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.estado === estado);
        });

        // Visibility
        document.querySelector('.status-buttons').style.display = 'grid';
        document.getElementById('price-row').style.display = 'flex';
        
        const vendidaInfo = document.getElementById('bs-vendida-info');
        if (isVendida) {
            vendidaInfo.style.display = 'block';
            vendidaInfo.innerHTML = '⚠️ <b>Lote marcado como Vendido.</b><br>Edite con precaución si desea cambiar el estado.';
            vendidaInfo.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
            vendidaInfo.style.color = '#ef4444';
        } else {
            vendidaInfo.style.display = 'none';
        }

        // Last modified
        const date = props.ultima_modificacion ? new Date(props.ultima_modificacion) : new Date();
        document.getElementById('bs-last-modified').textContent = 
            `Última actualización: ${date.toLocaleDateString('es-CL')} ${date.toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'})}`;

        // Comment
        closeCommentPanel();
        const comentario = props.comentario || '';
        document.getElementById('comment-textarea').value = comentario;
        updateCommentPreview(comentario);

        openBottomSheet();
        map.flyTo(layer.getBounds().getCenter(), 18, { duration: 0.5 });
    }

    function openBottomSheet() {
        document.getElementById('bottomsheet').classList.add('active');
        document.getElementById('bottomsheet-overlay').classList.add('active');
        document.querySelector('.stats-bar').classList.add('hidden');
    }

    function closeBottomSheet() {
        document.getElementById('bottomsheet').classList.remove('active');
        document.getElementById('bottomsheet-overlay').classList.remove('active');
        document.querySelector('.stats-bar').classList.remove('hidden');
        closeCommentPanel();
        if (highlightedLayer) {
            const colors = ESTADO_COLORS[highlightedLayer.feature.properties.estado] || ESTADO_COLORS['Disponible'];
            highlightedLayer.setStyle({ weight: 2, fillOpacity: colors.opacity, color: colors.stroke });
            highlightedLayer = null;
        }
    }

    function closeCommentPanel() {
        const btn = document.getElementById('comment-toggle-btn');
        const panel = document.getElementById('comment-panel');
        if (btn) btn.classList.remove('open');
        if (panel) panel.classList.remove('open');
    }

    function updateCommentPreview(text) {
        const preview = document.getElementById('comment-btn-preview');
        const deleteBtn = document.getElementById('comment-delete-btn');
        if (!preview) return;
        if (text && text.trim()) {
            preview.textContent = text.trim();
            preview.classList.add('has-comment');
            if (deleteBtn) deleteBtn.classList.add('visible');
        } else {
            preview.textContent = 'Agregar comentario...';
            preview.classList.remove('has-comment');
            if (deleteBtn) deleteBtn.classList.remove('visible');
        }
    }

    function changeStatus(newEstado) {
        if (!selectedLote) return;
        const loteId = selectedLote.properties.id_lote;

        // ── 1. Update in-place FIRST (guarantees visual update) ──
        selectedLote.properties.estado = newEstado;
        selectedLote.properties.Estado = newEstado;

        // ── 2. Persist to DataModule + localStorage ──
        const updates = { estado: newEstado };
        if (newEstado === 'Vendida') {
            updates.precio = 0;
            selectedLote.properties.precio = 0;
            selectedLote.properties.precio_display = DataModule.formatPrice(0);
        }
        DataModule.updateLote(loteId, updates);

        // ── 3. Sync to Google Sheets (fire-and-forget) ──
        if (typeof SyncModule !== 'undefined') {
            SyncModule.push(loteId, updates);
        }

        // ── 4. Re-render map with updated colors ──
        renderLotes();
        updateStats();
        
        // ── 5. Re-find the new layer after re-render ──
        const updated = DataModule.getLoteById(loteId);
        let newLayer = null;
        if (lotesLayer) {
            const searchId = String(loteId).replace(/[^0-9]/g, '').replace(/^0+/, '') || '0';
            lotesLayer.eachLayer(l => {
                const lid = String(l.feature.properties.id_lote || '').replace(/[^0-9]/g, '').replace(/^0+/, '') || '0';
                if (lid === searchId) newLayer = l;
            });
        }
        if (updated && newLayer) {
            highlightedLayer = newLayer;
            selectLote(updated, newLayer);
        }
        showToast(`Lote ${loteId} → ${newEstado}`, 'success');
    }

    function updateStats() {
        const stats = DataModule.getStats();
        document.getElementById('stat-disponible').textContent = stats.disponible;
        document.getElementById('stat-reservada').textContent = stats.reservada;
        document.getElementById('stat-vendida').textContent = stats.vendida;
    }

    function setupEventListeners() {
        // Reset Button in Header
        const resetBtn = document.getElementById('header-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (confirm('¿Estás seguro de que deseas restablecer los datos locales? Se volverán a descargar desde el servidor.')) {
                    DataModule.reset();
                }
            });
        }

        document.getElementById('bs-close').addEventListener('click', closeBottomSheet);
        document.getElementById('bottomsheet-overlay').addEventListener('click', closeBottomSheet);
        document.querySelectorAll('.status-btn').forEach(btn => {
            btn.addEventListener('click', () => changeStatus(btn.dataset.estado));
        });
        document.getElementById('search-btn').addEventListener('click', searchLote);
        document.getElementById('search-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchLote();
        });
        document.getElementById('fab-locate').addEventListener('click', locateUser);

        const populateBtn = document.getElementById('header-populate-btn');
        if (populateBtn) {
            populateBtn.addEventListener('click', pushAllToCloud);
        }

        // Comment toggle
        document.getElementById('comment-toggle-btn').addEventListener('click', () => {
            const btn = document.getElementById('comment-toggle-btn');
            const panel = document.getElementById('comment-panel');
            const isOpen = btn.classList.toggle('open');
            panel.classList.toggle('open', isOpen);
            if (isOpen) document.getElementById('comment-textarea').focus();
        });

        // Save comment
        document.getElementById('comment-save-btn').addEventListener('click', () => {
            if (!selectedLote) return;
            const text = document.getElementById('comment-textarea').value.trim();
            DataModule.updateLote(selectedLote.properties.id_lote, { comentario: text });

            // Sync to Google Sheets if configured
            if (typeof SyncModule !== 'undefined') {
                SyncModule.push(selectedLote.properties.id_lote, { comentario: text });
            }

            // Update local feature so preview stays correct
            selectedLote.properties.comentario = text;
            updateCommentPreview(text);
            closeCommentPanel();
            showToast('Comentario guardado ✓', 'success');
        });

        // Delete comment
        document.getElementById('comment-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (!selectedLote) return;
            DataModule.updateLote(selectedLote.properties.id_lote, { comentario: '' });
            if (typeof SyncModule !== 'undefined') {
                SyncModule.push(selectedLote.properties.id_lote, { comentario: '' });
            }
            selectedLote.properties.comentario = '';
            document.getElementById('comment-textarea').value = '';
            updateCommentPreview('');
            closeCommentPanel();
            showToast('Comentario borrado', 'info');
        });

        // ── Price Numpad ──
        let numpadValue = '';
        const numpadOverlay = document.getElementById('numpad-overlay');
        const numpadDisplayValue = document.getElementById('numpad-display-value');

        if (document.getElementById('price-row')) {
            document.getElementById('price-row').addEventListener('click', () => {
                if (!selectedLote) return;
                numpadValue = String(selectedLote.properties.precio || '');
                updateNumpadDisplay();
                if (numpadOverlay) numpadOverlay.classList.add('active');
            });
        }

        if (document.getElementById('numpad-cancel')) {
            document.getElementById('numpad-cancel').addEventListener('click', () => {
                if (numpadOverlay) numpadOverlay.classList.remove('active');
            });
        }

        document.querySelectorAll('.numpad__key').forEach(key => {
            key.addEventListener('click', () => {
                const k = key.dataset.key;
                if (k === 'back') {
                    numpadValue = numpadValue.slice(0, -1);
                } else if (k === 'confirm') {
                    const precio = numpadValue === '' ? 0 : parseInt(numpadValue, 10);
                    if (isNaN(precio) || precio < 0) {
                        showToast('Ingresa un precio válido', 'warning');
                        return;
                    }
                    if (selectedLote) {
                        DataModule.updateLote(selectedLote.properties.id_lote, { precio: precio });
                        if (typeof SyncModule !== 'undefined') {
                            SyncModule.push(selectedLote.properties.id_lote, { precio: precio });
                        }
                        selectedLote.properties.precio = precio;
                        selectedLote.properties.precio_display = DataModule.formatPrice(precio);
                        document.getElementById('bs-price-value').textContent = DataModule.formatPrice(precio);
                        showToast('Precio actualizado ✓', 'success');
                    }
                    if (numpadOverlay) numpadOverlay.classList.remove('active');
                } else {
                    if (numpadValue.length < 12) numpadValue += k;
                }
                updateNumpadDisplay();
            });
        });

        function updateNumpadDisplay() {
            const val = parseInt(numpadValue, 10) || 0;
            if (numpadDisplayValue) {
                numpadDisplayValue.innerHTML = '<span class="currency">$</span> ' + val.toLocaleString('es-CL');
            }
        }
    }

    function locateUser() {
        const btn = document.getElementById('fab-locate');
        btn.classList.add('locating');
        map.locate({ setView: true, maxZoom: 18 });
    }

    function onLocationFound(e) {
        const btn = document.getElementById('fab-locate');
        btn.classList.remove('locating');
        
        if (userMarker) map.removeLayer(userMarker);
        
        const gpsIcon = L.divIcon({
            className: 'gps-marker',
            html: '<div class="gps-marker__pulse"></div><div class="gps-marker__dot"></div>',
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });

        userMarker = L.marker(e.latlng, { icon: gpsIcon }).addTo(map);
    }

    function onLocationError(e) {
        const btn = document.getElementById('fab-locate');
        btn.classList.remove('locating');
        showToast('No se pudo obtener la ubicación', 'warning');
    }

    function searchLote() {
        const val = document.getElementById('search-input').value.trim();
        const searchId = String(val).replace(/[^0-9]/g, '').replace(/^0+/, '') || '0';
        let found = null;
        lotesLayer.eachLayer(l => {
            const loteId = String(l.feature.properties.id_lote || l.feature.properties.Lote).replace(/[^0-9]/g, '').replace(/^0+/, '') || '0';
            if (loteId === searchId) found = l;
        });
        if (found) selectLote(found.feature, found);
        else showToast('Lote no encontrado', 'warning');
    }

    function showToast(msg, type) {
        const t = document.createElement('div');
        t.className = `toast toast--${type}`;
        t.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${msg}`;
        document.getElementById('toast-container').appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }

    async function pushAllToCloud() {
        const btn = document.getElementById('header-populate-btn');
        const originalVal = btn.innerHTML;
        btn.style.opacity = '0.5';
        btn.disabled = true;

        const allLotesMap = new Map();

        // ESTRATEGIA REDUNDANTE: App de Gestión
        const sources = [
            { data: window.json_Disponibles_2, est: 'Disponible' },
            { data: window.json_Vendidas_3, est: 'Vendida' },
            { data: window.json_Reservadas_4, est: 'Reservada' }
        ];

        sources.forEach(src => {
            if (src.data && src.data.features) {
                src.data.features.forEach(f => {
                    const id = normalizeID(f.properties.id_lote || f.properties.Lote || f.properties.name || f.properties.fid);
                    if (id && id !== '0') {
                        allLotesMap.set(id, {
                            lote: id,
                            estado: f.properties.estado || f.properties.Estado || src.est,
                            precio: f.properties.precio || f.properties.Precio || 0
                        });
                    }
                });
            }
        });

        const allLotes = Array.from(allLotesMap.values());

        if (!confirm(`¿Deseas poblar el Excel con los ${allLotes.length} lotes detectados?`)) {
            btn.style.opacity = '1';
            btn.disabled = false;
            return;
        }

        try {
            const url = 'https://script.google.com/macros/s/AKfycbxK1Fx2zqNrqPmciYgUQ7gOyj66qu6584VWMzfgvoGsjMKTV89ZprBRnjZa5ESb2dYV/exec';
            await fetch(url, {
                method: 'POST',
                mode: 'no-cors',
                body: JSON.stringify({
                    action: 'populate',
                    proyecto: 'El Copihue',
                    lotes: allLotes
                })
            });
            alert('¡Poblado Maestro Exitoso! ' + allLotes.length + ' lotes enviados al Excel.');
            if (typeof SyncModule !== 'undefined') SyncModule.sync();
        } catch (e) {
            alert('Error: ' + e.message);
        } finally {
            btn.style.opacity = '1';
            btn.disabled = false;
        }
    }

    function normalizeID(id) {
        return String(id || '').replace(/[^0-9]/g, '').replace(/^0+/, '') || '0';
    }

    function simulateOnlineStatus() {
        isOnline = navigator.onLine;
        window.addEventListener('online', () => isOnline = true);
        window.addEventListener('offline', () => isOnline = false);
    }

    // ── Start ──
    document.addEventListener('DOMContentLoaded', init);
})();
