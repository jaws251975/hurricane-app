
'use strict';

/* =====================================================
   STORMWATCH — LIVE STORMS + OFFICIAL NHC FORECAST
   ===================================================== */

const DATA_URL =
    'https://www.nhc.noaa.gov/CurrentStorms.json';

const BACKUP_URLS = [
    'https://api.allorigins.win/raw?url=' +
        encodeURIComponent(DATA_URL),

    'https://corsproxy.io/?url=' +
        encodeURIComponent(DATA_URL),

    'https://proxy.cors.dev/' + DATA_URL
];

const NHC_MAP_SERVICE =
    'https://mapservices.weather.noaa.gov/tropical/rest/services/' +
    'tropical/NHC_tropical_weather_summary/MapServer/';

const REFRESH_INTERVAL = 5 * 60 * 1000;
const REQUEST_TIMEOUT = 12000;

const $ = id => document.getElementById(id);

let storms = [];
let selectedStormId = null;
let liveMap = null;
let liveMarkers = null;
let forecastLayers = [];
let loadingLive = false;
let loadingForecast = false;
let lastGoodData = null;
let refreshTimer = null;


/* ----------------- GENERAL HELPERS ----------------- */

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

function finiteNumber(value) {
    if (value === null || value === undefined || value === '') {
        return NaN;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
}

function firstNumber(...values) {
    for (const value of values) {
        const number = finiteNumber(value);
        if (Number.isFinite(number)) return number;
    }
    return NaN;
}

async function fetchJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
        const response = await fetch(url, {
            cache: 'no-store',
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }

        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

function setStatus(message, title = '') {
    const element = $('last-updated');
    if (!element) return;

    element.textContent = message;
    element.title = title;
}

function showListMessage(message) {
    const list = $('storm-list');
    if (list) {
        list.innerHTML =
            '<div class="error-state">' + escapeHTML(message) + '</div>';
    }
}


/* ----------------- LIVE NOAA DATA ----------------- */

// Different responses/proxies can wrap the JSON differently.
// Accept the usual NOAA shape and common proxy wrappers.
function extractStorms(data) {
    const candidates = [
        data,
        data?.data,
        data?.body,
        data?.contents
    ];

    for (const candidate of candidates) {
        if (candidate && Array.isArray(candidate.activeStorms)) {
            return candidate.activeStorms;
        }

        if (typeof candidate === 'string') {
            try {
                const parsed = JSON.parse(candidate);
                if (Array.isArray(parsed.activeStorms)) {
                    return parsed.activeStorms;
                }
            } catch (_) {
                // Try the next candidate.
            }
        }
    }

    throw new Error('NOAA response did not contain activeStorms.');
}


async function fetchStorms() {
    const errors = [];

    // Try NOAA directly first.
    try {
        const data = await fetchJSON(DATA_URL);
        return extractStorms(data);
    } catch (error) {
        errors.push('NOAA: ' + (error.message || 'request failed'));
        console.warn('Direct NOAA request failed:', error);
    }

    // Try each backup service in order.
    for (const url of BACKUP_URLS) {
        try {
            const data = await fetchJSON(url);
            return extractStorms(data);
        } catch (error) {
            errors.push(
                url.includes('allorigins')
                    ? 'AllOrigins: ' + (error.message || 'request failed')
                    : 'cors.dev: ' + (error.message || 'request failed')
            );
            console.warn('Backup NOAA request failed:', error);
        }
    }

    throw new Error(errors.join(' | '));
}



/* ----------------- STORM DETAILS ----------------- */

function stormName(storm) {
    return storm.name || storm.stormName || 'Unnamed system';
}

function stormId(storm, index) {
    return String(storm.id || storm.stormId || stormName(storm) + '-' + index);
}

function stormTypeCode(storm) {
    return String(storm.classification || storm.type || '')
        .trim().toUpperCase();
}

function stormType(storm) {
    const types = {
        TD: 'Tropical Depression',
        TS: 'Tropical Storm',
        HU: 'Hurricane',
        TY: 'Typhoon',
        ST: 'Super Typhoon',
        EX: 'Extratropical',
        LO: 'Low',
        SD: 'Subtropical Depression',
        SS: 'Subtropical Storm',
        DB: 'Disturbance'
    };

    const code = stormTypeCode(storm);
    return types[code] || code || 'Tropical system';
}

function windMph(storm) {
    for (const value of [
        storm.intensity,
        storm.maxWind,
        storm.windSpeed
    ]) {
        if (typeof value === 'number') return value;

        if (typeof value === 'string') {
            const match = value.match(/(\d+(?:\.\d+)?)\s*(mph|kt|kts|knots?)?/i);
            if (match) {
                const speed = Number(match[1]);
                const unit = (match[2] || '').toLowerCase();
                return ['kt', 'kts', 'knot', 'knots'].includes(unit)
                    ? speed * 1.15078
                    : speed;
            }
        }
    }

    return NaN;
}

function windKnots(storm) {
    const mph = windMph(storm);
    return Number.isFinite(mph) ? mph / 1.15078 : NaN;
}

function windText(storm) {
    const mph = windMph(storm);
    return Number.isFinite(mph) ? Math.round(mph) + ' mph' : 'Not reported';
}

function categoryInfo(storm) {
    const type = stormTypeCode(storm);
    const knots = windKnots(storm);

    if (type === 'TD' || type === 'SD') {
        return { label: type, color: '#22c55e', size: 42 };
    }

    if (type === 'TS' || type === 'SS') {
        return { label: type, color: '#22c55e', size: 42 };
    }

    if (['HU', 'TY'].includes(type) && Number.isFinite(knots)) {
        if (knots >= 137) return { label: '5', color: '#7f1d1d', size: 48 };
        if (knots >= 113) return { label: '4', color: '#dc2626', size: 46 };
        if (knots >= 96) return { label: '3', color: '#f87171', size: 44 };
        if (knots >= 83) return { label: '2', color: '#f97316', size: 42 };
        if (knots >= 64) return { label: '1', color: '#facc15', size: 40 };
    }

    return { label: type || '?', color: '#94a3b8', size: 42 };
}

function coordinate(value) {
    if (typeof value === 'number') return value;
    if (value === null || value === undefined) return NaN;

    const match = String(value).trim().toUpperCase().match(
        /^(-?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?$/
    );

    if (!match) return NaN;

    let result = Number(match[1]);
    if (match[2] === 'S' || match[2] === 'W') result = -Math.abs(result);
    if (match[2] === 'N' || match[2] === 'E') result = Math.abs(result);

    return result;
}

function stormCoordinates(storm) {
    const lat = coordinate(
        storm.latitude_numeric ?? storm.latitudeNumeric ??
        storm.latitude ?? storm.lat
    );
    const lon = coordinate(
        storm.longitude_numeric ?? storm.longitudeNumeric ??
        storm.longitude ?? storm.lon
    );

    if (
        Number.isFinite(lat) && Number.isFinite(lon) &&
        Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ) {
        return [lat, lon];
    }

    return null;
}


/* ----------------- MOVEMENT DIRECTION ----------------- */

function movementDegrees(storm) {
    const numeric = firstNumber(
        storm.movementDir,
        storm.movementDirectionDegrees,
        storm.directionDegrees
    );

    if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 360) {
        return numeric % 360;
    }

    const text = [
        typeof storm.movement === 'string' ? storm.movement : '',
        typeof storm.movementDirection === 'string' ? storm.movementDirection : '',
        typeof storm.direction === 'string' ? storm.direction : ''
    ].join(' ').toUpperCase();

    const match = text.match(
        /\b(NNE|ENE|ESE|SSE|SSW|WSW|WNW|NNW|NE|SE|SW|NW|N|E|S|W)\b/
    );

    if (!match) return NaN;

    const degrees = {
        N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
        E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
        S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
        W: 270, WNW: 292.5, NW: 315, NNW: 337.5
    };

    return degrees[match[1]];
}

function movementText(storm) {
    const degrees = movementDegrees(storm);
    if (!Number.isFinite(degrees)) return 'Not reported';

    const compass = [
        'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
        'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
    ];

    return compass[Math.round(degrees / 22.5) % 16];
}


/* ----------------- STRIPED HURRICANE MARKER ----------------- */

// The category is drawn inside the SVG, so no separate label can cover it.
// The red-and-white curved bands keep the simpler original-style marker.
function hurricaneIconHTML(label, color) {
    const safeLabel = escapeHTML(label || '?');
    const fontSize = safeLabel.length > 2 ? 9 : 13;

    return `
        <svg class="storm-swirl"
             viewBox="0 0 48 48"
             role="img"
             aria-label="Storm ${safeLabel}">
            <circle cx="24" cy="24" r="21"
                    fill="#ffffff" stroke="${color}" stroke-width="2.5"/>

            <path d="M24 3 A21 21 0 0 1 45 24 L35 24 A11 11 0 0 0 24 13 Z"
                  fill="#e52222"/>
            <path d="M45 24 A21 21 0 0 1 24 45 L24 35 A11 11 0 0 0 35 24 Z"
                  fill="#e52222"/>
            <path d="M24 45 A21 21 0 0 1 3 24 L13 24 A11 11 0 0 0 24 35 Z"
                  fill="#e52222"/>
            <path d="M3 24 A21 21 0 0 1 24 3 L24 13 A11 11 0 0 0 13 24 Z"
                  fill="#e52222"/>

            <circle cx="24" cy="24" r="10.5"
                    fill="#ffffff" stroke="${color}" stroke-width="2"/>
            <text x="24" y="28.5"
                  text-anchor="middle"
                  font-family="Arial, Helvetica, sans-serif"
                  font-size="${fontSize}"
                  font-weight="900"
                  fill="#111827">${safeLabel}</text>
        </svg>
    `;
}

function directionArrowHTML(storm) {
    const degrees = movementDegrees(storm);
    if (!Number.isFinite(degrees)) return '';

    return `
        <span class="storm-direction-arrow"
              title="Reported movement direction"
              style="transform:rotate(${degrees}deg)">
            <span class="storm-direction-shaft"></span>
            <span class="storm-direction-head"></span>
        </span>
    `;
}


/* ----------------- MAP INITIALIZATION ----------------- */

function initializeMap() {
    const element = $('map');
    if (!element || liveMap) return;

    if (typeof L === 'undefined') {
        showListMessage(
            'The map library did not load. Check your connection and reload.'
        );
        return;
    }

    liveMap = L.map(element, {
        zoomControl: true,
        preferCanvas: true,

        // Keep the map within one copy of the world.
        maxBounds: [[-85, -180], [85, 180]],
        maxBoundsViscosity: 1
    }).setView([20, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        noWrap: true,
        bounds: [[-85, -180], [85, 180]],
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(liveMap);

    liveMarkers = L.layerGroup().addTo(liveMap);

    setTimeout(() => liveMap?.invalidateSize(), 300);
}



/* ----------------- OFFICIAL NHC FORECAST LAYERS ----------------- */

// NHC service: 7 = forecast cone, 6 = forecast track, 5 = forecast points.
async function loadForecastLayers() {
    if (!liveMap || typeof L === 'undefined' || loadingForecast) return;

    loadingForecast = true;
    const newLayers = [];

    try {
        for (const item of [
            { id: 7, kind: 'cone' },
            { id: 6, kind: 'track' },
            { id: 5, kind: 'points' }
        ]) {
            const url = NHC_MAP_SERVICE + item.id +
                '/query?where=1%3D1&outFields=*&returnGeometry=true' +
                '&outSR=4326&f=geojson';

            let data;
            try {
                data = await fetchJSON(url);
            } catch (error) {
                console.warn('Could not load NHC forecast layer ' + item.id, error);
                continue;
            }

            if (!Array.isArray(data.features) || !data.features.length) continue;

            const layer = L.geoJSON(data, {
                style: () => item.kind === 'cone'
                    ? {
                        color: '#e52222',
                        weight: 2,
                        opacity: 0.95,
                        fillColor: '#e52222',
                        fillOpacity: 0.18
                    }
                    : {
                        color: '#e52222',
                        weight: 3,
                        opacity: 1
                    },

                pointToLayer: (feature, latlng) => {
                    const p = feature.properties || {};

                    if (item.kind !== 'points') {
                        return L.circleMarker(latlng, { radius: 4 });
                    }

                    const time = p.datelbl || p.DATELBL ||
                        p.fldatelbl || p.FL_DATELBL || 'Forecast position';

                    const rawWind = firstNumber(
                        p.maxwind, p.MAXWIND, p.vmax, p.VMAX,
                        p.max_wind, p.MAX_WIND
                    );

                    const unit = String(
                        p.windunit || p.WINDUNIT || p.units || p.UNITS || ''
                    ).toLowerCase();

                    const forecastWind = Number.isFinite(rawWind)
                        ? Math.round(
                            unit.includes('kt') || unit.includes('knot')
                                ? rawWind * 1.15078
                                : rawWind
                          ) + ' mph'
                        : 'Wind not supplied';

                    const icon = L.divIcon({
                        className: 'forecast-wind-icon',
                        html: '<span class="forecast-wind-label">' +
                            escapeHTML(time) + '<br>' +
                            escapeHTML(forecastWind) + '</span>',
                        iconSize: [124, 36],
                        iconAnchor: [62, 18]
                    });

                    return L.marker(latlng, { icon }).bindPopup(
                        '<strong>' + escapeHTML(p.stormname || p.STORMNAME || 'NHC forecast') +
                        '</strong><br>' + escapeHTML(time) + '<br>' +
                        escapeHTML(forecastWind) +
                        '<br><small>Official NHC forecast. Values depend on the available data.</small>'
                    );
                },

                onEachFeature: (feature, shape) => {
                    const p = feature.properties || {};
                    const name = p.stormname || p.STORMNAME || 'Tropical system';

                    if (item.kind === 'cone') {
                        shape.bindPopup(
                            '<strong>' + escapeHTML(name) + '</strong><br>' +
                            'Official NHC forecast cone. It shows track uncertainty, ' +
                            'not the exact area of impacts.'
                        );
                    } else if (item.kind === 'track') {
                        shape.bindPopup(
                            '<strong>' + escapeHTML(name) + '</strong><br>' +
                            'Official NHC forecast track.'
                        );
                    }
                }
            });

            layer.addTo(liveMap);
            newLayers.push(layer);
        }

        // Replace old forecast layers only after this refresh is complete.
        forecastLayers.forEach(layer => {
            if (liveMap?.hasLayer(layer)) liveMap.removeLayer(layer);
        });
        forecastLayers = newLayers;

    } catch (error) {
        console.warn('Forecast layers could not be refreshed:', error);
        // Keep the previous forecast display if a refresh fails.
        newLayers.forEach(layer => {
            if (liveMap?.hasLayer(layer)) liveMap.removeLayer(layer);
        });
    } finally {
        loadingForecast = false;
    }
}


/* ----------------- DRAW LIVE STORMS ----------------- */

function renderMap() {
    if (!liveMap || !liveMarkers || typeof L === 'undefined') return;

    liveMarkers.clearLayers();

    storms.forEach(storm => {
        const coords = stormCoordinates(storm);
        if (!coords) return;

        const category = categoryInfo(storm);
        const size = category.size;

        const icon = L.divIcon({
            className: 'storm-div-icon',
            html:
                '<div class="storm-pin" style="--storm-color:' +
                category.color + ';">' +
                    hurricaneIconHTML(category.label, category.color) +
                    directionArrowHTML(storm) +
                '</div>',
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
            popupAnchor: [0, -size / 2]
        });

        const popup =
            '<strong>' + escapeHTML(stormName(storm)) + '</strong><br>' +
            escapeHTML(stormType(storm)) + '<br>' +
            'Maximum wind: ' + escapeHTML(windText(storm)) + '<br>' +
            'Movement: ' + escapeHTML(movementText(storm)) + '<br>' +
            coords[0].toFixed(2) + '°, ' + coords[1].toFixed(2) + '°';

        L.marker(coords, { icon }).addTo(liveMarkers).bindPopup(popup);
    });
}


/* ----------------- STORM LIST + DETAILS ----------------- */

function renderDetails(storm) {
    const detail = $('detail');
    if (!detail) return;

    if (!storm) {
        detail.innerHTML =
            '<p class="eyebrow">STORM DETAILS</p>' +
            '<p class="detail-placeholder">No active storm is selected.</p>';
        return;
    }

    const coords = stormCoordinates(storm);
    const position = coords
        ? coords[0].toFixed(2) + '°, ' + coords[1].toFixed(2) + '°'
        : 'Not reported';

    const advisory = storm.publicAdvisory?.url;
    const officialURL =
        typeof advisory === 'string' &&
        /^https:\/\/www\.nhc\.noaa\.gov\//i.test(advisory)
            ? advisory
            : 'https://www.nhc.noaa.gov/';

    detail.innerHTML =
        '<p class="eyebrow">STORM DETAILS</p>' +
        '<p class="detail-title">' + escapeHTML(stormName(storm)) + '</p>' +
        '<div class="detail-grid">' +
            '<div class="detail-item"><span>CLASSIFICATION</span><strong>' +
                escapeHTML(stormType(storm)) + '</strong></div>' +
            '<div class="detail-item"><span>MAX WIND</span><strong>' +
                escapeHTML(windText(storm)) + '</strong></div>' +
            '<div class="detail-item"><span>POSITION</span><strong>' +
                escapeHTML(position) + '</strong></div>' +
            '<div class="detail-item"><span>MOVEMENT</span><strong>' +
                escapeHTML(movementText(storm)) + '</strong></div>' +
        '</div>' +
        '<p class="detail-placeholder"><a href="' + escapeHTML(officialURL) +
        '" target="_blank" rel="noopener noreferrer">Official storm information</a></p>';
}

function renderStormList() {
    const list = $('storm-list');
    if (!list) return;

    const count = $('storm-count');
    if (count) count.textContent = String(storms.length);

    if (!storms.length) {
        list.innerHTML =
            '<div class="empty-state">NOAA currently lists no active tropical systems.</div>';
        renderDetails(null);
        return;
    }

    list.innerHTML = storms.map((storm, index) => {
        const coords = stormCoordinates(storm);
        const position = coords
            ? coords[0].toFixed(1) + '°, ' + coords[1].toFixed(1) + '°'
            : 'Position unavailable';

        const selected = stormId(storm, index) === selectedStormId
            ? ' selected'
            : '';

        const category = categoryInfo(storm);

        return '<button type="button" class="storm-card' + selected +
            '" data-index="' + index + '">' +
            '<div class="storm-name-row">' +
                '<span class="storm-name">' + escapeHTML(stormName(storm)) + '</span>' +
                '<span class="storm-type">' + escapeHTML(category.label) + '</span>' +
            '</div>' +
            '<div class="storm-summary">' +
                '<span>Wind: ' + escapeHTML(windText(storm)) + '</span>' +
                '<span>' + escapeHTML(position) + '</span>' +
            '</div>' +
        '</button>';
    }).join('');

    list.querySelectorAll('.storm-card').forEach(button => {
        button.addEventListener('click', () => {
            const index = Number(button.dataset.index);
            const storm = storms[index];
            if (!storm) return;

            selectedStormId = stormId(storm, index);
            renderStormList();
            renderDetails(storm);

            const coords = stormCoordinates(storm);
            if (coords && liveMap) liveMap.flyTo(coords, 5);
        });
    });
}


/* ----------------- REFRESH + UNAVAILABLE-DATA FIX ----------------- */

async function loadLive() {
    if (loadingLive) return;
    loadingLive = true;

    const button = $('refresh-button');
    if (button) {
        button.disabled = true;
        button.textContent = 'Updating…';
    }

    if (!lastGoodData && $('storm-list')) {
        $('storm-list').innerHTML =
            '<div class="loading">Loading NOAA storm data…</div>';
    }

    try {
        const freshStorms = await fetchStorms();

        storms = freshStorms.filter(storm =>
            storm && typeof storm === 'object'
        );
        lastGoodData = new Date();

        if (!storms.some((storm, index) =>
            stormId(storm, index) === selectedStormId
        )) {
            selectedStormId = storms.length ? stormId(storms[0], 0) : null;
        }

        setStatus(
            'Updated ' + lastGoodData.toLocaleTimeString(),
            'Last successful live NOAA data fetch'
        );

        renderStormList();

        const selectedIndex = storms.findIndex((storm, index) =>
            stormId(storm, index) === selectedStormId
        );
        renderDetails(selectedIndex >= 0 ? storms[selectedIndex] : null);
        renderMap();

    } catch (error) {
        console.error('StormWatch data refresh failed:', error);

        if (lastGoodData) {
            // Do not erase good data just because one refresh failed.
            setStatus(
                'Refresh failed — showing last good data',
                'Last successful update: ' + lastGoodData.toLocaleString()
            );

            renderStormList();
            renderMap();

            const index = storms.findIndex((storm, i) =>
                stormId(storm, i) === selectedStormId
            );
            renderDetails(index >= 0 ? storms[index] : null);
        } else {
            setStatus('Data unavailable', error.message);
            showListMessage(
    'DATA ERROR: ' + (error.message || String(error))
);
            showListMessage(
                'Could not reach NOAA live data. Check your connection and try Refresh data again.'
            );
            console.error(error);
        }
    } finally {
        loadingLive = false;

        if (button) {
            button.disabled = false;
            button.textContent = '↻ Refresh data';
        }
    }
}


/* ----------------- STARTUP ----------------- */


function startStormWatch() {
    initializeMap();

    const button = $('refresh-button');

    async function refreshAllData() {
        if (loadingLive) return;

        if (button) {
            button.disabled = true;
            button.textContent = '↻ Refreshing…';
        }

        setStatus('Refreshing NOAA data…');

        try {
            await loadLive();

            // Wait for any existing forecast request to finish.
            while (loadingForecast) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            await loadForecastLayers();
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = '↻ Refresh data';
            }
        }
    }

    if (button) {
        button.addEventListener('click', refreshAllData);
    }

    // Load data on startup.
    loadLive();
    loadForecastLayers();

    if (refreshTimer) clearInterval(refreshTimer);

    // Keep automatic updates every five minutes.
    refreshTimer = setInterval(refreshAllData, REFRESH_INTERVAL);
}

/* =====================================================
   STORMWATCH — NATIONWIDE TORNADO WARNINGS
   Add this block at the END of script.js
   ===================================================== */

var tornadoWarningLayer = null;
var tornadoIconLayer = null;
var tornadoWarnings = [];
var tornadoLoading = false;
var tornadoLastSuccess = null;

async function loadTornadoWarnings() {
    if (tornadoLoading) return;
    tornadoLoading = true;

    const list = document.getElementById('tornado-list');
    const count = document.getElementById('tornado-count');
    const status = document.getElementById('tornado-status');

    if (status) status.textContent = 'Checking National Weather Service data…';

    try {
        const response = await fetch(
            'https://api.weather.gov/alerts/active?event=Tornado%20Warning',
            {
                cache: 'no-store',
                headers: {
                    'Accept': 'application/geo+json'
                }
            }
        );

        if (!response.ok) {
            throw new Error('Weather Service returned HTTP ' + response.status);
        }

        const data = await response.json();

        const freshWarnings = (data.features || []).filter(feature =>
            feature &&
            feature.properties &&
            String(feature.properties.event || '').toLowerCase() ===
                'tornado warning'
        );

        // Draw the new warning boundaries before removing the old ones.
        let newLayer = null;
let newIconLayer = null;

if (typeof L !== 'undefined' && liveMap) {
    newIconLayer = L.layerGroup();

    const tornadoIcon = L.divIcon({
        className: 'tornado-map-icon',
        html: '<span aria-label="Tornado warning">🌪️</span>',
        iconSize: [36, 36],
        iconAnchor: [18, 18]
    });

    freshWarnings.forEach(feature => {
        if (!feature.geometry) return;

        const warningShape = L.geoJSON(feature);
        const bounds = warningShape.getBounds();

        if (bounds.isValid()) {
            L.marker(bounds.getCenter(), {
                icon: tornadoIcon,
                title: 'Active Tornado Warning'
            }).addTo(newIconLayer);
        }
    });
}

        if (typeof L !== 'undefined' && liveMap) {
            newLayer = L.geoJSON(freshWarnings, {
                style: {
                    color: '#ff2020',
                    weight: 3,
                    opacity: 1,
                    fillColor: '#ff2020',
                    fillOpacity: 0.22
                },
                onEachFeature: (feature, layer) => {
                    const p = feature.properties || {};
                    const area = escapeHTML(p.areaDesc || 'Area not specified');
                    const headline = escapeHTML(
                        p.headline || 'Active Tornado Warning'
                    );
                    const expires = p.expires
                        ? new Date(p.expires).toLocaleString()
                        : 'Not provided';

                    layer.bindPopup(
                        '<strong style="color:#ff5050">' + headline + '</strong><br>' +
                        '<strong>Area:</strong> ' + area + '<br>' +
                        '<strong>Expires:</strong> ' + escapeHTML(expires) +
                        '<br><small>Official warning boundary, not a tornado track.</small>'
                    );
                }
            });
        }

        // Keep the previous layer if a replacement could not be created.
        if (newLayer && liveMap) {
            newLayer.addTo(liveMap);

            if (tornadoWarningLayer && liveMap.hasLayer(tornadoWarningLayer)) {
                liveMap.removeLayer(tornadoWarningLayer);
            }

            tornadoWarningLayer = newLayer;
        }

        tornadoWarnings = freshWarnings;
        tornadoLastSuccess = new Date();

        if (count) {
            count.textContent = String(tornadoWarnings.length);
        }

        if (status) {
            status.textContent =
                'Last checked ' + tornadoLastSuccess.toLocaleTimeString();
        }

        if (list) {
            if (!tornadoWarnings.length) {
                list.innerHTML =
                    '<div class="empty-state">' +
                    'No active tornado warnings were returned for the United States. ' +
                    'This does not mean severe weather is impossible.' +
                    '</div>';
            } else {
                list.innerHTML = tornadoWarnings.map((feature, index) => {
                    const p = feature.properties || {};
                    const area = escapeHTML(p.areaDesc || 'Area not specified');
                    const headline = escapeHTML(
                        p.headline || 'Tornado Warning'
                    );
                    const expires = p.expires
                        ? new Date(p.expires).toLocaleString()
                        : 'Expiration not provided';

                    return (
                        '<button type="button" class="tornado-card" data-tornado-index="' +
                        index + '">' +
                        '<span class="tornado-card-title">' + headline + '</span>' +
                        '<span class="tornado-card-area">' + area + '</span>' +
                        '<span class="tornado-card-expires">Expires: ' +
                        escapeHTML(expires) + '</span>' +
                        '</button>'
                    );
                }).join('');

                list.querySelectorAll('.tornado-card').forEach(button => {
                    button.addEventListener('click', () => {
                        const feature = tornadoWarnings[
                            Number(button.dataset.tornadoIndex)
                        ];

                        if (!feature || !liveMap || !tornadoWarningLayer) return;

                        const layer = tornadoWarningLayer.getLayers().find(item =>
                            item.feature === feature
                        );

                        if (layer && layer.getBounds && layer.getBounds().isValid()) {
                            liveMap.fitBounds(layer.getBounds(), {
                                padding: [25, 25],
                                maxZoom: 8
                            });
                            layer.openPopup();
                        }
                    });
                });
            }
        }
    } catch (error) {
        console.error('Tornado warning refresh failed:', error);

        if (status) {
            status.textContent = tornadoLastSuccess
                ? 'Refresh failed — showing last successfully loaded warnings'
                : 'Warning data unavailable. Try Refresh data again.';
        }

        if (count && !tornadoLastSuccess) {
            count.textContent = 'Unavailable';
        }

        if (list && !tornadoLastSuccess) {
            list.innerHTML =
                '<div class="error-state">' +
                'Could not load tornado warnings. Check your connection and try again.' +
                '</div>';
        }
    } finally {
        tornadoLoading = false;
    }
}

// Load warnings after the existing script has initialized the map.
loadTornadoWarnings();

// Reuse StormWatch's existing refresh button.
const tornadoRefreshButton = document.getElementById('refresh-button');

if (tornadoRefreshButton) {
    tornadoRefreshButton.addEventListener('click', loadTornadoWarnings);
}

// Refresh tornado warnings every five minutes too.
setInterval(loadTornadoWarnings, 5 * 60 * 1000);


/* Start StormWatch after the code has loaded */
startStormWatch();

/* Reload tornado warnings after the map initializes */
setTimeout(loadTornadoWarnings, 1500);



/* ==========================================
   STORMWATCH — GROUPED SEVERE WEATHER
   ========================================== */

const severeGroups = [
  {
    id: 'thunderstorms',
    title: 'Severe thunderstorms',
    color: '#ff9f43',
    events: ['Severe Thunderstorm Warning', 'Severe Thunderstorm Watch']
  },
  {
    id: 'tornadoes',
    title: 'Tornadoes',
    color: '#ff3030',
    events: ['Tornado Warning', 'Tornado Watch']
  },
  {
    id: 'flooding',
    title: 'Flooding',
    color: '#39a8ff',
    events: [
      'Flash Flood Warning', 'Flash Flood Watch',
      'Flood Warning', 'Flood Watch'
    ]
  },
  {
    id: 'wind',
    title: 'High winds',
    color: '#ffcf45',
    events: [
      'High Wind Warning', 'High Wind Watch',
      'Extreme Wind Warning'
    ]
  },
  {
    id: 'tropical',
    title: 'Hurricanes & tropical storms',
    color: '#e879f9',
    events: [
      'Hurricane Warning', 'Hurricane Watch',
      'Tropical Storm Warning', 'Tropical Storm Watch'
    ]
  },
  {
    id: 'winter',
    title: 'Winter weather',
    color: '#a5b4fc',
    events: [
      'Blizzard Warning', 'Winter Storm Warning',
      'Winter Storm Watch', 'Ice Storm Warning',
      'Winter Weather Advisory', 'Freeze Warning'
    ]
  },
  {
    id: 'heat',
    title: 'Heat',
    color: '#ff5b5b',
    events: ['Excessive Heat Warning', 'Heat Advisory']
  },
  {
    id: 'fire',
    title: 'Fire weather',
    color: '#fb7185',
    events: ['Red Flag Warning']
  }
];

let severeAlerts = [];
let severeLayer = null;
let severeLastSuccess = null;
let severeLoading = false;

function getSevereGroup(eventName) {
  return severeGroups.find(group =>
    group.events.includes(eventName)
  ) || { title: 'Other alerts', color: '#ffb35c', events: [] };
}

function renderSevereAlerts() {
  const list = document.getElementById('severe-list');
  if (!list) return;

  if (!severeAlerts.length) {
    list.innerHTML =
      '<div class="severe-empty">' +
      'No matching active alerts were returned. Check your local ' +
      'forecast even when this list is empty.' +
      '</div>';
    return;
  }

  list.innerHTML = severeGroups.map(group => {
    const alerts = severeAlerts.filter(feature =>
      group.events.includes(feature.properties?.event)
    );

    if (!alerts.length) return '';

    const cards = alerts.map(feature => {
      const p = feature.properties || {};
      const expires = p.expires
        ? new Date(p.expires).toLocaleString()
        : 'Not provided';

      return `
        <button type="button"
          class="severe-card"
          data-severe-id="${escapeHTML(String(feature.id || ''))}"
          style="--severe-color:${group.color}">
          <span class="severe-card-title">
            ${escapeHTML(p.event || 'Weather alert')}
          </span>
          <span class="severe-card-area">
            ${escapeHTML(p.areaDesc || 'Area not specified')}
          </span>
          <span class="severe-card-meta">
            Severity: ${escapeHTML(p.severity || 'Not specified')}
          </span>
          <span class="severe-card-meta">
            Expires: ${escapeHTML(expires)}
          </span>
          <span class="severe-card-area">
            ${escapeHTML(p.headline || '')}
          </span>
        </button>
      `;
    }).join('');

    return `
      <details class="severe-group">
        <summary class="severe-group-heading"
          style="--severe-color:${group.color}">
          <span>${group.title}</span>
          <span class="severe-group-count">${alerts.length}</span>
        </summary>
        <div class="severe-group-cards">${cards}</div>
      </details>
    `;
  }).join('');

  list.querySelectorAll('.severe-card').forEach(button => {
    button.addEventListener('click', () => {
      const feature = severeAlerts.find(item =>
        String(item.id || '') === button.dataset.severeId
      );

      if (!feature || !liveMap || typeof L === 'undefined') return;

      if (feature.geometry) {
        const shape = L.geoJSON(feature);
        const bounds = shape.getBounds();

        if (bounds.isValid()) {
          liveMap.fitBounds(bounds, {
            padding: [25, 25],
            maxZoom: 8
          });
        }
      }

      // Open the matching alert on the map, if it has a boundary.
      if (severeLayer) {
        severeLayer.eachLayer(layer => {
          if (layer.feature &&
              layer.feature.id === feature.id) {
            layer.openPopup();
          }
        });
      }
    });
  });
}

async function loadSevereWeather() {
  if (severeLoading) return;
  severeLoading = true;

  const list = document.getElementById('severe-list');
  const count = document.getElementById('severe-count');
  const status = document.getElementById('severe-status');

  if (status) {
    status.textContent = 'Checking National Weather Service alerts…';
  }

  try {
    const response = await fetch(
      'https://api.weather.gov/alerts/active?status=actual',
      {
        cache: 'no-store',
        headers: { Accept: 'application/geo+json' }
      }
    );

    if (!response.ok) {
      throw new Error('Weather Service HTTP ' + response.status);
    }

    const data = await response.json();

    const freshAlerts = (data.features || []).filter(feature => {
      const event = feature?.properties?.event;
      return severeGroups.some(group => group.events.includes(event));
    });

    // Draw all alert types on the map using category colors.
    let newLayer = null;

    if (typeof L !== 'undefined' && liveMap) {
      newLayer = L.geoJSON(
        freshAlerts.filter(feature => feature.geometry),
        {
          style: feature => {
            const group = getSevereGroup(
              feature.properties?.event || ''
            );

            return {
              color: group.color,
              weight: 2.5,
              opacity: 1,
              fillColor: group.color,
              fillOpacity: 0.18
            };
          },

          onEachFeature: (feature, layer) => {
            const p = feature.properties || {};
            const expires = p.expires
              ? new Date(p.expires).toLocaleString()
              : 'Not provided';
            const group = getSevereGroup(p.event || '');

            layer.bindPopup(
              '<strong style="color:' + group.color + '">' +
              escapeHTML(p.event || 'Weather alert') + '</strong><br>' +
              escapeHTML(p.headline || '') + '<br>' +
              '<strong>Area:</strong> ' +
              escapeHTML(p.areaDesc || 'Not specified') + '<br>' +
              '<strong>Severity:</strong> ' +
              escapeHTML(p.severity || 'Not specified') + '<br>' +
              '<strong>Expires:</strong> ' + escapeHTML(expires)
            );
          }
        }
      );

      newLayer.addTo(liveMap);

      if (severeLayer && liveMap.hasLayer(severeLayer)) {
        liveMap.removeLayer(severeLayer);
      }

      severeLayer = newLayer;
    }

    severeAlerts = freshAlerts;
    severeLastSuccess = new Date();

    if (count) count.textContent = String(severeAlerts.length);

    if (status) {
      status.textContent =
        'Last checked ' + severeLastSuccess.toLocaleTimeString() +
        ' · ' + severeAlerts.length + ' active alerts';
    }

    renderSevereAlerts();

  } catch (error) {
    console.error('Severe weather refresh failed:', error);

    if (status) {
      status.textContent = severeLastSuccess
        ? 'Refresh failed — showing previous alerts'
        : 'Alert data unavailable. Try refreshing again.';
    }

    if (count && !severeLastSuccess) {
      count.textContent = 'Unavailable';
    }

    if (list && !severeLastSuccess) {
      list.innerHTML =
        '<div class="error-state">' +
        'Could not load severe weather alerts. Try refreshing again.' +
        '</div>';
    }
  } finally {
    severeLoading = false;
  }
}

loadSevereWeather();

const severeRefreshButton =
  document.getElementById('refresh-button');

if (severeRefreshButton) {
  severeRefreshButton.addEventListener('click', loadSevereWeather);
}

setInterval(loadSevereWeather, 5 * 60 * 1000);


/* ==========================================
   STORMWATCH — GLOBAL WEATHER CENTER
   GDACS tropical cyclone and flood events
   ========================================== */

const GLOBAL_EVENTS_URL =
  "https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtypes=TC,FL";

let globalEventLayer = null;
let globalLoading = false;

function globalEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);
}

function globalProperties(feature) {
  return feature?.properties || {};
}

function globalEventName(feature) {
  const p = globalProperties(feature);
  return p.name || p.eventname || p.title ||
    p.description || p.eventtype || "Global weather event";
}

function globalEventType(feature) {
  const p = globalProperties(feature);
  const raw = [
    p.eventtype, p.eventType, p.type, p.event
  ].filter(Boolean).join(" ").toLowerCase();

  if (raw.includes("fl") || raw.includes("flood")) return "Flood";
  if (raw.includes("tc") || raw.includes("cyclone") ||
      raw.includes("hurricane") || raw.includes("typhoon")) {
    return "Tropical cyclone";
  }

  const name = globalEventName(feature).toLowerCase();
  return name.includes("flood") ? "Flood" : "Tropical cyclone";
}

function globalEventColor(feature) {
  return globalEventType(feature) === "Flood"
    ? "#39a8ff"
    : "#e879f9";
}

function globalCoordinates(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return null;

  if (geometry.type === "Point") {
    const [lng, lat] = geometry.coordinates || [];
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return [lat, lng];
    }
  }

  // Use a representative point for non-point geometries.
  const coords = geometry.coordinates;
  const points = [];

  function collect(value) {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      points.push(value);
      return;
    }
    value.forEach(collect);
  }

  collect(coords);

  if (!points.length) return null;

  const lng = points.reduce((sum, point) => sum + point[0], 0) /
    points.length;
  const lat = points.reduce((sum, point) => sum + point[1], 0) /
    points.length;

  return Number.isFinite(lat) && Number.isFinite(lng)
    ? [lat, lng]
    : null;
}

function renderGlobalEvents(features) {
  const list = document.getElementById("global-list");
  const count = document.getElementById("global-count");

  if (!list || !count) return;

  count.textContent = `${features.length} events`;

  if (!features.length) {
    list.innerHTML =
      '<div class="loading">No global cyclone or flood events were returned.</div>';
    return;
  }

  list.innerHTML = features.map((feature, index) => {
    const p = globalProperties(feature);
    const type = globalEventType(feature);
    const color = globalEventColor(feature);
    const name = globalEventName(feature);
    const level = p.alertlevel || p.alertLevel || p.alert || "";
    const country = p.country || p.countryname || "";
    const date = p.fromdate || p.fromDate || p.todate || "";

    return `
      <button type="button"
        class="global-event-card"
        data-global-index="${index}"
        style="--global-event-color:${color}">
        <span class="global-event-dot"></span>
        <span class="global-event-content">
          <strong>${globalEscape(name)}</strong>
          <span>${globalEscape(type)}${country ? " · " + globalEscape(country) : ""}</span>
          <span class="global-event-meta">
            ${level ? "Alert level: " + globalEscape(level) : ""}
            ${date ? " · " + globalEscape(date) : ""}
          </span>
        </span>
      </button>
    `;
  }).join("");

  list.querySelectorAll("[data-global-index]").forEach(button => {
    button.addEventListener("click", () => {
      const feature = features[Number(button.dataset.globalIndex)];
      const point = globalCoordinates(feature);

      if (point && liveMap) {
        liveMap.setView(point, Math.max(liveMap.getZoom(), 5));
      }

      const layer = globalEventLayer;
      if (layer && feature) {
        layer.eachLayer(child => {
          if (child.feature === feature) {
            child.openPopup?.();
          }
        });
      }
    });
  });
}

async function loadGlobalEvents() {
  if (globalLoading) return;
  globalLoading = true;

  const status = document.getElementById("global-status");
  const list = document.getElementById("global-list");

  try {
    const response = await fetch(GLOBAL_EVENTS_URL, {
      headers: { Accept: "application/geo+json, application/json" }
    });

    if (!response.ok) {
      throw new Error(`GDACS returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const features = Array.isArray(data.features)
      ? data.features
      : [];

    if (typeof L === "undefined" || !liveMap) {
      throw new Error("The map is not ready yet.");
    }

    const newLayer = L.geoJSON(data, {
      pointToLayer(feature, latlng) {
        return L.circleMarker(latlng, {
          radius: 7,
          color: "#ffffff",
          weight: 1,
          fillColor: globalEventColor(feature),
          fillOpacity: 0.9
        });
      },

      style(feature) {
        return {
          color: globalEventColor(feature),
          weight: 2,
          fillColor: globalEventColor(feature),
          fillOpacity: 0.15
        };
      },

      onEachFeature(feature, layer) {
        const p = globalProperties(feature);
        const name = globalEventName(feature);
        const type = globalEventType(feature);
        const country = p.country || p.countryname || "";
        const level = p.alertlevel || p.alertLevel || "";

        layer.bindPopup(
          `<strong>${globalEscape(name)}</strong><br>` +
          `${globalEscape(type)}<br>` +
          `${globalEscape(country)}<br>` +
          `${level ? "Alert level: " + globalEscape(level) : ""}`
        );
      }
    });

    // Replace only the previous global layer.
    // Existing hurricane and U.S. alert layers remain untouched.
    if (globalEventLayer) {
      liveMap.removeLayer(globalEventLayer);
    }

    globalEventLayer = newLayer.addTo(liveMap);
    renderGlobalEvents(features);

    if (status) {
      status.textContent =
        `Global data updated: ${new Date().toLocaleTimeString()}. ` +
        "Cyclones are purple; floods are blue.";
    }
  } catch (error) {
    console.error("Global weather load failed:", error);

    if (status) {
      status.textContent =
        "Global data could not load. Existing U.S. weather layers are unchanged.";
    }

    if (list && !list.dataset.loaded) {
      list.innerHTML =
        '<div class="error-state">Global data unavailable. Try again later.</div>';
    }
  } finally {
    globalLoading = false;
  }
}

// Start after the existing map initialization.
function startGlobalWeatherCenter() {
  if (!liveMap) {
    setTimeout(startGlobalWeatherCenter, 500);
    return;
  }

  loadGlobalEvents();
  setInterval(loadGlobalEvents, 6 * 60 * 1000);
}

startGlobalWeatherCenter();

