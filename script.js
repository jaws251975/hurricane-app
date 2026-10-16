
'use strict';

const DATA_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';

const $ = id => document.getElementById(id);

let storms = [];
let selectedStorm = null;
let liveMap = null;
let liveMarkers = null;
let loadingLive = false;

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

function getCoordinates(storm) {
    const lat = numberValue(
        storm.latitudeNumeric ?? storm.latitude ?? storm.lat
    );

    const lon = numberValue(
        storm.longitudeNumeric ?? storm.longitude ?? storm.lon
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
    return String(storm.id || storm.stormId || getStormName(storm) + index);
}

function getStormType(storm) {
    const type = String(
        storm.classification || storm.type || 'Tropical system'
    ).toUpperCase();

    const types = {
        TD: 'Tropical Depression',
        TS: 'Tropical Storm',
        HU: 'Hurricane',
        TY: 'Typhoon',
        ST: 'Super Typhoon',
        EX: 'Extratropical',
        LO: 'Low',
        SD: 'Subtropical Depression',
        SS: 'Subtropical Storm'
    };

    return types[type] || type;
}

function getWind(storm) {
    const wind = numberValue(
        storm.intensity ?? storm.maxWind ?? storm.windSpeed
    );

    if (!Number.isFinite(wind)) {
        return 'Not reported';
    }

    // NOAA storm intensity is reported in knots.
    return Math.round(wind * 1.15078) + ' mph';
}

function showError(elementId, message) {
    const element = $(elementId);

    if (element) {
        element.innerHTML =
            '<div class="error-state">' +
            escapeHTML(message) +
            '</div>';
    }
}

function initializeMaps() {
    if (typeof L === 'undefined') {
        showError('storm-list', 'The map library did not load. Please reload the page.');
        return;
    }

    const mapElement = $('map');

    if (mapElement && !liveMap) {
        liveMap = L.map(mapElement).setView([22, -65], 3);

        L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            {
                maxZoom: 18,
                attribution: '&copy; OpenStreetMap contributors'
            }
        ).addTo(liveMap);

        liveMarkers = L.layerGroup().addTo(liveMap);
    }
}

function getStormCategory(storm) {
    const type = String(
        storm.classification || storm.type || ''
    ).toUpperCase();

    const wind = numberValue(
        storm.intensity ?? storm.maxWind ?? storm.windSpeed
    );

    if (type === 'TD' || type === 'SD') {
        return {
            label: 'TD',
            name: getStormType(storm),
            color: '#22c55e',
            size: 36
        };
    }

    if (type === 'TS' || type === 'SS') {
        return {
            label: 'TS',
            name: getStormType(storm),
            color: '#22c55e',
            size: 39
        };
    }

    if (type === 'HU' && Number.isFinite(wind)) {
        if (wind >= 137) {
            return {
                label: '5',
                name: 'Category 5 Hurricane',
                color: '#7f1d1d',
                size: 60
            };
        }

        if (wind >= 113) {
            return {
                label: '4',
                name: 'Category 4 Hurricane',
                color: '#dc2626',
                size: 55
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
                size: 45
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
        size: 36
    };
}

function renderLiveMap() {
    if (!liveMarkers) return;

    liveMarkers.clearLayers();

    storms.forEach(storm => {
        const coordinates = getCoordinates(storm);
        if (!coordinates) return;

        const category = getStormCategory(storm);
        const size = category.size;

        const icon = L.divIcon({
            className: 'storm-div-icon',
            html:
                '<div class="storm-pin" style="--storm-color:' +
                category.color +
                ';width:' + size + 'px;height:' + size + 'px">' +

                '<svg class="storm-swirl" viewBox="0 0 64 64" aria-hidden="true">' +
                '<circle cx="32" cy="32" r="27" fill="none" stroke="white" stroke-width="2.5" stroke-dasharray="28 8 12 7 20 10" stroke-linecap="round"/>' +
                '<circle cx="32" cy="32" r="20" fill="none" stroke="white" stroke-width="2.5" stroke-dasharray="18 7 25 9 10 6" stroke-linecap="round"/>' +
                '<circle cx="32" cy="32" r="13" fill="none" stroke="white" stroke-width="2.5" stroke-dasharray="12 6 18 7" stroke-linecap="round"/>' +
                '</svg>' +

                '<span class="storm-pin-label">' +
                escapeHTML(category.label) +
                '</span></div>',
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
            popupAnchor: [0, -size / 2]
        });

        L.marker(coordinates, { icon })
            .addTo(liveMarkers)
            .bindPopup(
                '<strong>' + escapeHTML(getStormName(storm)) +
                '</strong><br>' +
                escapeHTML(category.name) + '<br>' +
                'Wind: ' + escapeHTML(getWind(storm))
            );
    });
}

function renderStormList() {
    const list = $('storm-list');
    if (!list) return;

    if (!storms.length) {
        list.innerHTML =
            '<div class="empty-state">' +
            'No active tropical systems are listed in the NOAA feed.' +
            '</div>';

        if ($('detail')) {
            $('detail').innerHTML =
                '<p class="eyebrow">STORM DETAILS</p>' +
                '<p class="detail-placeholder">No active storms to display.</p>';
        }

        return;
    }

    list.innerHTML = storms.map((storm, index) => {
        const coordinates = getCoordinates(storm);

        const position = coordinates
            ? coordinates.map(n => n.toFixed(1) + '°').join(', ')
            : 'Position unavailable';

        const selected =
            getStormId(storm, index) === selectedStorm ? ' selected' : '';

        return (
            '<button class="storm-card' + selected +
            '" data-index="' + index + '">' +
            '<div class="storm-name-row">' +
            '<span class="storm-name">' +
            escapeHTML(getStormName(storm)) +
            '</span>' +
            '<span class="storm-type">' +
            escapeHTML(getStormType(storm)) +
            '</span></div>' +
            '<div class="storm-summary">' +
            '<span>Wind: ' + escapeHTML(getWind(storm)) + '</span>' +
            '<span>' + escapeHTML(position) + '</span>' +
            '</div></button>'
        );
    }).join('');

    list.querySelectorAll('.storm-card').forEach(button => {
        button.addEventListener('click', () => {
            selectStorm(Number(button.dataset.index));
        });
    });
}

function renderStormDetails(storm) {
    const detail = $('detail');
    if (!detail) return;

    const coordinates = getCoordinates(storm);
    const advisory = storm.publicAdvisory?.url;

    detail.innerHTML =
        '<p class="eyebrow">STORM DETAILS</p>' +
        '<p class="detail-title">' +
        escapeHTML(getStormName(storm)) +
        '</p>' +
        '<div class="detail-grid">' +
        '<div class="detail-item"><span>CLASSIFICATION</span>' +
        '<strong>' + escapeHTML(getStormType(storm)) + '</strong></div>' +
        '<div class="detail-item"><span>MAX WIND</span>' +
        '<strong>' + escapeHTML(getWind(storm)) + '</strong></div>' +
        '<div class="detail-item"><span>POSITION</span>' +
        '<strong>' + escapeHTML(
            coordinates
                ? coordinates.map(n => n.toFixed(2) + '°').join(', ')
                : 'Not reported'
        ) + '</strong></div></div>' +
        '<p class="detail-placeholder">' +
        '<a href="' + escapeHTML(
            advisory || 'https://www.nhc.noaa.gov/'
        ) + '" target="_blank" rel="noopener noreferrer">' +
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

async function loadLive() {
    if (loadingLive) return;

    loadingLive = true;

    const button = $('refresh-button');

    if (button) {
        button.disabled = true;
        button.textContent = 'Updating...';
    }

    if ($('storm-list') && !storms.length) {
        $('storm-list').textContent = 'Loading NOAA data...';
    }

    try {
        const response = await fetch(DATA_URL, { cache: 'no-store' });

        if (!response.ok) {
            throw new Error('NOAA returned HTTP ' + response.status);
        }

        const data = await response.json();

        if (!data || !Array.isArray(data.activeStorms)) {
            throw new Error('NOAA data format was not recognized.');
        }

        storms = data.activeStorms;

        if ($('storm-count')) {
            $('storm-count').textContent = storms.length;
        }

        if ($('last-updated')) {
            $('last-updated').textContent =
                new Date().toLocaleTimeString();
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
            renderStormList();
        }

        renderLiveMap();
    } catch (error) {
        console.error('Live tracker error:', error);

        showError(
            'storm-list',
            'Could not load NOAA data. Check your connection or try again later.'
        );

        if ($('last-updated')) {
            $('last-updated').textContent = 'Unavailable';
        }
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

    // Refresh the live feed every five minutes.
    setInterval(loadLive, 5 * 60 * 1000);
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
