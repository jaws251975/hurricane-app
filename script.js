
'use strict';

/*
 * StormWatch live tracker
 * Data: NOAA / National Hurricane Center CurrentStorms.json
 * Map: Leaflet + OpenStreetMap
 */

const DATA_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const BACKUP_URL =
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(DATA_URL);

const $ = id => document.getElementById(id);

let storms = [];
let selectedStorm = null;
let liveMap = null;
let liveMarkers = null;

let forecastLayers = [];
let loadingForecast = false;

let loadingLive = false;
let refreshTimer = null;

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
        if (Number.isFinite(number)) return number;
    }
    return NaN;
}

function fetchWithTimeout(url, timeoutMs = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    return fetch(url, {
        cache: 'no-store',
        signal: controller.signal
    }).finally(() => clearTimeout(timeoutId));
}

async function fetchStormData() {
    let directError;

    try {
        const response = await fetchWithTimeout(DATA_URL);
        if (!response.ok) {
            throw new Error('NOAA returned HTTP ' + response.status);
        }
        return await response.json();
    } catch (error) {
        directError = error;
        console.warn('Direct NOAA request failed; trying backup:', error);
    }

    try {
        const response = await fetchWithTimeout(BACKUP_URL);
        if (!response.ok) {
            throw new Error('Backup service returned HTTP ' + response.status);
        }
        return await response.json();
    } catch (backupError) {
        throw new Error(
            'NOAA and backup requests both failed. ' +
            'Direct request: ' + (directError?.message || 'unknown error') +
            '; backup request: ' + (backupError?.message || 'unknown error')
        );
    }
}

function parseCoordinate(value) {
    if (value === null || value === undefined || value === '') return NaN;

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : NaN;
    }

    const text = String(value).trim().toUpperCase();
    const match = text.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?$/);
    if (!match) return NaN;

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

function getStormName(storm) {
    return storm.name || storm.stormName || 'Unnamed system';
}

function getStormId(storm, index) {
    return String(storm.id || storm.stormId || getStormName(storm) + '-' + index);
}

function getRawType(storm) {
    return String(storm.classification || storm.type || '').trim().toUpperCase();
}

function getStormType(storm) {
    const type = getRawType(storm);
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
    return types[type] || type || 'Tropical system';
}

function getWindKnots(storm) {
    return firstNumber(storm.intensity, storm.maxWind, storm.windSpeed);
}

function getWind(storm) {
    const knots = getWindKnots(storm);
    if (!Number.isFinite(knots)) return 'Not reported';
    return Math.round(knots * 1.15078) + ' mph';
}

function getMovementDirection(storm) {
    const direction = firstNumber(
        storm.movementDir,
        storm.movementDirection,
        storm.directionDegrees,
        typeof storm.movement === 'object'
            ? (storm.movement.directionDegrees ?? storm.movement.degrees)
            : NaN
    );
    if (Number.isFinite(direction) && direction >= 0 && direction <= 360) {
        return ((direction % 360) + 360) % 360;
    }

    const textDirection =
        typeof storm.movement === 'string' ? storm.movement :
        typeof storm.movementDirection === 'string' ? storm.movementDirection :
        typeof storm.direction === 'string' ? storm.direction : '';

    const map = {
        N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90,
        ESE: 112.5, SE: 135, SSE: 157.5, S: 180,
        SSW: 202.5, SW: 225, WSW: 247.5, W: 270,
        WNW: 292.5, NW: 315, NNW: 337.5
    };
    const key = textDirection.trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : NaN;
}

function compassDirection(degrees) {
    if (!Number.isFinite(degrees)) return 'Not reported';
    const directions = [
        'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
        'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
    ];
    return directions[Math.round(degrees / 22.5) % 16];
}

function getMovementSpeed(storm) {
    const speed = firstNumber(
        storm.movementSpeed,
        storm.movement_speed,
        typeof storm.movement === 'object' ? storm.movement.speed : NaN
    );
    return Number.isFinite(speed) ? speed : NaN;
}

function getMovement(storm) {
    const direction = getMovementDirection(storm);
    const speed = getMovementSpeed(storm);

    if (Number.isFinite(direction) && Number.isFinite(speed)) {
        return compassDirection(direction) + ' at ' + Math.round(speed) + ' mph';
    }
    if (Number.isFinite(direction)) return compassDirection(direction);
    return 'Not reported by feed';
}

function getStormCategory(storm) {
    const type = getRawType(storm);
    const wind = getWindKnots(storm);

    if (type === 'TD' || type === 'SD') {
        return { label: type, name: getStormType(storm), color: '#22c55e', size: 38 };
    }
    if (type === 'TS' || type === 'SS') {
        return { label: type, name: getStormType(storm), color: '#22c55e', size: 42 };
    }

    if ((type === 'HU' || type === 'TY') && Number.isFinite(wind)) {
        if (wind >= 137) return { label: '5', name: 'Category 5 Hurricane', color: '#7f1d1d', size: 56 };
        if (wind >= 113) return { label: '4', name: 'Category 4 Hurricane', color: '#dc2626', size: 52 };
        if (wind >= 96) return { label: '3', name: 'Category 3 Hurricane', color: '#f87171', size: 48 };
        if (wind >= 83) return { label: '2', name: 'Category 2 Hurricane', color: '#f97316', size: 44 };
        if (wind >= 64) return { label: '1', name: 'Category 1 Hurricane', color: '#facc15', size: 40 };
    }

    return { label: type || '?', name: getStormType(storm), color: '#94a3b8', size: 38 };
}

function showError(elementId, message) {
    const element = $(elementId);
    if (!element) return;
    element.innerHTML =
        '<div class="error-state">' + escapeHTML(message) + '</div>';
}

function initializeMaps() {
    const mapElement = $('map');
    if (!mapElement) return;

    if (typeof L === 'undefined') {
        showError('storm-list',
            'The map library did not load. Check your connection and reload the page.');
        return;
    }

    if (liveMap) return;

    try {
        liveMap = L.map(mapElement, {
            zoomControl: true,
            preferCanvas: true
        }).setView([22, -65], 3);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            attribution: '&copy; OpenStreetMap contributors',
            crossOrigin: true
        }).addTo(liveMap);

        liveMarkers = L.layerGroup().addTo(liveMap);

        setTimeout(() => {
            if (liveMap) liveMap.invalidateSize();
        }, 250);
    } catch (error) {
        console.error('Map initialization failed:', error);
        showError('storm-list', 'The map could not start: ' + error.message);
    }
}

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
            ? '<span class="storm-direction-arrow" title="Direction of movement" style="transform:rotate(' +
              direction + 'deg)"><span class="storm-direction-shaft"></span><span class="storm-direction-head"></span></span>'
            : '';

        const icon = L.divIcon({
            className: 'storm-div-icon',
            html:
                '<div class="storm-pin" style="--storm-color:' + category.color + ';">' +
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


function renderStormList() {
    const list = $('storm-list');
    if (!list) return;

    if (!storms.length) {
        list.innerHTML =
            '<div class="empty-state">NOAA currently lists no active tropical systems.</div>';
        if ($('detail')) {
            $('detail').innerHTML =
                '<p class="eyebrow">STORM DETAILS</p>' +
                '<p class="detail-placeholder">There are no active storms to select right now.</p>';
        }
        return;
    }

    list.innerHTML = storms.map((storm, index) => {
        const coordinates = getCoordinates(storm);
        const position = coordinates
            ? coordinates[0].toFixed(1) + '°, ' + coordinates[1].toFixed(1) + '°'
            : 'Position unavailable';
        const selected =
            getStormId(storm, index) === selectedStorm ? ' selected' : '';

        return '<button class="storm-card' + selected + '" data-index="' + index + '">' +
            '<div class="storm-name-row">' +
            '<span class="storm-name">' + escapeHTML(getStormName(storm)) + '</span>' +
            '<span class="storm-type">' + escapeHTML(getStormType(storm)) + '</span>' +
            '</div><div class="storm-summary">' +
            '<span>Wind: ' + escapeHTML(getWind(storm)) + '</span>' +
            '<span>' + escapeHTML(position) + '</span>' +
            '</div></button>';
    }).join('');

    list.querySelectorAll('.storm-card').forEach(button => {
        button.addEventListener('click', () => {
            selectStorm(Number(button.dataset.index));
        });
    });
}

function renderStormDetails(storm) {
    const detail = $('detail');
    if (!detail || !storm) return;

    const coordinates = getCoordinates(storm);
    const advisory = storm.publicAdvisory && storm.publicAdvisory.url;
    const position = coordinates
        ? coordinates[0].toFixed(2) + '°, ' + coordinates[1].toFixed(2) + '°'
        : 'Not reported';

    detail.innerHTML =
        '<p class="eyebrow">STORM DETAILS</p>' +
        '<p class="detail-title">' + escapeHTML(getStormName(storm)) + '</p>' +
        '<div class="detail-grid">' +
        '<div class="detail-item"><span>CLASSIFICATION</span><strong>' +
        escapeHTML(getStormType(storm)) + '</strong></div>' +
        '<div class="detail-item"><span>MAX WIND</span><strong>' +
        escapeHTML(getWind(storm)) + '</strong></div>' +
        '<div class="detail-item"><span>POSITION</span><strong>' +
        escapeHTML(position) + '</strong></div>' +
        '<div class="detail-item"><span>MOVEMENT</span><strong>' +
        escapeHTML(getMovement(storm)) + '</strong></div>' +
        '</div><p class="detail-placeholder"><a href="' +
        escapeHTML(advisory || 'https://www.nhc.noaa.gov/') +
        '" target="_blank" rel="noopener noreferrer">Official storm information</a></p>';
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

async function loadLive() {
    if (loadingLive) return;
    loadingLive = true;

    const button = $('refresh-button');
    const lastUpdated = $('last-updated');

    if (button) {
        button.disabled = true;
        button.textContent = 'Updating…';
    }
    if (!storms.length && $('storm-list')) {
        $('storm-list').innerHTML = '<div class="loading">Loading NOAA storm data…</div>';
    }

    try {
        const data = await fetchStormData();

        if (!data || !Array.isArray(data.activeStorms)) {
            throw new Error('The NOAA response did not contain an activeStorms array.');
        }

        storms = data.activeStorms.filter(storm => storm && typeof storm === 'object');

        if ($('storm-count')) {
            $('storm-count').textContent = String(storms.length);
        }
        if (lastUpdated) {
            lastUpdated.textContent = new Date().toLocaleTimeString();
        }

        const selectedIndex = storms.findIndex(
            (storm, index) => getStormId(storm, index) === selectedStorm
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
        showError(
            'storm-list',
            'Could not load live storm data. ' +
            'Check your internet connection and try Refresh data again. ' +
            'Details: ' + error.message
        );
        if (lastUpdated) lastUpdated.textContent = 'Unavailable';
    } finally {
        loadingLive = false;
        if (button) {
            button.disabled = false;
            button.textContent = '↻ Refresh data';
        }
    }
}

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

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadLive, 5 * 60 * 1000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startStormWatch, { once: true });
} else {
    startStormWatch();
}
