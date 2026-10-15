/* =========================================================
STORMWATCH — COMPLETE SCRIPT
Live tropical storm tracker + historical HURDAT2 archive
========================================================= */

‘use strict’;

/* –––––––––– CONFIGURATION –––––––––– */

const DATA_URL = ‘https://www.nhc.noaa.gov/CurrentStorms.json’;

const HURDAT_URLS = {
atl: ‘https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-092326.txt’,
epac: ‘https://www.nhc.noaa.gov/data/hurdat/hurdat2-nepac-1949-2025-092926.txt’
};

const REFRESH_MS = 5 * 60 * 1000;

/* –––––––––– APP STATE –––––––––– */

const $ = id => document.getElementById(id);

let currentStorms = [];
let selectedId = null;

let liveBusy = false;
let historyBusy = false;

let archive = [];
let archiveLoadedFor = null;

let map = null;
let historyMap = null;
let liveMarkers = null;
let historyLayers = null;

/* –––––––––– GENERAL HELPERS –––––––––– */

function esc(value) {
return String(value ?? ‘’).replace(/[&<>”’]/g, character => ({
‘&’: ‘&’,
‘<’: ‘<’,
‘>’: ‘>’,
‘”’: ‘"’,
“’”: ‘'’
})[character]);
}

function safe(value) {
if (
value === null ||
value === undefined ||
value === ‘’ ||
!Number.isFinite(Number(value))
) {
return ‘Not reported’;
}

return String(value);
}

function coordinate(value, type) {
if (value === null || value === undefined || value === ‘’) {
return NaN;
}

if (typeof value === ‘number’) {
return Number.isFinite(value) ? value : NaN;
}

const input = String(value).trim().toUpperCase();
const match = input.match(/^(-?\d+(?:.\d+)?)\s*([NSEW])?$/);

if (!match) return NaN;

let number = Number(match[1]);
const hemisphere = match[2];

if (hemisphere === ‘S’ || hemisphere === ‘W’) {
number = -Math.abs(number);
} else if (hemisphere === ‘N’ || hemisphere === ‘E’) {
number = Math.abs(number);
}

if (type === ‘lat’ && Math.abs(number) > 90) return NaN;
if (type === ‘lon’ && Math.abs(number) > 180) return NaN;

return number;
}

function getCoords(storm) {
if (!storm) return null;

const latitude = coordinate(
storm.latitude ?? storm.lat ?? storm.Latitude,
‘lat’
);

const longitude = coordinate(
storm.longitude ?? storm.lon ?? storm.lng ?? storm.Longitude,
‘lon’
);

if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
return null;
}

return [latitude, longitude];
}

function stormId(storm, index = 0) {
return String(
storm.id ??
storm.stormId ??
storm.binNumber ??
storm.name ??
storm-${index}
);
}

function stormName(storm) {
return storm.name || storm.stormName || ‘Unnamed system’;
}

function stormClass(storm) {
const value = String(
storm.classification ??
storm.type ??
storm.status ??
storm.stormType ??
‘Tropical system’
).toUpperCase();

const labels = {
TD: ‘Tropical Depression’,
TS: ‘Tropical Storm’,
HU: ‘Hurricane’,
TY: ‘Typhoon’,
ST: ‘Super Typhoon’,
SD: ‘Subtropical Depression’,
SS: ‘Subtropical Storm’,
EX: ‘Extratropical’,
LO: ‘Low’,
WV: ‘Tropical Wave’,
DB: ‘Disturbance’
};

return labels[value] || value;
}

function windText(storm) {
const value = Number(
storm.maxWind ??
storm.intensity ??
storm.wind ??
storm.windSpeed ??
storm.maximumWind
);

if (!Number.isFinite(value) || value < 0) {
return ‘Not reported’;
}

return ${Math.round(value)} mph;
}

/* –––––––––– MAP INITIALIZATION –––––––––– */

function initializeMaps() {
if (typeof L === ‘undefined’) {
console.error(‘Leaflet did not load. Check the Leaflet script in index.html.’);
return;
}

if ($(‘map’)) {
map = L.map(‘map’).setView([22, -65], 3);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 18
}).addTo(map);
liveMarkers = L.layerGroup().addTo(map);

}

if ($(‘history-map’)) {
historyMap = L.map(‘history-map’).setView([22, -65], 3);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 18
}).addTo(historyMap);
historyLayers = L.layerGroup().addTo(historyMap);

}
}

/* –––––––––– NETWORK REQUESTS –––––––––– */

/*
One fetchText function is used for both live and historical data.
Each source gets its own timeout. If a source fails, the next
source is tried automatically.
*/

async function fetchText(url) {
const sources = [
url,
https://api.allorigins.win/raw?url=${encodeURIComponent(url)},
https://corsproxy.io/?url=${encodeURIComponent(url)}
];

let lastError = null;

for (const source of sources) {
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 45000);

try {
  const response = await fetch(source, {
    cache: 'no-store',
    signal: controller.signal
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const result = await response.text();
  if (!result.trim()) {
    throw new Error('The server returned an empty response.');
  }
  // Prevent an HTML error page from being mistaken for data.
  if (
    /^\s*<!doctype html/i.test(result) ||
    /^\s*<html/i.test(result)
  ) {
    throw new Error('The server returned a webpage instead of data.');
  }
  return result;
} catch (error) {
  lastError = error;
  console.warn('Download source failed:', source, error);
} finally {
  clearTimeout(timeout);
}

}

if (lastError?.name === ‘AbortError’) {
throw new Error(‘Request timed out. Please try again.’);
}

throw new Error(
All download attempts failed: ${ lastError?.message || 'Network or CORS error' }
);
}

async function fetchJSON(url) {
const text = await fetchText(url);

try {
return JSON.parse(text);
} catch {
throw new Error(‘The downloaded response was not valid JSON.’);
}
}

/* –––––––––– LIVE DATA NORMALIZATION –––––––––– */

function normalizePayload(payload) {
let storms = [];

if (Array.isArray(payload)) {
storms = payload;
} else if (Array.isArray(payload?.activeStorms)) {
storms = payload.activeStorms;
} else if (Array.isArray(payload?.storms)) {
storms = payload.storms;
} else if (Array.isArray(payload?.active_storms)) {
storms = payload.active_storms;
} else if (Array.isArray(payload?.features)) {
storms = payload.features.map(feature => ({
…feature.properties,
…(feature.geometry?.coordinates
? {
longitude: feature.geometry.coordinates[0],
latitude: feature.geometry.coordinates[1]
}
: {})
}));
}

return storms.filter(storm => storm && typeof storm === ‘object’);
}

/* –––––––––– LIVE STORM DETAILS –––––––––– */

function renderLiveDetails(storm) {
if (!$(‘detail’)) return;

const coords = getCoords(storm);
const pressure = safe(storm.pressure);

const direction = Number(storm.movementDir);
const speed = Number(storm.movementSpeed);

const movement =
Number.isFinite(direction) && Number.isFinite(speed)
? ${direction}° at ${speed} mph
: ‘Not reported’;

const advisoryUrl =
storm.publicAdvisory?.url ||
storm.forecastAdvisory?.url;

const advisory = advisoryUrl
? <a href="${esc(advisoryUrl)}" target="_blank" rel="noopener noreferrer">Latest advisory</a>
: <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noopener noreferrer">National Hurricane Center</a>;

$(‘detail’).innerHTML = `
STORM DETAILS
${esc(stormName(storm))}

<div class="detail-grid">
  <div class="detail-item">
    <span>CLASSIFICATION</span>
    <strong>${esc(stormClass(storm))}</strong>
  </div>
  <div class="detail-item">
    <span>MAX WIND</span>
    <strong>${esc(windText(storm))}</strong>
  </div>
  <div class="detail-item">
    <span>PRESSURE</span>
    <strong>${esc(
      pressure === 'Not reported' ? pressure : `${pressure} mb`
    )}</strong>
  </div>
  <div class="detail-item">
    <span>POSITION</span>
    <strong>${esc(
      coords
        ? coords.map(number => `${number.toFixed(1)}°`).join(', ')
        : 'Not reported'
    )}</strong>
  </div>
  <div class="detail-item">
    <span>MOVEMENT</span>
    <strong>${esc(movement)}</strong>
  </div>
</div>
<p class="detail-placeholder">
  Official information: ${advisory}
</p>

`;
}

function renderLiveList() {
const list = $(‘storm-list’);
if (!list) return;

if (!currentStorms.length) {
list.innerHTML =  <div class="empty-state"> No active tropical systems are listed in the latest NOAA feed. </div>;
return;
}

list.innerHTML = currentStorms.map((storm, index) => {
const coords = getCoords(storm);
const id = stormId(storm, index);

return `
  <button class="storm-card ${id === selectedId ? 'selected' : ''}"
    data-index="${index}">
    <div class="storm-name-row">
      <span class="storm-name">${esc(stormName(storm))}</span>
      <span class="storm-type">${esc(stormClass(storm))}</span>
    </div>
    <div class="storm-summary">
      <span>Wind: ${esc(windText(storm))}</span>
      <span>${esc(
        coords
          ? coords.map(number => `${number.toFixed(1)}°`).join(', ')
          : 'Position unavailable'
      )}</span>
    </div>
  </button>`;

}).join(’’);

list.querySelectorAll(’.storm-card’).forEach(button => {
button.addEventListener(‘click’, () => {
selectLive(Number(button.dataset.index));
});
});
}

function selectLive(index) {
const storm = currentStorms[index];
if (!storm) return;

selectedId = stormId(storm, index);

renderLiveList();
renderLiveDetails(storm);

const coords = getCoords(storm);

if (coords && map) {
map.flyTo(coords, Math.max(map.getZoom(), 5));
}
}

function renderLiveMap() {
if (!liveMarkers) return;

liveMarkers.clearLayers();

currentStorms.forEach((storm, index) => {
const coords = getCoords(storm);
if (!coords) return;

L.circleMarker(coords, {
  radius: 7,
  color: '#ffffff',
  weight: 2,
  fillColor: '#ffb35c',
  fillOpacity: 1
})
  .addTo(liveMarkers)
  .bindPopup(
    `<strong>${esc(stormName(storm))}</strong><br>` +
    `${esc(stormClass(storm))}<br>` +
    `Wind: ${esc(windText(storm))}`
  )
  .on('click', () => {
    selectedId = stormId(storm, index);
    renderLiveList();
    renderLiveDetails(storm);
  });

});
}

/* –––––––––– LOAD LIVE TRACKER –––––––––– */

async function loadLive() {
if (liveBusy) return;

liveBusy = true;

const button = $(‘refresh-button’);

if (button) {
button.disabled = true;
button.textContent = ‘Updating…’;
}

try {
const data = await fetchJSON(DATA_URL);

currentStorms = normalizePayload(data);
if ($('storm-count')) {
  $('storm-count').textContent = currentStorms.length;
}
if ($('last-updated')) {
  $('last-updated').textContent = new Date().toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });
}
let index = currentStorms.findIndex(
  (storm, i) => stormId(storm, i) === selectedId
);
if (index < 0) index = 0;
selectedId = currentStorms.length
  ? stormId(currentStorms[index], index)
  : null;
renderLiveList();
renderLiveMap();
if (currentStorms.length) {
  renderLiveDetails(currentStorms[index]);
} else if ($('detail')) {
  $('detail').innerHTML = `
    <p class="eyebrow">STORM DETAILS</p>
    <p class="detail-placeholder">
      No active systems in the current feed.
    </p>`;
}

} catch (error) {
console.error(‘Live data could not be loaded:’, error);

if ($('last-updated')) {
  $('last-updated').textContent = 'Unavailable';
}
if ($('storm-count')) {
  $('storm-count').textContent = '—';
}
if ($('storm-list')) {
  $('storm-list').innerHTML = `
    <div class="error-state">
      Could not load live NOAA data: ${esc(error.message)}.
      Try again later or visit
      <a href="https://www.nhc.noaa.gov/"
        target="_blank" rel="noopener noreferrer">NHC.gov</a>.
    </div>`;
}

} finally {
liveBusy = false;

if (button) {
  button.disabled = false;
  button.textContent = '↻ Refresh data';
}

}
}

/* –––––––––– HISTORICAL HURDAT2 ARCHIVE –––––––––– */

function parseHurdat(text, basin) {
const lines = text.replace(/^\uFEFF/, ‘’).split(/\r?\n/);
const storms = [];
let current = null;

for (const line of lines) {
const parts = line.trim().split(’,’).map(value => value.trim());

if (!parts[0]) continue;
// Example header: AL092011, IRENE, 39,
if (/^(AL|EP|CP)\d{6}$/i.test(parts[0])) {
  current = {
    id: parts[0].toUpperCase(),
    name: (parts[1] || 'UNNAMED').replace(/^["']|["']$/g, ''),
    year: Number(parts[0].slice(4, 8)),
    basin,
    points: []
  };
  storms.push(current);
  continue;
}
if (
  !current ||
  !/^\d{8}$/.test(parts[0]) ||
  parts.length < 8
) {
  continue;
}
const lat = coordinate(parts[4], 'lat');
const lon = coordinate(parts[5], 'lon');
const wind = Number(parts[6]);
const pressure = Number(parts[7]);
if (
  !Number.isFinite(lat) ||
  !Number.isFinite(lon) ||
  !Number.isFinite(wind) ||
  Math.abs(lat) > 90 ||
  Math.abs(lon) > 180
) {
  continue;
}
current.points.push({
  date: parts[0],
  time: parts[1],
  status: parts[3],
  lat,
  lon,
  wind,
  pressure: Number.isFinite(pressure) && pressure > 0
    ? pressure
    : null
});

}

return storms.filter(storm => storm.points.length > 0);
}

function peakWind(storm) {
return storm.points.reduce(
(maximum, point) => Math.max(maximum, point.wind),
0
);
}

function category(wind) {
if (wind >= 137) return ‘Category 5’;
if (wind >= 113) return ‘Category 4’;
if (wind >= 96) return ‘Category 3’;
if (wind >= 83) return ‘Category 2’;
if (wind >= 64) return ‘Category 1’;
if (wind >= 34) return ‘Tropical storm’;
return ‘Tropical depression’;
}

/* –––––––––– LOAD HISTORICAL ARCHIVE –––––––––– */

async function loadArchive() {
if (historyBusy) return;

historyBusy = true;

const basin = $(‘basin-select’)?.value || ‘atl’;
const button = $(‘history-load’);

if (button) {
button.disabled = true;
button.textContent = ‘Loading…’;
}

if ($(‘history-status’)) {
$(‘history-status’).textContent =
‘Downloading NOAA historical data…’;
}

try {
const url = HURDAT_URLS[basin];

if (!url) {
  throw new Error('Unknown archive selection.');
}
const text = await fetchText(url);
const parsed = parseHurdat(text, basin);
if (!parsed.length) {
  throw new Error(
    'No storm records were parsed. The archive URL may have changed.'
  );
}
archive = parsed;
archiveLoadedFor = basin;
if ($('history-status')) {
  $('history-status').textContent =
    `Loaded ${archive.length} historical storms. Search by name or year.`;
}
updateResults();

} catch (error) {
console.error(‘Historical archive could not be loaded:’, error);

archive = [];
archiveLoadedFor = null;
if ($('history-status')) {
  $('history-status').textContent =
    `Could not load archive: ${error.message}`;
}
if ($('history-results')) {
  $('history-results').innerHTML = `
    <div class="error-state">
      Historical data unavailable. Visit the
      <a href="https://www.nhc.noaa.gov/data/"
        target="_blank" rel="noopener noreferrer">official NHC archive</a>
      and try again.
    </div>`;
}
if ($('result-count')) {
  $('result-count').textContent = '0 matches';
}
setStormOptions([]);

} finally {
historyBusy = false;

if (button) {
  button.disabled = false;
  button.textContent = 'Load archive';
}

}
}

/* –––––––––– HISTORICAL SEARCH –––––––––– */

function updateResults() {
if (!archiveLoadedFor) return;

const query = $(‘history-search’)?.value.trim().toLowerCase() || ‘’;

const results = query
? archive.filter(storm =>
storm.name.toLowerCase().includes(query) ||
storm.id.toLowerCase().includes(query) ||
String(storm.year) === query
)
: archive;

// Limit displayed results to keep the interface responsive.
const visible = results.slice(0, 250);

if ($(‘result-count’)) {
$(‘result-count’).textContent = ${results.length} matches;
}

if (!visible.length) {
if ($(‘history-results’)) {
$(‘history-results’).innerHTML =  <div class="empty-state"> No matching storms. Try another name or year. </div>;
}

setStormOptions([]);
return;

}

const oldA = $(‘storm-a’)?.value || ‘’;
const oldB = $(‘storm-b’)?.value || ‘’;

setStormOptions(visible);

if (visible.some(storm => storm.id === oldA)) {
$(‘storm-a’).value = oldA;
}

if (visible.some(storm => storm.id === oldB)) {
$(‘storm-b’).value = oldB;
}

if (!$(‘history-results’)) return;

$(‘history-results’).innerHTML = visible.map(storm => {
const wind = peakWind(storm);

return `
  <article class="result-row">
    <div class="result-head">
      <span class="result-name">${esc(storm.name)}</span>
      <span class="result-year">${storm.year}</span>
    </div>
    <div class="result-meta">
      ${storm.points.length} observations · peak
      ${Math.round(wind * 1.15078)} mph · ${category(wind)}
    </div>
    <div class="result-actions">
      <button class="small-button" data-a="${esc(storm.id)}">
        Set as Storm A
      </button>
      <button class="small-button" data-b="${esc(storm.id)}">
        Set as Storm B
      </button>
    </div>
  </article>`;

}).join(’’);

$(‘history-results’).querySelectorAll(’[data-a]’).forEach(button => {
button.addEventListener(‘click’, () => {
$(‘storm-a’).value = button.dataset.a;
drawComparison();
});
});

$(‘history-results’).querySelectorAll(’[data-b]’).forEach(button => {
button.addEventListener(‘click’, () => {
$(‘storm-b’).value = button.dataset.b;
drawComparison();
});
});
}

function setStormOptions(storms) {
const options =
‘Choose a storm…’ +
storms.map(storm =>
<option value="${esc(storm.id)}">${esc(storm.name)} (${storm.year})</option>
).join(’’);

if ($(‘storm-a’)) {
$(‘storm-a’).innerHTML = options;
$(‘storm-a’).disabled = storms.length === 0;
}

if ($(‘storm-b’)) {
$(‘storm-b’).innerHTML = options;
$(‘storm-b’).disabled = storms.length === 0;
}

if ($(‘compare-button’)) {
$(‘compare-button’).disabled = storms.length === 0;
}
}

/* –––––––––– STORM COMPARISON –––––––––– */

function drawComparison() {
if (!archiveLoadedFor || !historyLayers) return;

const stormA = archive.find(
storm => storm.id === $(‘storm-a’)?.value
);

const stormB = archive.find(
storm => storm.id === $(‘storm-b’)?.value
);

historyLayers.clearLayers();

if (!stormA || !stormB || stormA.id === stormB.id) {
if ($(‘compare-summary’)) {
$(‘compare-summary’).innerHTML =  <p class="detail-placeholder"> Choose two different storms to compare. </p>;
}

return;

}

const colors = [’#52d8e8’, ‘#ff78a9’];
const allCoords = [];

[stormA, stormB].forEach((storm, index) => {
const points = storm.points.map(point => [point.lat, point.lon]);

allCoords.push(...points);
L.polyline(points, {
  color: colors[index],
  weight: 3,
  opacity: 0.9
})
  .addTo(historyLayers)
  .bindPopup(`${esc(storm.name)} (${storm.year})`);
const endpoints = [
  storm.points[0],
  storm.points[storm.points.length - 1]
];
endpoints.forEach(point => {
  L.circleMarker([point.lat, point.lon], {
    radius: 5,
    color: '#ffffff',
    weight: 1,
    fillColor: colors[index],
    fillOpacity: 1
  }).addTo(historyLayers);
});

});

if (allCoords.length && historyMap) {
historyMap.fitBounds(allCoords, {
padding: [25, 25],
maxZoom: 5
});
}

function stats(storm) {
const wind = peakWind(storm);

const pressures = storm.points
  .map(point => point.pressure)
  .filter(Number.isFinite);
const pressure = pressures.length
  ? `${Math.min(...pressures)} mb`
  : 'Not reported';
return `
  <div class="summary-pill">
    <span>${esc(storm.name)} · ${storm.year}</span>
    <strong>
      ${Math.round(wind * 1.15078)} mph · ${category(wind)}
    </strong>
  </div>
  <div class="summary-pill">
    <span>MINIMUM PRESSURE</span>
    <strong>${pressure}</strong>
  </div>`;

}

if ($(‘compare-summary’)) {
$(‘compare-summary’).innerHTML = `
${stats(stormA)}
${stats(stormB)}
  <p>
    <span style="color:#52d8e8">●</span> ${esc(stormA.name)}
    &nbsp;
    <span style="color:#ff78a9">●</span> ${esc(stormB.name)}
  </p>
  <p>Tracks show recorded historical positions, not forecast paths.</p>
`;

}
}

/* –––––––––– EVENTS AND STARTUP –––––––––– */

function initializeEvents() {
$(‘refresh-button’)?.addEventListener(‘click’, loadLive);
$(‘history-load’)?.addEventListener(‘click’, loadArchive);
$(‘history-search’)?.addEventListener(‘input’, updateResults);
$(‘compare-button’)?.addEventListener(‘click’, drawComparison);
$(‘storm-a’)?.addEventListener(‘change’, drawComparison);
$(‘storm-b’)?.addEventListener(‘change’, drawComparison);

$(‘basin-select’)?.addEventListener(‘change’, () => {
archive = [];
archiveLoadedFor = null;

if (historyLayers) historyLayers.clearLayers();
if ($('history-results')) {
  $('history-results').innerHTML = `
    <div class="empty-state">
      Load the selected archive to search it.
    </div>`;
}
if ($('history-status')) {
  $('history-status').textContent =
    'Load an archive to search historical storm tracks.';
}
if ($('result-count')) {
  $('result-count').textContent = '0 matches';
}
setStormOptions([]);
if ($('compare-summary')) {
  $('compare-summary').innerHTML = `
    <p class="detail-placeholder">
      Choose two storms to compare their paths.
    </p>`;
}

});

document.querySelectorAll(’.tab’).forEach(tab => {
tab.addEventListener(‘click’, () => {
document.querySelectorAll(’.tab’).forEach(item => {
item.classList.toggle(‘active’, item === tab);
});

  if ($('live-view')) {
    $('live-view').hidden = tab.dataset.tab !== 'live';
  }
  if ($('history-view')) {
    $('history-view').hidden = tab.dataset.tab !== 'history';
  }
  setTimeout(() => {
    if (tab.dataset.tab === 'history' && historyMap) {
      historyMap.invalidateSize();
    } else if (map) {
      map.invalidateSize();
    }
  }, 100);
});

});
}

function startStormWatch() {
initializeMaps();
initializeEvents();

loadLive();

// Refresh the live feed every five minutes.
setInterval(loadLive, REFRESH_MS);
}

if (document.readyState === ‘loading’) {
document.addEventListener(‘DOMContentLoaded’, startStormWatch, {
once: true
});
} else {
startStormWatch();
}