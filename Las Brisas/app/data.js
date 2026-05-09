/**
 * DATA.JS - Data Management Module (Normalized)
 * Project: Las Brisas
 * Standardized version based on El Copihue
 */

const DataModule = (() => {
    const STORAGE_KEY = 'hacienda_brisas_lotes';
    const DATA_VERSION = 'v11_standard_numpad';
    const PROJECT_NAME = 'Las Brisas';
    const MAP_CONFIG = {
        center: [-36.385, -71.953],
        zoom: 16
    };

    const MAPPING = {
        id_lote: ['Lote', 'name', 'fid', 'id'],
        area: ['Area', 'superficie'],
        estado: ['Estado', 'status']
    };

    function normID(id) {
        return String(id || '').replace(/[^0-9]/g, '').replace(/^0+/, '') || '0';
    }

    let lotesData = {
        type: "FeatureCollection",
        features: []
    };

    function init() {
        if (localStorage.getItem(STORAGE_KEY + '_version') !== DATA_VERSION) {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(STORAGE_KEY + '_sync');
            localStorage.setItem(STORAGE_KEY + '_version', DATA_VERSION);
        }

        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            lotesData = JSON.parse(saved);
            lotesData.features.forEach(f => { 
                if (!f.properties.id_lote) f.properties.id_lote = findProp(f.properties, MAPPING.id_lote) || 'S/N'; 
            });
            // REGLA: No llamamos a syncStatus aquí para no sobrescribir datos que ya han bajado de la nube
        } else {
            processBatch(window.json_Disponibles_5, 'Disponible');
            processBatch(window.json_Vendidas_4, 'Vendida');
            processBatch(window.json_Reservadas_6, 'Reservada');
            save();
        }
    }

    function syncStatus(geoJson, newEstado) {
        if (!geoJson || !geoJson.features) return;
        geoJson.features.forEach(f => {
            const id = findProp(f.properties, MAPPING.id_lote);
            const lote = getLoteById(id);
            if (lote) {
                if (newEstado === 'Vendida' || (newEstado === 'Reservada' && lote.properties.estado === 'Disponible')) {
                    if (lote.properties.estado !== newEstado) {
                        lote.properties.estado = newEstado;
                        lote.properties.ultima_modificacion = new Date().toISOString();
                    }
                }
                if (f.properties.Precio) {
                    const cleanPrice = sanitizeNumber(f.properties.Precio);
                    if (cleanPrice !== null) lote.properties.precio = cleanPrice;
                }
            }
        });
    }

    function sanitizeNumber(val) {
        if (val === null || val === undefined || val === '') return null;
        if (typeof val === 'number') return val;
        const clean = String(val).replace(/[^0-9]/g, '');
        return clean === '' ? 0 : parseInt(clean, 10);
    }

    function processBatch(geoJson, defaultEstado) {
        if (!geoJson || !geoJson.features) return;

        geoJson.features.forEach(f => {
            const id_lote = findProp(f.properties, MAPPING.id_lote) || 'S/N';
            const area = findProp(f.properties, MAPPING.area) || '5.000 m²';
            const estado = findProp(f.properties, MAPPING.estado) || defaultEstado;
            const cleanPrecio = sanitizeNumber(f.properties.Precio || f.properties.precio || 0);

            const normalizedFeature = {
                type: "Feature",
                geometry: f.geometry,
                properties: {
                    ...f.properties,
                    id_lote: id_lote,
                    area: area,
                    estado: estado,
                    precio: cleanPrecio,
                    ultima_modificacion: new Date().toISOString()
                }
            };
            lotesData.features.push(normalizedFeature);
        });
    }

    function findProp(props, alternates) {
        for (const key of alternates) {
            if (props[key] !== undefined && props[key] !== null) return props[key];
        }
        return null;
    }

    function getAll() { return lotesData; }

    function getLoteById(id) {
        const nid = normID(id);
        return lotesData.features.find(f => normID(f.properties.id_lote || f.properties.Lote) === nid);
    }

    function updateLote(id, newData) {
        const lote = getLoteById(id);
        if (lote) {
            // Unificar propiedades (Case Insensitive)
            if (newData.estado) newData.Estado = newData.estado;
            if (newData.Estado) newData.estado = newData.Estado;
            if (newData.precio !== undefined) newData.Precio = newData.precio;
            if (newData.Precio !== undefined) newData.precio = newData.Precio;
            if (newData.comentario !== undefined) newData.Comentario = newData.comentario;
            if (newData.Comentario !== undefined) newData.comentario = newData.Comentario;

            lote.properties = { ...lote.properties, ...newData, ultima_modificacion: new Date().toISOString() };
            save();
            addToSyncQueue(id, newData);
        }
    }

    function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(lotesData)); }

    function reset() {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY + '_sync');
        location.reload();
    }

    function addToSyncQueue(id, data) {
        let queue = JSON.parse(localStorage.getItem(STORAGE_KEY + '_sync') || '[]');
        queue.push({ id, data, timestamp: new Date().toISOString() });
        localStorage.setItem(STORAGE_KEY + '_sync', JSON.stringify(queue));
    }

    function getSyncQueue() { return JSON.parse(localStorage.getItem(STORAGE_KEY + '_sync') || '[]'); }
    function clearSyncQueue() { localStorage.setItem(STORAGE_KEY + '_sync', '[]'); }
    
    function formatPrice(val) {
        if (!val && val !== 0) return '$ 0';
        if (typeof val === 'string' && val.includes('$')) return val;
        const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.-]+/g,""));
        if (isNaN(num)) return val;
        return new Intl.NumberFormat('es-CL', { 
            style: 'currency', 
            currency: 'CLP',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(num).replace('CLP', '$');
    }

    function getStats() {
        const stats = { disponible: 0, reservada: 0, vendida: 0 };
        lotesData.features.forEach(f => {
            const e = String(f.properties.estado).toLowerCase();
            if (e.includes('disp')) stats.disponible++;
            else if (e.includes('res')) stats.reservada++;
            else if (e.includes('vend')) stats.vendida++;
        });
        return stats;
    }

    return { 
        STORAGE_KEY, PROJECT_NAME, MAP_CONFIG,
        init, getAll, getLoteById, updateLote, getStats, reset, getSyncQueue, clearSyncQueue, formatPrice 
    };
})();
