/**
 * APP.JS - Hacienda El Copihue - Catálogo Interactivo (Lectura)
 */

(() => {
    let map;
    let lotesLayer;
    let selectedLote = null;
    let highlightedLayer = null;
    let userMarker = null;

    const IS_READ_ONLY = true; // Constante para modo catálogo

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

            let loaded = false;
            const forceLoad = setTimeout(() => {
                if (!loaded) {
                    hideLoading();
                    loaded = true;
                }
            }, 5000);

            // ── Sync con Google Sheets (Solo bajada) ──
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
            console.error('Error during init:', error);
            hideLoading();
        }
    }

    function showLoading() {
        const bar = document.querySelector('.loading-bar-inner');
        if (bar) {
            let w = 0;
            const interval = setInterval(() => {
                w += Math.random() * 25;
                if (w > 90) w = 90;
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
            zoomControl: false, maxZoom: 20, minZoom: 13, attributionControl: false
        });

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 20
        }).addTo(map);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
            maxZoom: 20, opacity: 0.6
        }).addTo(map);

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
        const estado = props.estado || props.Estado || 'Disponible';
        
        document.getElementById('bs-lote-id').textContent = `Lote ${props.id_lote}`;
        document.getElementById('bs-lote-area').textContent = props.area;
        
        const displayPrice = (props.precio !== undefined && props.precio !== null) ? DataModule.formatPrice(props.precio) : DataModule.formatPrice(33000000);
        document.getElementById('bs-price-value').textContent = estado === 'Vendida' ? DataModule.formatPrice(0) : (props.precio_display || displayPrice);
        
        const badge = document.getElementById('bs-current-status');
        badge.className = `bottomsheet__current-status bottomsheet__current-status--${estado.toLowerCase()}`;
        badge.innerHTML = `<span>●</span> ${estado}`;

        const vendidaInfo = document.getElementById('bs-vendida-info');
        if (estado === 'Vendida') {
            vendidaInfo.style.display = 'block';
            vendidaInfo.textContent = '🔒 Lote Vendido';
        } else {
            vendidaInfo.style.display = 'none';
        }

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
        if (highlightedLayer) {
            const colors = ESTADO_COLORS[highlightedLayer.feature.properties.estado] || ESTADO_COLORS['Disponible'];
            highlightedLayer.setStyle({ weight: 2, fillOpacity: colors.opacity, color: colors.stroke });
            highlightedLayer = null;
        }
    }

    function updateStats() {
        const stats = DataModule.getStats();
        if (document.getElementById('stat-disponible')) document.getElementById('stat-disponible').textContent = stats.disponible;
        if (document.getElementById('stat-reservada')) document.getElementById('stat-reservada').textContent = stats.reservada;
        if (document.getElementById('stat-vendida')) document.getElementById('stat-vendida').textContent = stats.vendida;
    }

    function setupEventListeners() {
        document.getElementById('bs-close').addEventListener('click', closeBottomSheet);
        document.getElementById('bottomsheet-overlay').addEventListener('click', closeBottomSheet);
        document.getElementById('search-btn').addEventListener('click', searchLote);
        document.getElementById('search-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchLote();
        });
        document.getElementById('fab-locate').addEventListener('click', locateUser);
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
            iconSize: [40, 40], iconAnchor: [20, 20]
        });
        userMarker = L.marker(e.latlng, { icon: gpsIcon }).addTo(map);
    }

    function onLocationError() {
        document.getElementById('fab-locate').classList.remove('locating');
    }

    function searchLote() {
        const val = document.getElementById('search-input').value.trim();
        const searchId = String(val).replace(/[^0-9]/g, '').replace(/^0+/, '') || '0';
        let found = null;
        lotesLayer.eachLayer(l => {
            const loteId = String(l.feature.properties.id_lote || '').replace(/[^0-9]/g, '').replace(/^0+/, '') || '0';
            if (loteId === searchId) found = l;
        });
        if (found) selectLote(found.feature, found);
    }

    document.addEventListener('DOMContentLoaded', init);
})();
