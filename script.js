
'use strict';

/* =========================================================
   STORMWATCH — LIVE HURRICANE TRACKER
   Data: NOAA / National Hurricane Center
   Map: Leaflet + OpenStreetMap
   ========================================================= */

const DATA_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';

const BACKUP_URL =
    'https://api.allorigins.win/raw?url=' +
    encodeURIComponent(DATA_URL);

const REFRESH_INTERVAL = 5 * 60 * 1000;
const REQUEST_TIMEOUT = 12000;

const $ = id => document.getElementById(id);

let storms = [];
let selectedStorm = null;
let liveMap = null;
let liveMarkers = null;
let lastSuccessfulRefresh = null;
let loadingLive = false;
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

    const number = Number(value);

    return Number.isFinite(number) ? number : NaN;
}

function firstNumber(...values) {
    for (const value of values) {
        const number = numberValue(value);

        if (Number.isFinite(number)) {
            return number;
        }
    }

    return NaN;
}

function parseSpeed(value) {
    if (typeof value === 'number') {
        return {
            value: Number.isFinite(value) ? value : NaN,
            unit: ''
        };
    }

    if (typeof value !== 'string') {
        return { value: NaN, unit: '' };
    }

    const match = value.trim().match(
        /(-?\d+(?:\.\d+)?)\s*(mph|kt|kts|knots?)?/i
    );

    if (!match) {
        return { value: NaN, unit: '' };
    }

    return {
        value: Number(match[1]),
        unit: (match[2] || '').toLowerCase()
    };
}

function speedToMph(speed) {
    if (!Number.isFinite(speed.value)) {
        return NaN;
    }

    if (
        speed.unit === 'kt' ||
        speed.unit === 'kts' ||
        speed.unit === 'knot' ||
        speed.unit === 'knots'
    ) {
        return speed.value * 1.15078;
    }

    return speed.value;
}

function fetchJsonWithTimeout(url) {
    const controller = new AbortController();

    const timeout = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT
    );

    return fetch(url, {
        cache: 'no-store',
        signal: controller.signal
    })
        .then(response => {
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            return response.json();
        })
        .finally(() => clearTimeout(timeout));
}


/* =========================================================
   NOAA DATA FETCHING
   ========================================================= */

async function fetchStormData() {
    let directError;

    // Try the official NOAA endpoint first.
    try {
        return await fetchJsonWithTimeout(DATA_URL);
    } catch (error) {
        directError = error;

        console.warn(
            'Direct NOAA request failed. Trying backup service.',
            error
        );
    }

    // Try the backup proxy if the direct request fails.
    try {
        return await fetchJsonWithTimeout(BACKUP_URL);
    } catch (backupError) {
        throw new Error(
            'Both data requests failed. NOAA: ' +
            (directError?.message || 'unknown error') +
            '. Backup: ' +
            (backupError?.message || 'unknown error')
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
        storm.id ||
        storm.stormId ||
        getStormName(storm) + '-' + index
    );
}

function getRawType(storm) {
    return String(
        storm.classification || storm.type || ''
    ).trim().toUpperCase();
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


/* =========================================================
   WIND SPEED
   ========================================================= */

function getWindMph(storm) {
    const raw = [
        storm.intensity,
        storm.maxWind,
        storm.windSpeed
    ];

    for (const value of raw) {
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

    if (!Number.isFinite(mph)) {
        return 'Not reported';
    }

    return Math.round(mph) + ' mph';
}

function getStormCategory(storm) {
    const type = getRawType(storm);
    const wind = getWindKnots(storm);

    if (type === 'TD' || type === 'SD') {
        return {
            label: type,
            name: getStormType(storm),
            color: '#22c55e',
            size: 38
        };
    }

    if (type === 'TS' || type === 'SS') {
        return {
            label: type,
            name: getStormType(storm),
            color: '#22c55e',
            size: 42
        };
    }

    if (
        (type === 'HU' || type === 'TY') &&
        Number.isFinite(wind)
    ) {
        if (wind >= 137) {
            return {
                label: '5',
                name: 'Category 5 Hurricane',
                color: '#7f1d1d',
                size: 56
            };
        }

        if (wind >= 113) {
            return {
                label: '4',
                name: 'Category 4 Hurricane',
                color: '#dc2626',
                size: 52
            };
        }

        if (wind >= 96) {
            return {
                label: '3',
                name: 'Category 3 Hurricane',
                color: '#f87171',
                size: 48
            };
        }

        if (wind >= 83) {
            return {
                label: '2',
                name: 'Category 2 Hurricane',
                color: '#f97316',
                size: 44
            };
        }

        if (wind >= 64) {
            return {
                label: '1',
                name: 'Category 1 Hurricane',
                color: '#facc15',
                size: 40
            };
        }
    }

    return {
        label: type || '?',
        name: getStormType(storm),
        color: '#94a3b8',
        size: 38
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

    const match = String(value)
        .trim()
        .toUpperCase()
        .match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?$/);

    if (!match) {
        return NaN;
    }

    let number = Number(match[1]);
    const direction = match[2];

    if (direction === 'S' || direction === 'W') {
        number = -Math.abs(number);
    } else if (direction === 'N' || direction === 'E') {
        number = Math.abs(number);
    }

    return number;
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
   STORM MOVEMENT
   ========================================================= */

function getMovementDirection(storm) {
    const numeric = firstNumber(
        storm.movementDir,
        storm.movementDirectionDegrees,
        storm.directionDegrees,
        typeof storm.movement === 'object' && storm.movement
            ? storm.movement.directionDegrees ?? storm.movement.degrees
            : NaN
    );

    if (
        Number.isFinite(numeric) &&
        numeric >= 0 &&
        numeric <= 360
    ) {
        return numeric % 360;
    }

    const textDirection =
        typeof storm.movement === 'string'
            ? storm.movement
            : typeof storm.movementDirection === 'string'
                ? storm.movementDirection
                : typeof storm.direction === 'string'
                    ? storm.direction
                    : '';

    const match = textDirection.trim().toUpperCase().match(
        /\b(NNE|ENE|ESE|SSE|SSW|WSW|WNW|NNW|NE|SE|SW|NW|N|E|S|W)\b/
    );

    if (!match) {
        return NaN;
    }

    const compass = {
        N: 0,
        NNE: 22.5,
        NE: 45,
        ENE: 67.5,
        E: 90,
        ESE: 112.5,
        SE: 135,
        SSE: 157.5,
        S: 180,
        SSW: 202.5,
        SW: 225,
        WSW: 247.5,
        W: 270,
        WNW: 292.5,
        NW: 315,
        NNW: 337.5
    };

    return compass[match[1]];
}

function getMovementSpeedMph(storm) {
    const raw = [
        storm.movementSpeed,
        storm.movement_speed,
        typeof storm.movement === 'object' && storm.movement
            ? storm.movement.speed
            : null
    ];

    for (const value of raw) {
        const parsed = parseSpeed(value);

        if (Number.isFinite(parsed.value)) {
            return speedToMph(parsed);
        }
    }

    // NOAA may provide movement as text such as "NW at 10 mph".
    const movementText =
        typeof storm.movement === 'string'
            ? storm.movement
            : '';

    const match = movementText.match(
        /at\s+(\d+(?:\.\d+)?)\s*(mph|kt|kts|knots?)?/i
    );

    if (match) {
        return speedToMph({
            value: Number(match[1]),
            unit: (match[2] || '').toLowerCase()
        });
    }

    return NaN;
}

function compassDirection(degrees) {
    if (!Number.isFinite(degrees)) {
        return 'Not reported';
    }

    const directions = [
        'N', 'NNE', 'NE', 'ENE',
        'E', 'ESE', 'SE', 'SSE',
        'S', 'SSW', 'SW', 'WSW',
        'W', 'WNW', 'NW', 'NNW'
    ];

    return directions[Math.round(degrees / 22.5) % 16];
}

function getMovement(storm) {
    const direction = getMovementDirection(storm);
    const speed = getMovementSpeedMph(storm);

    if (
        Number.isFinite(direction) &&
        Number.isFinite(speed)
    ) {
        return compassDirection(direction) +
            ' at ' + Math.round(speed) + ' mph';
    }

    if (Number.isFinite(direction)) {
        return compassDirection(direction);
    }

    return 'Not reported by feed';
}


/* =========================================================
   HURRICANE SWIRL MARKER
   ========================================================= */

const swirlHTML = `
<svg class="storm-swirl" viewBox="0 0 64 64" aria-hidden="true">
    <g fill="white">
        <path d="M29 4 C43 3 55 14 54 27 C53 35 48 40 42 43 C47 33 46 23 38 16 C33 11 27 9 20 9 C23 6 26 5 29 4Z"/>
        <path d="M58 30 C61 43 52 56 39 57 C31 58 25 54 21 48 C31 52 41 49 46 41 C50 36 52 29 51 22 C55 24 57 27 58 30Z"/>
        <path d="M35 60 C22 62 9 53 8 40 C7 32 11 26 17 22 C13 32 16 42 24 47 C29 51 36 52 43 50 C41 55 38 58 35 60Z"/>
    </g>
    <g fill="none" stroke="white" stroke-width="1.7"
       stroke-linecap="round" stroke-linejoin="round">
        <path d="M42 43 Q54 41 55 57"/>
        <path d="M21 48 Q8 51 8 36"/>
        <path d="M38 16 Q43 5 27 4"/>
        <path d="M46 24 Q52 18 57 21"/>
        <path d="M23 20 Q17 17 13 22"/>
        <path d="M44 49 Q52 50 49 56"/>
    </g>
    <circle cx="32" cy="32" r="6" fill="white"/>
</svg>
`;


/* =========================================================
   MAP INITIALIZATION
   ========================================================= */

function initializeMaps() {
    const mapElement = $('map');

    if (!mapElement || liveMap) {
        return;
    }

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
            if (liveMap) {
                liveMap.invalidateSize();
            }
        }, 250);
    } catch (error) {
        console.error('Map initialization failed:', error);

        showError(
            'storm-list',
            'The map could not start: ' + error.message
        );
    }
}


/* =========================================================
   MAP MARKERS
   ========================================================= */

function renderLiveMap() {
    if (!liveMap || !liveMarkers || typeof L === 'undefined') {
        return;
    }

    liveMarkers.clearLayers();

    storms.forEach(storm => {
        const coordinates = getCoordinates(storm);

        if (!coordinates) {
            return;
        }

        const category = getStormCategory(storm);
        const size = category.size;
        const direction = getMovementDirection(storm);

        const arrowHTML = Number.isFinite(direction)
            ? '<span class="storm-direction-arrow" ' +
              'title="Reported direction of movement" ' +
              'style="transform:rotate(' + direction + 'deg)">' +
                  '<span class="storm-direction-shaft"></span>' +
                  '<span class="storm-direction-head"></span>' +
              '</span>'
            : '';

        const icon = L.divIcon({
            className: 'storm-div-icon',

            html:
                '<div class="storm-pin" style="--storm-color:' +
                category.color + ';">' +
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

    if (!list) {
        return;
    }

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
            '<button type="button" class="storm-card' +
            selected + '" data-index="' + index + '">' +

                '<div class="storm-name-row">' +
                    '<span class="storm-name">' +
                    escapeHTML(getStormName(storm)) +
                    '</span>' +

                    '<span class="storm-type">' +
                    escapeHTML(category.label) +
                    '</span>' +
                '</div>' +

                '<div class="storm-summary">' +
                    '<span>Wind: ' +
                    escapeHTML(getWind(storm)) +
                    '</span>' +

                    '<span>' +
                    escapeHTML(position) +
                    '</span>' +
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
   SELECTED STORM DETAILS
   ========================================================= */

function renderStormDetails(storm) {
    const detail = $('detail');

    if (!detail || !storm) {
        return;
    }

    const coordinates = getCoordinates(storm);

    const position = coordinates
        ? coordinates[0].toFixed(2) + '°, ' +
          coordinates[1].toFixed(2) + '°'
        : 'Not reported';

    const advisory = storm.publicAdvisory?.url;

    // Only allow an official National Hurricane Center link.
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

            '<div class="detail-item">' +
                '<span>CLASSIFICATION</span>' +
                '<strong>' +
                escapeHTML(getStormType(storm)) +
                '</strong>' +
            '</div>' +

            '<div class="detail-item">' +
                '<span>MAX WIND</span>' +
                '<strong>' +
                escapeHTML(getWind(storm)) +
                '</strong>' +
            '</div>' +

            '<div class="detail-item">' +
                '<span>POSITION</span>' +
                '<strong>' +
                escapeHTML(position) +
                '</strong>' +
            '</div>' +

            '<div class="detail-item">' +
                '<span>MOVEMENT</span>' +
                '<strong>' +
                escapeHTML(getMovement(storm)) +
                '</strong>' +
            '</div>' +

        '</div>' +

        '<p class="detail-placeholder">' +
            '<a href="' + escapeHTML(officialURL) +
            '" target="_blank" rel="noopener noreferrer">' +
            'Official storm information</a>' +
        '</p>';
}

function selectStorm(index) {
    const storm = storms[index];

    if (!storm) {
        return;
    }

    selectedStorm = getStormId(storm, index);

    renderStormList();
    renderStormDetails(storm);

    const coordinates = getCoordinates(storm);

    if (coordinates && liveMap) {
        liveMap.flyTo(coordinates, 5);
    }
}


/* =========================================================
   STATUS AND TIMESTAMP
   ========================================================= */

function updateLastChecked(text, title) {
    const element = $('last-updated');

    if (!element) {
        return;
    }

    element.textContent = text;

    if (title) {
        element.title = title;
    }
}


/* =========================================================
   LOAD AND REFRESH LIVE DATA
   ========================================================= */

async function loadLive() {
    if (loadingLive) {
        return;
    }

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
            throw new Error(
                'The response did not contain an activeStorms array.'
            );
        }

        // Do not replace working data until the response is validated.
        const freshStorms = data.activeStorms.filter(
            storm => storm && typeof storm === 'object'
        );

        storms = freshStorms;

        if ($('storm-count')) {
            $('storm-count').textContent = String(storms.length);
        }

        // Record a successful refresh only after valid data arrives.
        lastSuccessfulRefresh = new Date();

        updateLastChecked(
            lastSuccessfulRefresh.toLocaleTimeString(),
            'Last successful data fetch'
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
        console.error('StormWatch data error:', error);

        // Keep the last successful timestamp instead of erasing it.
        if (lastSuccessfulRefresh) {
            updateLastChecked(
                lastSuccessfulRefresh.toLocaleTimeString() + ' (stale)',
                'Refresh failed. This is the time of the last successful fetch.'
            );
        } else {
            updateLastChecked(
                'Unavailable',
                'No successful data fetch has completed yet.'
            );
        }

        // Preserve the last known-good storm information.
        if (storms.length) {
            renderStormList();
            renderLiveMap();

            const selectedIndex = storms.findIndex(
                (storm, index) =>
                    getStormId(storm, index) === selectedStorm
            );

            if (selectedIndex >= 0) {
                renderStormDetails(storms[selectedIndex]);
            }
        } else {
            showError(
                'storm-list',
                'Could not load live storm data. ' +
                'Check your internet connection and try Refresh data again. ' +
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
    const refreshButton = $('refresh-button');

    if (refreshButton) {
        refreshButton.addEventListener('click', loadLive);
    }
}

function startStormWatch() {
    initializeMaps();
    initializeEvents();

    loadLive();

    if (refreshTimer) {
        clearInterval(refreshTimer);
    }

    refreshTimer = setInterval(
        loadLive,
        REFRESH_INTERVAL
    );
}

if (document.readyState === 'loading') {
    document.addEventListener(
        'DOMContentLoaded',
        startStormWatch,
        { once: true }
    );
} else {
    startStormWatch();
}
