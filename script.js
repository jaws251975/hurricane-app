'use strict';
// STORMWATCH - Fixed JavaScript
const DATA_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const HURDAT_URLS = {
    atl: 'https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-092326.txt',
    epac: 'https://www.nhc.noaa.gov/data/hurdat/hurdat2-nepac-1949-2025-092926.txt'
};
const $ = id => document.getElementById(id);
let storms = [];
let archive = [];
let selectedStorm = null;
let liveMap = null;
let historyMap = null;
let liveMarkers = null;
let historyLayers = null;
let loadingLive = false;
let loadingHistory = false;
let loadedBasin = null;
// Safely display text in HTML
function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, function (char) {
        const entities = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return entities[char];
    });
}
function numberValue(value) {
    if (value === null || value === undefined || value === '') {
        return NaN;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
}
function getCoordinates(storm) {
    const latitude = numberValue(
        storm.latitudeNumeric ?? storm.latitude ?? storm.lat
    );
    const longitude = numberValue(
        storm.longitudeNumeric ?? storm.longitude ?? storm.lon
    );
    if (
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        Math.abs(latitude) <= 90 &&
        Math.abs(longitude) <= 180
    ) {
        return [latitude, longitude];
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
    // NOAA reports intensity in knots.
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
// Data fetching with timeout and fallback sources
async function fetchText(url) {
    const sources = [
        url,
        'https://api.allorigins.win/raw?url=' +
            encodeURIComponent(url),
        'https://corsproxy.io/?url=' +
            encodeURIComponent(url)
    ];

    let errors = [];

    for (const source of sources) {
        try {
            const response = await fetch(source);

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            const text = await response.text();

            if (!text || text.length < 100) {
                throw new Error('Response was empty or too short');
            }

            return text;
        } catch (error) {
            errors.push(source + ': ' + error.message);
        }
    }

    throw new Error(
        'Could not load historical data. ' +
        errors.join(' | ')
    );
}
    let lastError = null;
    for (const source of sources) {
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            10000
        );
        try {
            const response = await fetch(source, {
                cache: 'no-store',
                signal: controller.signal
            });
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }
            const text = await response.text();
            if (!text.trim()) {
                throw new Error('Empty response received.');
            }
            if (/^\s*<!doctype html/i.test(text)) {
                throw new Error('Received a webpage instead of data.');
            }
            return text;
        } catch (error) {
            lastError = error;
            console.warn('Data source failed:', error.message);
        } finally {
            clearTimeout(timeout);
        }
    }
    throw new Error(
        lastError ? lastError.message : 'Unable to fetch data.'
    );
}
async function fetchJSON(url) {
    const text = await fetchText(url);
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error('The downloaded data is not valid JSON.');
    }
}
// Initialize both maps
function initializeMaps() {
    if (typeof L === 'undefined') {
        showError(
            'storm-list',
            'The map library did not load. Reload the page and try again.'
        );
        return;
    }
    if ($('map') && !liveMap) {
        liveMap = L.map('map').setView([22, -65], 3);
        L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            {
                maxZoom: 18,
                attribution: '&copy; OpenStreetMap contributors'
            }
        ).addTo(liveMap);
        liveMarkers = L.layerGroup().addTo(liveMap);
    }
    if ($('history-map') && !historyMap) {
        historyMap = L.map('history-map').setView([22, -65], 3);
        L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            {
                maxZoom: 18,
                attribution: '&copy; OpenStreetMap contributors'
            }
        ).addTo(historyMap);
        historyLayers = L.layerGroup().addTo(historyMap);
    }
}
// LIVE TRACKER
function renderStormList() {
    const list = $('storm-list');
    if (!list) return;
    if (!storms.length) {
        list.innerHTML =
            '<div class="empty-state">' +
            'No active tropical systems are listed in the NOAA feed.' +
            '</div>';
        return;
    }
    list.innerHTML = storms.map(function (storm, index) {
        const coordinates = getCoordinates(storm);
        const position = coordinates
            ? coordinates.map(n => n.toFixed(1) + '°').join(', ')
            : 'Position unavailable';
        const id = getStormId(storm, index);
        const selected = id === selectedStorm ? ' selected' : '';
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
    list.querySelectorAll('.storm-card').forEach(function (button) {
        button.addEventListener('click', function () {
            selectStorm(Number(button.dataset.index));
        });
    });
}
function renderStormDetails(storm) {
    const detail = $('detail');
    if (!detail) return;
    const coordinates = getCoordinates(storm);
    const advisory = storm.publicAdvisory &&
        storm.publicAdvisory.url;
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
        ) + '</strong></div>' +
        '</div>' +
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
function renderLiveMap() {
    if (!liveMarkers) return;
    liveMarkers.clearLayers();
    storms.forEach(function (storm) {
        const coordinates = getCoordinates(storm);
        if (!coordinates) return;
        L.circleMarker(coordinates, {
            radius: 7,
            color: '#ffffff',
            weight: 2,
            fillColor: '#ffb35c',
            fillOpacity: 1
        })
        .addTo(liveMarkers)
        .bindPopup(
            '<strong>' + escapeHTML(getStormName(storm)) + '</strong><br>' +
            escapeHTML(getStormType(storm)) + '<br>' +
            'Wind: ' + escapeHTML(getWind(storm))
        );
    });
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
        const data = await fetchJSON(DATA_URL);
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
        if (storms.length) {
            const index = storms.findIndex(function (storm, i) {
                return getStormId(storm, i) === selectedStorm;
            });
            const selectedIndex = index >= 0 ? index : 0;
            selectedStorm = getStormId(
                storms[selectedIndex],
                selectedIndex
            );
            renderStormList();
            renderStormDetails(storms[selectedIndex]);
        } else {
            renderStormList();
            if ($('detail')) {
                $('detail').textContent =
                    'No active storms are listed right now.';
            }
        }
        renderLiveMap();
    } catch (error) {
        console.error('Live tracker error:', error);
        showError(
            'storm-list',
            'Could not load NOAA data: ' + error.message +
            ' Try refreshing or visit nhc.noaa.gov.'
        );
        if ($('last-updated')) {
            $('last-updated').textContent = 'Unavailable';
        }
    } finally {
        loadingLive = false;
        if (button) {
            button.disabled = false;
            button.textContent = 'Refresh data';
        }
    }
}
// HISTORICAL STORM ARCHIVE
function parseHurdat(text, basin) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    const results = [];
    let current = null;
    lines.forEach(function (line) {
        const parts = line.split(',').map(value => value.trim());
        if (!parts[0]) return;
        if (/^(AL|EP|CP)\d{6}$/i.test(parts[0])) {
            current = {
                id: parts[0].toUpperCase(),
                name: (parts[1] || 'UNNAMED').replace(/"/g, ''),
                year: Number(parts[0].slice(4, 8)),
                basin: basin,
                points: []
            };
            results.push(current);
            return;
        }
        if (!current || !/^\d{8}$/.test(parts[0]) || parts.length < 8) {
            return;
        }
        const latitude = Number.parseFloat(parts[4]);
        const longitude = Number.parseFloat(parts[5]);
        const wind = Number(parts[6]);
        const pressure = Number(parts[7]);
        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            !Number.isFinite(wind)
        ) {
            return;
        }
        current.points.push({
            date: parts[0],
            status: parts[3],
            latitude: parts[4].toUpperCase().endsWith('S')
                ? -Math.abs(latitude)
                : latitude,
            longitude: parts[5].toUpperCase().endsWith('W')
                ? -Math.abs(longitude)
                : longitude,
            wind: wind,
            pressure: Number.isFinite(pressure) && pressure > 0
                ? pressure
                : null
        });
    });
    return results.filter(storm => storm.points.length > 0);
}
function peakWind(storm) {
    return Math.max(...storm.points.map(point => point.wind));
}
function windCategory(wind) {
    if (wind >= 137) return 'Category 5';
    if (wind >= 113) return 'Category 4';
    if (wind >= 96) return 'Category 3';
    if (wind >= 83) return 'Category 2';
    if (wind >= 64) return 'Category 1';
    if (wind >= 34) return 'Tropical storm';
    return 'Tropical depression';
}
function setStormOptions(results) {
    const options =
        '<option value="">Choose a storm...</option>' +
        results.map(function (storm) {
            return '<option value="' + escapeHTML(storm.id) + '">' +
                escapeHTML(storm.name) + ' (' + storm.year + ')' +
                '</option>';
        }).join('');
    ['storm-a', 'storm-b'].forEach(function (id) {
        const select = $(id);
        if (select) {
            select.innerHTML = options;
            select.disabled = results.length === 0;
        }
    });
    if ($('compare-button')) {
        $('compare-button').disabled = results.length === 0;
    }
}
async function loadArchive() {
    if (loadingHistory) return;
    loadingHistory = true;
    const basin = $('basin-select')
        ? $('basin-select').value
        : 'atl';
    const button = $('history-load');
    if (button) {
        button.disabled = true;
        button.textContent = 'Loading...';
    }
    if ($('history-status')) {
        $('history-status').textContent =
            'Downloading historical NOAA data...';
    }
    try {
        const text = await fetchText(HURDAT_URLS[basin]);
        archive = parseHurdat(text, basin);
        loadedBasin = basin;
        if (!archive.length) {
            throw new Error('No historical storm records were found.');
        }
        if ($('history-status')) {
            $('history-status').textContent =
                'Loaded ' + archive.length + ' historical storms.';
        }
        updateHistoryResults();
    } catch (error) {
        console.error('Historical archive error:', error);
        loadedBasin = null;
        if ($('history-status')) {
            $('history-status').textContent =
                'Archive failed to load: ' + error.message;
        }
        showError(
            'history-results',
            'Historical data could not be loaded. Try again later.'
        );
        setStormOptions([]);
    } finally {
        loadingHistory = false;
        if (button) {
            button.disabled = false;
            button.textContent = 'Load archive';
        }
    }
}
function updateHistoryResults() {
    if (!loadedBasin) return;
    const query = $('history-search')
        ? $('history-search').value.trim().toLowerCase()
        : '';
    const matches = query
        ? archive.filter(function (storm) {
            return storm.name.toLowerCase().includes(query) ||
                storm.id.toLowerCase().includes(query) ||
                String(storm.year) === query;
        })
        : archive;
    const visible = matches.slice(0, 250);
    if ($('result-count')) {
        $('result-count').textContent = matches.length + ' matches';
    }
    if (!visible.length) {
        if ($('history-results')) {
            $('history-results').textContent =
                'No matching storms found.';
        }
        setStormOptions([]);
        return;
    }
    setStormOptions(visible);
    if (!$('history-results')) return;
    $('history-results').innerHTML = visible.map(function (storm) {
        const wind = peakWind(storm);
        return '<article class="result-row">' +
            '<div class="result-head">' +
            '<span class="result-name">' +
            escapeHTML(storm.name) + '</span>' +
            '<span class="result-year">' + storm.year + '</span>' +
            '</div>' +
            '<div class="result-meta">Peak wind: ' +
            Math.round(wind * 1.15078) + ' mph - ' +
            windCategory(wind) + '</div>' +
            '<div class="result-actions">' +
            '<button class="small-button" data-a="' +
            escapeHTML(storm.id) + '">Set as Storm A</button>' +
            '<button class="small-button" data-b="' +
            escapeHTML(storm.id) + '">Set as Storm B</button>' +
            '</div></article>';
    }).join('');
    $('history-results').querySelectorAll('[data-a]').forEach(function (button) {
        button.addEventListener('click', function () {
            $('storm-a').value = button.dataset.a;
            drawComparison();
        });
    });
    $('history-results').querySelectorAll('[data-b]').forEach(function (button) {
        button.addEventListener('click', function () {
            $('storm-b').value = button.dataset.b;
            drawComparison();
        });
    });
}
function drawComparison() {
    if (!loadedBasin || !historyLayers) return;
    const stormA = archive.find(storm =>
        storm.id === ($('storm-a') ? $('storm-a').value : '')
    );
    const stormB = archive.find(storm =>
        storm.id === ($('storm-b') ? $('storm-b').value : '')
    );
    historyLayers.clearLayers();
    if (!stormA || !stormB || stormA.id === stormB.id) {
        if ($('compare-summary')) {
            $('compare-summary').textContent =
                'Choose two different storms to compare.';
        }
        return;
    }
    const colors = ['#52d8e8', '#ff78a9'];
    const allPoints = [];
    [stormA, stormB].forEach(function (storm, index) {
        const points = storm.points.map(point => [
            point.latitude,
            point.longitude
        ]);
        allPoints.push(...points);
        L.polyline(points, {
            color: colors[index],
            weight: 3
        }).addTo(historyLayers);
    });
    if (allPoints.length && historyMap) {
        historyMap.fitBounds(allPoints, {
            padding: [25, 25],
            maxZoom: 5
        });
    }
    if ($('compare-summary')) {
        $('compare-summary').innerHTML =
            '<p>' + escapeHTML(stormA.name) + ' (' + stormA.year + '): ' +
            Math.round(peakWind(stormA) * 1.15078) + ' mph</p>' +
            '<p>' + escapeHTML(stormB.name) + ' (' + stormB.year + '): ' +
            Math.round(peakWind(stormB) * 1.15078) + ' mph</p>';
    }
}
// BUTTONS, SEARCH AND TABS
function initializeEvents() {
    if ($('refresh-button')) {
        $('refresh-button').addEventListener('click', loadLive);
    }
    if ($('history-load')) {
        $('history-load').addEventListener('click', loadArchive);
    }
    if ($('history-search')) {
        $('history-search').addEventListener('input', updateHistoryResults);
    }
    if ($('compare-button')) {
        $('compare-button').addEventListener('click', drawComparison);
    }
    ['storm-a', 'storm-b'].forEach(function (id) {
        if ($(id)) {
            $(id).addEventListener('change', drawComparison);
        }
    });
    if ($('basin-select')) {
        $('basin-select').addEventListener('change', function () {
            archive = [];
            loadedBasin = null;
            if (historyLayers) historyLayers.clearLayers();
            if ($('history-results')) {
                $('history-results').textContent =
                    'Load the archive to search historical storms.';
            }
            setStormOptions([]);
        });
    }
    document.querySelectorAll('.tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            document.querySelectorAll('.tab').forEach(function (item) {
                item.classList.toggle('active', item === tab);
            });
            if ($('live-view')) {
                $('live-view').hidden = tab.dataset.tab !== 'live';
            }
            if ($('history-view')) {
                $('history-view').hidden = tab.dataset.tab !== 'history';
            }
            setTimeout(function () {
                if (tab.dataset.tab === 'history' && historyMap) {
                    historyMap.invalidateSize();
                } else if (liveMap) {
                    liveMap.invalidateSize();
                }
            }, 150);
        });
    });
}
// START WEBSITE
function startStormWatch() {
    initializeMaps();
    initializeEvents();
    loadLive();
    // Refresh live data every five minutes.
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