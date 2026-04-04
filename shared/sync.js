/**
 * SYNC.JS — Módulo de sincronización con Google Sheets
 * CRM 5 Tierras — Compartido entre todos los proyectos
 * 
 * Depende de: shared this/config.js (debe cargarse antes)
 */
const SyncModule = (() => {
    let projectName = '';
    let syncInterval = null;
    let isSyncing = false;

    function isConfigured() {
        return typeof CRM_CONFIG !== 'undefined' && 
               CRM_CONFIG.APPS_SCRIPT_URL && 
               CRM_CONFIG.APPS_SCRIPT_URL !== 'PEGA_TU_URL_AQUI';
    }

    /**
     * Inicializar el módulo para un proyecto específico
     */
    function init(name) {
        projectName = name;
        
        if (!isConfigured()) {
            console.warn('SyncModule: URL no configurada. Modo offline.');
            updateSyncIndicator('offline');
            return Promise.resolve(null);
        }

        updateSyncIndicator('syncing');

        return fetchFromSheet()
            .then(data => {
                updateSyncIndicator('online');
                pushPendingChanges();
                if (CRM_CONFIG.SYNC_INTERVAL > 0) {
                    syncInterval = setInterval(() => {
                        fetchFromSheet().then(() => updateSyncIndicator('online'));
                    }, CRM_CONFIG.SYNC_INTERVAL);
                }
                return data;
            })
            .catch(err => {
                console.warn('SyncModule: Error de conexión.', err);
                updateSyncIndicator('offline');
                return null;
            });
    }

    /**
     * Leer datos del proyecto desde Google Sheets
     */
    function fetchFromSheet() {
        if (!isConfigured()) return Promise.resolve(null);

        const url = CRM_CONFIG.APPS_SCRIPT_URL + '?action=read&proyecto=' + encodeURIComponent(projectName);
        
        return fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.error) {
                    console.warn('SyncModule fetch error:', data.error);
                    return null;
                }
                if (data.lotes && data.lotes.length > 0 && typeof DataModule !== 'undefined') {
                    applyRemoteData(data.lotes);
                }
                return data.lotes;
            });
    }

    /**
     * Aplicar datos remotos al DataModule local
     */
    function applyRemoteData(remoteLotes) {
        if (!remoteLotes || remoteLotes.length === 0) return;

        var collection = DataModule.getAll();
        var changed = false;

        remoteLotes.forEach(function(remoteLote) {
            var localFeature = collection.features.find(function(f) {
                return String(f.properties.id_lote) === String(remoteLote.Lote);
            });

            if (localFeature) {
                if (remoteLote.Estado && remoteLote.Estado !== localFeature.properties.estado) {
                    localFeature.properties.estado = remoteLote.Estado;
                    changed = true;
                }

                if (remoteLote.Comentario !== undefined && remoteLote.Comentario !== localFeature.properties.comentario) {
                    localFeature.properties.comentario = remoteLote.Comentario || '';
                    changed = true;
                }

                if (remoteLote.Precio) {
                    var precio = typeof remoteLote.Precio === 'number' 
                        ? remoteLote.Precio 
                        : parseInt(String(remoteLote.Precio).replace(/[^0-9]/g, ''), 10) || 0;
                    if (precio > 0 && precio !== localFeature.properties.precio) {
                        localFeature.properties.precio = precio;
                        localFeature.properties.precio_display = DataModule.formatPrice(precio);
                        changed = true;
                    }
                }
            }
        });

        if (changed && DataModule.STORAGE_KEY) {
            localStorage.setItem(DataModule.STORAGE_KEY, JSON.stringify(collection));
        }
    }

    /**
     * Enviar actualización de un lote a Google Sheets
     */
    function pushUpdate(loteId, updates) {
        if (!isConfigured()) {
            addToPendingQueue(loteId, updates);
            return Promise.resolve(false);
        }

        updateSyncIndicator('syncing');

        var payload = {
            proyecto: projectName,
            lote: String(loteId),
            modificado_por: 'App CRM'
        };

        if (updates.estado !== undefined) payload.estado = updates.estado;
        if (updates.precio !== undefined) payload.precio = updates.precio;
        if (updates.area !== undefined) payload.area = updates.area;
        if (updates.comentario !== undefined) payload.comentario = updates.comentario;

        return fetch(CRM_CONFIG.APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        })
        .then(function() {
            updateSyncIndicator('online');
            return true;
        })
        .catch(function(err) {
            console.warn('SyncModule push error:', err);
            addToPendingQueue(loteId, updates);
            updateSyncIndicator('pending');
            return false;
        });
    }

    /**
     * Cola de cambios pendientes (modo offline)
     */
    function addToPendingQueue(loteId, updates) {
        var key = 'crm_sync_pending_' + projectName;
        var queue = JSON.parse(localStorage.getItem(key) || '[]');
        queue.push({ loteId: loteId, updates: updates, timestamp: new Date().toISOString() });
        localStorage.setItem(key, JSON.stringify(queue));
        updateSyncIndicator('pending');
    }

    function pushPendingChanges() {
        if (!isConfigured() || isSyncing) return;
        
        var key = 'crm_sync_pending_' + projectName;
        var queue = JSON.parse(localStorage.getItem(key) || '[]');
        
        if (queue.length === 0) return;

        isSyncing = true;
        console.log('SyncModule: Enviando ' + queue.length + ' cambios pendientes...');

        var sendNext = function(index) {
            if (index >= queue.length) {
                localStorage.setItem(key, '[]');
                isSyncing = false;
                updateSyncIndicator('online');
                return;
            }

            var item = queue[index];
            var payload = {
                proyecto: projectName,
                lote: String(item.loteId),
                modificado_por: 'App CRM'
            };
            if (item.updates.estado !== undefined) payload.estado = item.updates.estado;
            if (item.updates.precio !== undefined) payload.precio = item.updates.precio;
            if (item.updates.comentario !== undefined) payload.comentario = item.updates.comentario;

            fetch(CRM_CONFIG.APPS_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify(payload)
            })
            .then(function() { sendNext(index + 1); })
            .catch(function() {
                isSyncing = false;
                updateSyncIndicator('pending');
            });
        };

        sendNext(0);
    }

    /**
     * Indicador visual de sincronización
     */
    function updateSyncIndicator(status) {
        var indicator = document.getElementById('sync-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'sync-indicator';
            indicator.style.cssText = 
                'position:fixed;top:12px;right:12px;padding:6px 14px;' +
                'border-radius:20px;font-size:12px;font-weight:600;' +
                'font-family:Inter,sans-serif;z-index:10000;' +
                'transition:all 0.3s ease;backdrop-filter:blur(10px);' +
                'cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
            indicator.addEventListener('click', function() {
                if (isConfigured()) {
                    updateSyncIndicator('syncing');
                    fetchFromSheet().then(function() {
                        updateSyncIndicator('online');
                        if (typeof window.refreshMap === 'function') window.refreshMap();
                    });
                }
            });
            document.body.appendChild(indicator);
        }

        var styles = {
            online:  { bg: 'rgba(34,197,94,0.9)',  text: '☁️ Sincronizado',    color: '#fff' },
            syncing: { bg: 'rgba(59,130,246,0.9)',  text: '🔄 Sincronizando...', color: '#fff' },
            pending: { bg: 'rgba(234,179,8,0.9)',   text: '⏳ Pendiente',        color: '#000' },
            offline: { bg: 'rgba(107,114,128,0.7)', text: '📴 Offline',          color: '#fff' }
        };

        var s = styles[status] || styles.offline;
        indicator.style.backgroundColor = s.bg;
        indicator.style.color = s.color;
        indicator.textContent = s.text;
    }

    return {
        init: init,
        push: pushUpdate,
        fetch: fetchFromSheet,
        isConfigured: isConfigured,
        pushPendingChanges: pushPendingChanges
    };
})();
