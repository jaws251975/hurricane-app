
'use strict';

/* =========================================================
   STORMWATCH — LIVE HURRICANE TRACKER
   NOAA / National Hurricane Center + Leaflet
   ========================================================= */

const DATA_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const BACKUP_URL =
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(DATA_URL);

const NHC_MAP_SERVICE =
    'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/' +
    'NHC_tropical_weather_summary/MapServer/';

const REFRESH_INTERVAL = 5 * 60 * 1000;
const REQUEST_TIMEOUT = 12000;

const $ = id => document.getElementById(id);

let storms = [];
let selectedStorm = null;
let liveMap = null;
let liveMarkers = null;
let forecastLayers = [];
let loadingLive = false;
let loadingForecast = false;
let lastSuccessfulRefresh = null;
let refreshTimer = null;


/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

function numberValue(value) {
    if (value === null || value === undefined || value === '') {
        return NaN;
    }

    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
}

function firstNumber(...values) {
    for (const value of values) {
        const n = numberValue(value);
        if (Number.isFinite(n)) return n;
    }

    return NaN;
}

function parseSpeed(value) {
    if (typeof value === 'number') {
        return { value, unit: '' };
    }

    if (typeof value !== 'string') {
        return { value: NaN, unit: '' };
    }

    const match = value.trim().match(
        /(-?\d+(?:\.\d+)?)\s*(mph|kt|kts|knots?)?/i
    );

    return match
        ? {
            value: Number(match[1]),
            unit: (match[2] || '').toLowerCase()
        }
        : { value: NaN, unit: '' };
}

function speedToMph(speed) {
    if (!Number.isFinite(speed.value)) return NaN;

    return ['kt', 'kts', 'knot', 'knots'].includes(speed.unit)
        ? speed.value * 1.15078
        : speed.value;
}

async function fetchJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT
    );

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

function showError(elementId, message) {
    const element = $(elementId);
    if (!element) return;

    element.innerHTML =
        '<div class="error-state">' + escapeHTML(message) + '</div>';
}


/* =========================================================
   NOAA LIVE DATA
   ========================================================= */

async function fetchStormData() {
    let directError;

    try {
        return await fetchJSON(DATA_URL);
    } catch (error) {
        directError = error;
        console.warn('Direct NOAA request failed:', error);
    }

    try {
        return await fetchJSON(BACKUP_URL);
    } catch (backupError) {
        throw new Error(
            'NOAA and backup requests failed. ' +
            (directError?.message || '') + ' / ' +
            (backupError?.message || '')
        );
    }
}


/* =========================================================
   STORM INFORMATION
   ========================================================= */

function getStormName(storm) {
    return storm.name || storm.stormName || 'Unnamed system';
}

function getStormId(storm, index) {
    return String(
        storm.id || storm.stormId || getStormName(storm) + '-' + index
    );
}

function getRawType(storm) {
    return String(storm.classification || storm.type || '')
        .trim().toUpperCase();
}

function getStormType(storm) {
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

    const type = getRawType(storm);
    return types[type] || type || 'Tropical system';
}

function getWindMph(storm) {
    for (const value of [
        storm.intensity,
        storm.maxWind,
        storm.windSpeed
    ]) {
        const parsed = parseSpeed(value);

        if (Number.isFinite(parsed.value)) {
            return speedToMph(parsed);
        }
    }

    return NaN;
}

function getWindKnots(storm) {
    const mph = getWindMph(storm);
    return Number.isFinite(mph) ? mph / 1.15078 : NaN;
}

function getWind(storm) {
    const mph = getWindMph(storm);
    return Number.isFinite(mph)
        ? Math.round(mph) + ' mph'
        : 'Not reported';
}

function getStormCategory(storm) {
    const type = getRawType(storm);
    const wind = getWindKnots(storm);

    if (type === 'TD' || type === 'SD') {
        return {
            label: type,
            name: getStormType(storm),
            color: '#22c55e',
            size: 42
        };
    }

    if (type === 'TS' || type === 'SS') {
        return {
            label: type,
            name: getStormType(storm),
            color: '#22c55e',
            size: 44
        };
    }

    if (
        ['HU', 'TY'].includes(type) &&
        Number.isFinite(wind)
    ) {
        if (wind >= 137) {
            return {
                label: '5',
                name: 'Category 5 Hurricane',
                color: '#7f1d1d',
                size: 58
            };
        }

        if (wind >= 113) {
            return {
                label: '4',
                name: 'Category 4 Hurricane',
                color: '#dc2626',
                size: 54
            };
        }

        if (wind >= 96) {
            return {
                label: '3',
                name: 'Category 3 Hurricane',
                color: '#f87171',
                size: 50
            };
        }

        if (wind >= 83) {
            return {
                label: '2',
                name: 'Category 2 Hurricane',
                color: '#f97316',
                size: 46
            };
        }

        if (wind >= 64) {
            return {
                label: '1',
                name: 'Category 1 Hurricane',
                color: '#facc15',
                size: 42
            };
        }
    }

    return {
        label: type || '?',
        name: getStormType(storm),
        color: '#94a3b8',
        size: 42
    };
}


/* =========================================================
   COORDINATES
   ========================================================= */

function parseCoordinate(value) {
    if (value === null || value === undefined || value === '') {
        return NaN;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : NaN;
    }

    const match = String(value).trim().toUpperCase().match(
        /^(-?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?$/
    );

    if (!match) return NaN;

    let result = Number(match[1]);
    const direction = match[2];

    if (direction === 'S' || direction === 'W') {
        result = -Math.abs(result);
    } else if (direction === 'N' || direction === 'E') {
        result = Math.abs(result);
    }

    return result;
}

function getCoordinates(storm) {
    const lat = parseCoordinate(
        storm.latitude_numeric ??
        storm.latitudeNumeric ??
        storm.latitude ??
        storm.lat
    );

    const lon = parseCoordinate(
        storm.longitude_numeric ??
        storm.longitudeNumeric ??
        storm.longitude ??
        storm.lon
    );

    if (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180
    ) {
        return [lat, lon];
    }

    return null;
}


/* =========================================================
   STORM MOVEMENT AND DIRECTION ARROW
   ========================================================= */

function getMovementDirection(storm) {
    const numeric = firstNumber(
        storm.movementDir,
        storm.movementDirectionDegrees,
        storm.directionDegrees,
        typeof storm.movement === 'object' && storm.movement
            ? storm.movement.directionDegrees ??
              storm.movement.degrees
            : NaN
    );

    if (
        Number.isFinite(numeric) &&
        numeric >= 0 &&
        numeric <= 360
    ) {
        return numeric % 360;
    }

    const text = [
        typeof storm.movement === 'string' ? storm.movement : '',
        typeof storm.movementDirection === 'string'
            ? storm.movementDirection : '',
        typeof storm.direction === 'string' ? storm.direction : ''
    ].join(' ');

    const match = text.toUpperCase().match(
        /\b(NNE|ENE|ESE|SSE|SSW|WSW|WNW|NNW|NE|SE|SW|NW|N|E|S|W)\b/
    );

    if (!match) return NaN;

    const compass = {
        N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
        E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
        S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
        W: 270, WNW: 292.5, NW: 315, NNW: 337.5
    };

    return compass[match[1]];
}

function getMovementSpeedMph(storm) {
    const values = [
        storm.movementSpeed,
        storm.movement_speed,
        typeof storm.movement === 'object' && storm.movement
            ? storm.movement.speed : null
    ];

    for (const value of values) {
        const parsed = parseSpeed(value);

        if (Number.isFinite(parsed.value)) {
            return speedToMph(parsed);
        }
    }

    const text = typeof storm.movement === 'string'
        ? storm.movement
        : '';

    const match = text.match(
        /at\s+(\d+(?:\.\d+)?)\s*(mph|kt|kts|knots?)?/i
    );

    return match
        ? speedToMph({
            value: Number(match[1]),
            unit: (match[2] || '').toLowerCase()
        })
        : NaN;
}

function compassDirection(degrees) {
    if (!Number.isFinite(degrees)) return 'Not reported';

    const directions = [
        'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
        'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
    ];

    return directions[Math.round(degrees / 22.5) % 16];
}

function getMovement(storm) {
    const direction = getMovementDirection(storm);
    const speed = getMovementSpeedMph(storm);

    if (Number.isFinite(direction) && Number.isFinite(speed)) {
        return compassDirection(direction) + ' at ' +
            Math.round(speed) + ' mph';
    }

    return Number.isFinite(direction)
        ? compassDirection(direction)
        : 'Not reported by feed';
}


/* =========================================================
   HURRICANE-SHAPED SWIRL
   ========================================================= */


function swirlHTML() {
  return `
    <svg class="hurricane-symbol"
         viewBox="0 0 64 64"
         aria-hidden="true">
      <!-- Three separate, clearly visible spiral branches -->
      <g fill="none"
         stroke="#e52222"
         stroke-width="7"
         stroke-linecap="round"
         stroke-linejoin="round">
        <path d="M31 23 C20 12, 7 17, 9 28 C10 36, 20 37, 25 31"/>
        <path d="M40 31 C53 22, 59 33, 52 41 C48 46, 41 43, 39 39"/>
        <path d="M30 41 C29 53, 17 57, 14 48 C12 43, 17 39, 22 40"/>
      </g>

      <!-- Clear center so the category remains readable -->
      <circle cx="32" cy="32" r="11"
              fill="#ffffff"
              stroke="#e52222"
              stroke-width="3"/>
    </svg>
  `;
}



/* =========================================================
   MAP INITIALIZATION
   ========================================================= */

function initializeMaps() {
    const mapElement = $('map');

    if (!mapElement || liveMap) return;

    if (typeof L === 'undefined') {
        showError(
            'storm-list',
            'The map library did not load. Check your connection and reload.'
        );
        return;
    }

    try {
        liveMap = L.map(mapElement, {
            zoomControl: true,
            preferCanvas: true
        }).setView([22, -65], 3);

        L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            {
                maxZoom: 18,
                attribution: '&copy; OpenStreetMap contributors'
            }
        ).addTo(liveMap);

        liveMarkers = L.layerGroup().addTo(liveMap);

        setTimeout(() => {
            if (liveMap) liveMap.invalidateSize();
        }, 300);
    } catch (error) {
        console.error('Map initialization failed:', error);
        showError('storm-list', 'Map error: ' + error.message);
    }
}


/* =========================================================
   OFFICIAL NHC FORECAST CONE, TRACK AND WIND POINTS
   ========================================================= */

function getForecastWind(properties) {
    const p = properties || {};

    // Field names can differ between NOAA service updates.
    const rawWind = firstNumber(
        p.maxwind, p.MAXWIND,
        p.vmax, p.VMAX,
        p.max_wind, p.MAX_WIND,
        p.wind, p.WIND
    );

    if (!Number.isFinite(rawWind)) return null;

    const unit = String(
        p.windunit || p.WINDUNIT || p.units || p.UNITS || ''
    ).toLowerCase();

    const mph = Math.round(
        unit.includes('kt') || unit.includes('knot')
            ? rawWind * 1.15078
            : rawWind
    );

    return mph + ' mph';
}

function getForecastTime(properties) {
    const p = properties || {};

    return p.datelbl ||
        p.DATELBL ||
        p.fldatelbl ||
        p.FL_DATELBL ||
        p.fcstprd_label ||
        p.FCSTPRD_LABEL ||
        'Forecast position';
}

async function loadForecastLayers() {
    if (!liveMap || typeof L === 'undefined' || loadingForecast) {
        return;
    }

    loadingForecast = true;
    const nextLayers = [];

    try {
        // NOAA layer 7: forecast cone.
        // NOAA layer 6: forecast track.
        // NOAA layer 5: forecast positions.
        const definitions = [
            { id: 7, kind: 'cone' },
            { id: 6, kind: 'track' },
            { id: 5, kind: 'points' }
        ];

        for (const item of definitions) {
            const url = NHC_MAP_SERVICE + item.id +
                '/query?where=1%3D1&outFields=*&returnGeometry=true' +
                '&outSR=4326&f=geojson';

            const data = await fetchJSON(url);

            if (!Array.isArray(data.features) || !data.features.length) {
                continue;
            }

            const layer = L.geoJSON(data, {
                style: () => {
                    if (item.kind === 'cone') {
                        return {
                            color: '#ff3030',
                            weight: 2,
                            opacity: 0.95,
                            fillColor: '#ff2020',
                            fillOpacity: 0.18
                        };
                    }

                    return {
                        color: '#ff3030',
                        weight: 3,
                        opacity: 1
                    };
                },

                pointToLayer: (feature, latlng) => {
                    if (item.kind !== 'points') {
                        return L.marker(latlng);
                    }

                    const p = feature.properties || {};
                    const name = p.stormname || p.STORMNAME ||
                        'NHC forecast';
                    const time = getForecastTime(p);
                    const wind = getForecastWind(p);

                    const windText = wind
                        ? 'Forecast wind: ' + wind
                        : 'Wind value not supplied in this layer';

                    const labelHTML =
                        '<span class="forecast-wind-label">' +
                        escapeHTML(time) + '<br>' +
                        escapeHTML(wind || 'Forecast point') +
                        '</span>';

                    const icon = L.divIcon({
                        className: 'forecast-wind-icon',
                        html: labelHTML,
                        iconSize: [124, 36],
                        iconAnchor: [62, 18]
                    });

                    return L.marker(latlng, { icon })
                        .bindPopup(
                            '<strong>' + escapeHTML(name) + '</strong><br>' +
                            escapeHTML(time) + '<br>' +
                            escapeHTML(windText) +
                            '<br><small>Official NHC forecast data. ' +
                            'Forecasts can change.</small>'
                        );
                },

                onEachFeature: (feature, shape) => {
                    if (item.kind === 'points') return;

                    const p = feature.properties || {};
                    const name = p.stormname || p.STORMNAME ||
                        'Tropical system';

                    shape.bindPopup(
                        '<strong>' + escapeHTML(name) + '</strong><br>' +
                        (item.kind === 'cone'
                            ? 'Official forecast cone: an area of track uncertainty, not an exact impact boundary.'
                            : 'Official NHC forecast track.')
                    );
                }
            });

            layer.addTo(liveMap);
            nextLayers.push(layer);
        }
    } catch (error) {
        console.warn('NHC forecast layers could not load:', error);
    } finally {
        // Replace the previous forecast layers only after the new
        // requests have finished. Keep the live storm map independent.
        forecastLayers.forEach(layer => {
            if (liveMap && liveMap.hasLayer(layer)) {
                liveMap.removeLayer(layer);
            }
        });

        forecastLayers = nextLayers;
        loadingForecast = false;
    }
}


/* =========================================================
   CURRENT STORM MARKERS AND BIG MOVEMENT ARROW
   ========================================================= */

function renderLiveMap() {
    if (!liveMap || !liveMarkers || typeof L === 'undefined') return;

    liveMarkers.clearLayers();

    storms.forEach(storm => {
        const coordinates = getCoordinates(storm);
        if (!coordinates) return;

        const category = getStormCategory(storm);
        const size = category.size;
        const direction = getMovementDirection(storm);

        const arrowHTML = Number.isFinite(direction)
            ? '<span class="storm-direction-arrow" ' +
              'title="Reported direction of movement" ' +
              'style="transform:rotate(' + direction + 'deg)">' +
                '<span class="storm-direction-shaft"></span>' +
                '<span class="storm-direction-fin"></span>' +
                '<span class="storm-direction-head"></span>' +
              '</span>'
            : '';

        const icon = L.divIcon({
            className: 'storm-div-icon',
            html:
                '<div class="storm-pin" style="--storm-color:' +
                category.color + ';">' +
                    '<span class="storm-category-band storm-category-band-one"></span>' +
                    '<span class="storm-category-band storm-category-band-two"></span>' +
                    swirlHTML +
                    arrowHTML +
                    '<span class="storm-pin-label">' +
                    escapeHTML(category.label) +
                    '</span>' +
                '</div>',
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
            popupAnchor: [0, -size / 2]
        });

        const popup =
            '<strong>' + escapeHTML(getStormName(storm)) + '</strong><br>' +
            escapeHTML(category.name) + '<br>' +
            'Maximum wind: ' + escapeHTML(getWind(storm)) + '<br>' +
            'Movement: ' + escapeHTML(getMovement(storm)) + '<br>' +
            coordinates[0].toFixed(2) + '°, ' +
            coordinates[1].toFixed(2) + '°';

        L.marker(coordinates, { icon })
            .addTo(liveMarkers)
            .bindPopup(popup);
    });
}


/* =========================================================
   STORM LIST
   ========================================================= */

function renderStormList() {
    const list = $('storm-list');
    if (!list) return;

    if (!storms.length) {
        list.innerHTML =
            '<div class="empty-state">' +
            'NOAA currently lists no active tropical systems.' +
            '</div>';

        const detail = $('detail');

        if (detail) {
            detail.innerHTML =
                '<p class="eyebrow">STORM DETAILS</p>' +
                '<p class="detail-placeholder">' +
                'There are no active storms to select right now.' +
                '</p>';
        }

        return;
    }

    list.innerHTML = storms.map((storm, index) => {
        const coordinates = getCoordinates(storm);
        const position = coordinates
            ? coordinates[0].toFixed(1) + '°, ' +
              coordinates[1].toFixed(1) + '°'
            : 'Position unavailable';

        const selected =
            getStormId(storm, index) === selectedStorm
                ? ' selected'
                : '';

        const category = getStormCategory(storm);

        return (
            '<button type="button" class="storm-card' + selected +
            '" data-index="' + index + '">' +
                '<div class="storm-name-row">' +
                    '<span class="storm-name">' +
                    escapeHTML(getStormName(storm)) +
                    '</span>' +
                    '<span class="storm-type">' +
                    escapeHTML(category.label) +
                    '</span>' +
                '</div>' +
                '<div class="storm-summary">' +
                    '<span>Wind: ' + escapeHTML(getWind(storm)) + '</span>' +
                    '<span>' + escapeHTML(position) + '</span>' +
                '</div>' +
            '</button>'
        );
    }).join('');

    list.querySelectorAll('.storm-card').forEach(button => {
        button.addEventListener('click', () => {
            selectStorm(Number(button.dataset.index));
        });
    });
}


/* =========================================================
   STORM DETAILS
   ========================================================= */

function renderStormDetails(storm) {
    const detail = $('detail');
    if (!detail || !storm) return;

    const coordinates = getCoordinates(storm);
    const position = coordinates
        ? coordinates[0].toFixed(2) + '°, ' +
          coordinates[1].toFixed(2) + '°'
        : 'Not reported';

    const advisory = storm.publicAdvisory?.url;
    const officialURL =
        typeof advisory === 'string' &&
        /^https:\/\/www\.nhc\.noaa\.gov\//i.test(advisory)
            ? advisory
            : 'https://www.nhc.noaa.gov/';

    detail.innerHTML =
        '<p class="eyebrow">STORM DETAILS</p>' +
        '<p class="detail-title">' +
        escapeHTML(getStormName(storm)) +
        '</p>' +
        '<div class="detail-grid">' +
            '<div class="detail-item"><span>CLASSIFICATION</span><strong>' +
                escapeHTML(getStormType(storm)) + '</strong></div>' +
            '<div class="detail-item"><span>MAX WIND</span><strong>' +
                escapeHTML(getWind(storm)) + '</strong></div>' +
            '<div class="detail-item"><span>POSITION</span><strong>' +
                escapeHTML(position) + '</strong></div>' +
            '<div class="detail-item"><span>MOVEMENT</span><strong>' +
                escapeHTML(getMovement(storm)) + '</strong></div>' +
        '</div>' +
        '<p class="detail-placeholder"><a href="' +
        escapeHTML(officialURL) +
        '" target="_blank" rel="noopener noreferrer">' +
        'Official storm information</a></p>';
}

function selectStorm(index) {
    const storm = storms[index];
    if (!storm) return;

    selectedStorm = getStormId(storm, index);

    renderStormList();
    renderStormDetails(storm);

    const coordinates = getCoordinates(storm);

    if (coordinates && liveMap) {
        liveMap.flyTo(coordinates, 5);
    }
}


/* =========================================================
   STATUS AND LIVE DATA REFRESH
   ========================================================= */

function updateLastChecked(text, title) {
    const element = $('last-updated');
    if (!element) return;

    element.textContent = text;
    if (title) element.title = title;
}

async function loadLive() {
    if (loadingLive) return;
    loadingLive = true;

    const button = $('refresh-button');

    if (button) {
        button.disabled = true;
        button.textContent = 'Updating…';
    }

    if (!storms.length && $('storm-list')) {
        $('storm-list').innerHTML =
            '<div class="loading">Loading NOAA storm data…</div>';
    }

    try {
        const data = await fetchStormData();

        if (!data || !Array.isArray(data.activeStorms)) {
            throw new Error('The response has no activeStorms array.');
        }

        storms = data.activeStorms.filter(
            storm => storm && typeof storm === 'object'
        );

        const count = $('storm-count');
        if (count) count.textContent = String(storms.length);

        lastSuccessfulRefresh = new Date();

        updateLastChecked(
            lastSuccessfulRefresh.toLocaleTimeString(),
            'Last successful NOAA data fetch'
        );

        const selectedIndex = storms.findIndex(
            (storm, index) =>
                getStormId(storm, index) === selectedStorm
        );

        if (storms.length) {
            const index = selectedIndex >= 0 ? selectedIndex : 0;

            selectedStorm = getStormId(storms[index], index);
            renderStormList();
            renderStormDetails(storms[index]);
        } else {
            selectedStorm = null;
            renderStormList();
        }

        renderLiveMap();

    } catch (error) {
        console.error('StormWatch live-data error:', error);

        if (lastSuccessfulRefresh) {
            updateLastChecked(
                lastSuccessfulRefresh.toLocaleTimeString() + ' (stale)',
                'Refresh failed. Showing the last successful data.'
            );
        } else {
            updateLastChecked(
                'Unavailable',
                'No successful data fetch has completed yet.'
            );
        }

        if (storms.length) {
            renderStormList();
            renderLiveMap();

            const index = storms.findIndex(
                (storm, i) => getStormId(storm, i) === selectedStorm
            );

            if (index >= 0) renderStormDetails(storms[index]);
        } else {
            showError(
                'storm-list',
                'Could not load live storm data. Refresh the page or try again. ' +
                'Details: ' + error.message
            );
        }

    } finally {
        loadingLive = false;

        if (button) {
            button.disabled = false;
            button.textContent = '↻ Refresh data';
        }
    }
}


/* =========================================================
   EVENTS AND STARTUP
   ========================================================= */

function initializeEvents() {
    const button = $('refresh-button');

    if (button) {
        button.addEventListener('click', () => {
            loadLive();
            loadForecastLayers();
        });
    }
}

function startStormWatch() {
    initializeMaps();
    initializeEvents();

    // Start the live feed and forecast independently.
    loadLive();
    loadForecastLayers();

    if (refreshTimer) clearInterval(refreshTimer);

    refreshTimer = setInterval(() => {
        loadLive();
        loadForecastLayers();
    }, REFRESH_INTERVAL);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startStormWatch, {
        once: true
    });
} else {
    startStormWatch();
}
