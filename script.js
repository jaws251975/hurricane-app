


const DATA_URL =

  "https://www.nhc.noaa.gov/CurrentStorms.json";

const HURDAT_URLS = {

  atl: "https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-092326.txt",

  epac: "https://www.nhc.noaa.gov/data/hurdat/hurdat2-nepac-1949-2025-092926.txt"

};

const $ = id => document.getElementById(id);

const map = L.map("map").setView([25, -65], 3);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {

  maxZoom: 10,

  attribution: '&copy; OpenStreetMap'

}).addTo(map);

const liveMarkers = L.layerGroup().addTo(map);

const historyMap = L.map("history-map").setView([25, -65], 3);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {

  maxZoom: 10,

  attribution: '&copy; OpenStreetMap'

}).addTo(historyMap);

const historyLayers = L.layerGroup().addTo(historyMap);

let currentStorms = [];

let selectedId = null;

let archive = [];

let archiveLoaded = false;

function esc(value) {

  return String(value).replace(/[&<>"']/g, c => ({

    "&": "&amp;", "<": "&lt;", ">": "&gt;",

    '"': "&quot;", "'": "&#39;"

  }[c]));

}

function safe(value, fallback = "Not reported") {

  return value !== undefined && value !== null && String(value).trim()

    ? String(value) : fallback;

}

function getCoords(storm) {

  const lat = Number(storm.latitude ?? storm.lat);

  const lon = Number(storm.longitude ?? storm.lon ?? storm.long);

  return Number.isFinite(lat) && Number.isFinite(lon) &&

    Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;

}

function stormId(storm, index) {

  return String(storm.id ?? storm.atcfID ?? storm.name ?? `storm-${index}`);

}

function stormName(storm) {

  return safe(storm.name, "Unnamed system");

}

function stormClass(storm) {

  const raw = safe(storm.classification ?? storm.class ?? storm.type, "Tropical system");

  return ({ HU: "Hurricane", TS: "Tropical Storm", TD: "Tropical Depression" })[raw.toUpperCase()] || raw;

}

function windText(storm) {

  const value = storm.intensity ?? storm.windSpeed ?? storm.maxWind;

  if (value == null || value === "") return "Not reported";

  const n = Number(String(value).replace(/[^\d.-]/g, ""));

  return Number.isFinite(n) ? `${n} kt (${Math.round(n * 1.15078)} mph)` : String(value);

}

function normalizePayload(data) {

  if (Array.isArray(data)) return data;

  if (Array.isArray(data?.activeStorms)) return data.activeStorms;

  if (Array.isArray(data?.storms)) return data.storms;

  if (Array.isArray(data?.active_storms)) return data.active_storms;

  throw new Error("NOAA response format was not recognized.");

}

/* LIVE TRACKER */

function renderLiveDetails(storm) {

  $("detail").innerHTML = `

    <p class="eyebrow">STORM DETAILS</p>

    <p class="detail-title">${esc(stormName(storm))}</p>

    <div class="detail-grid">

      <div class="detail-item"><span>CLASSIFICATION</span><strong>${esc(stormClass(storm))}</strong></div>

      <div class="detail-item"><span>MAX WIND</span><strong>${esc(windText(storm))}</strong></div>

      <div class="detail-item"><span>PRESSURE</span><strong>${esc(safe(storm.pressure))}</strong></div>

      <div class="detail-item"><span>POSITION</span><strong>${getCoords(storm)?.map(n => n.toFixed(1) + "°").join(", ") ?? "Not reported"}</strong></div>

    </div>

    <p class="detail-placeholder">Official advisories: <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noreferrer">National Hurricane Center</a></p>`;

}

function renderLiveList() {

  const list = $("storm-list");

  if (!currentStorms.length) {

    list.innerHTML = '<div class="empty-state">No active tropical systems are listed in the latest feed.</div>';

    return;

  }

  list.innerHTML = currentStorms.map((storm, index) => `

    <button class="storm-card ${stormId(storm, index) === selectedId ? "selected" : ""}" data-index="${index}">

      <div class="storm-name-row">

        <span class="storm-name">${esc(stormName(storm))}</span>

        <span class="storm-type">${esc(stormClass(storm))}</span>

      </div>

      <div class="storm-summary">

        <span>Wind: ${esc(windText(storm))}</span>

        <span>${getCoords(storm)?.map(n => n.toFixed(1) + "°").join(", ") ?? "Position unavailable"}</span>

      </div>

    </button>`).join("");

  list.querySelectorAll(".storm-card").forEach(button => {

    button.onclick = () => selectLive(Number(button.dataset.index));

  });

}

function selectLive(index) {

  const storm = currentStorms[index];

  if (!storm) return;

  selectedId = stormId(storm, index);

  renderLiveList();

  renderLiveDetails(storm);

  const c = getCoords(storm);

  if (c) map.flyTo(c, Math.max(map.getZoom(), 5));

}

function renderLiveMap() {

  liveMarkers.clearLayers();

  currentStorms.forEach((storm, index) => {

    const c = getCoords(storm);

    if (!c) return;

    L.circleMarker(c, {

      radius: 7,

      color: "#ffffff",

      weight: 2,

      fillColor: "#ffb35c",

      fillOpacity: 1

    }).addTo(liveMarkers)

      .bindPopup(`<strong>${esc(stormName(storm))}</strong><br>${esc(stormClass(storm))}<br>Wind: ${esc(windText(storm))}`)

      .on("click", () => {

        selectedId = stormId(storm, index);

        renderLiveList();

        renderLiveDetails(storm);

      });

  });

}

async function loadLive() {

  const button = $("refresh-button");

  button.disabled = true;

  button.textContent = "Updating…";

  try {

    const response = await fetch(DATA_URL, { cache: "no-store" });

    if (!response.ok) throw new Error(`NHC returned HTTP ${response.status}`);

    currentStorms = normalizePayload(await response.json());

    $("storm-count").textContent = currentStorms.length;

    $("last-updated").textContent = new Date().toLocaleTimeString([], {

      hour: "numeric", minute: "2-digit"

    });

    renderLiveList();

    renderLiveMap();

    if (currentStorms.length) {

      let index = currentStorms.findIndex((s, i) => stormId(s, i) === selectedId);

      if (index < 0) index = 0;

      selectedId = stormId(currentStorms[index], index);

      renderLiveList();

      renderLiveDetails(currentStorms[index]);

    }

  } catch (error) {

    $("last-updated").textContent = "Unavailable";

    $("storm-count").textContent = "—";

    $("storm-list").innerHTML = `

      <div class="error-state">Could not load NOAA data: ${esc(error.message)}.

      Try again later or visit <a href="https://www.nhc.noaa.gov/">NHC.gov</a>.</div>`;

  } finally {

    button.disabled = false;

    button.textContent = "↻ Refresh data";

  }

}

$("refresh-button").addEventListener("click", loadLive);

loadLive();

setInterval(loadLive, 5 * 60 * 1000);

/* HISTORICAL HURDAT2 ARCHIVE */

function parseHurdat(text, basin) {

  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  const storms = [];

  let current = null;

  for (const line of lines) {

    const parts = line.trim().split(",").map(value => value.trim());

    if (!parts[0]) continue;

    if (/^(AL|EP|CP)\d{6}$/i.test(parts[0])) {

      current = {

        id: parts[0],

        name: (parts[1] || "UNNAMED").replace(/^["']|["']$/g, ""),

        year: Number(parts[0].slice(4, 8)),

        basin,

        points: []

      };

      storms.push(current);

      continue;

    }

    if (!current || !/^\d{8}$/.test(parts[0]) || parts.length < 8) continue;

    const latRaw = parts[4];

    const lonRaw = parts[5];

    let lat = parseFloat(latRaw);

    let lon = parseFloat(lonRaw);

    if (/[SW]$/i.test(latRaw)) lat = -lat;

    if (/[SW]$/i.test(lonRaw)) lon = -lon;

    const wind = Number(parts[6]);

    const pressure = Number(parts[7]);

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(wind)) continue;

    current.points.push({

      date: parts[0],

      time: parts[1],

      status: parts[3],

      lat,

      lon,

      wind,

      pressure: Number.isFinite(pressure) && pressure > 0 ? pressure : null

    });

  }

  return storms.filter(storm => storm.points.length);

}

function peakWind(storm) {

  return Math.max(...storm.points.map(point => point.wind));

}

function category(wind) {

  if (wind >= 137) return "Category 5";

  if (wind >= 113) return "Category 4";

  if (wind >= 96) return "Category 3";

  if (wind >= 83) return "Category 2";

  if (wind >= 64) return "Category 1";

  if (wind >= 34) return "Tropical storm";

  return "Tropical depression";

}

async function loadArchive() {

  const basin = $("basin-select").value;

  const button = $("history-load");

  button.disabled = true;

  button.textContent = "Loading…";

  $("history-status").textContent = "Downloading NOAA historical data…";

  try {

    const response = await fetch(HURDAT_URLS[basin]);

    if (!response.ok) throw new Error(`Archive returned HTTP ${response.status}`);

    archive = parseHurdat(await response.text(), basin);

    if (!archive.length) throw new Error("No storm records could be parsed.");

    archiveLoaded = true;

    $("history-status").textContent =

      `Loaded ${archive.length} historical storms. Search by name or year.`;

    updateResults();

  } catch (error) {

    archiveLoaded = false;

    $("history-status").textContent =

      `Could not load the archive: ${error.message}. Check the official NHC archive page for current download links.`;

    $("history-results").innerHTML =

      '<div class="error-state">Historical data unavailable. Visit <a href="https://www.nhc.noaa.gov/data/">the NHC data archive</a>.</div>';

  } finally {

    button.disabled = false;

    button.textContent = "Load archive";

  }

}

function updateResults() {

  const query = $("history-search").value.trim().toLowerCase();

  const results = !query ? archive : archive.filter(storm =>

    storm.name.toLowerCase().includes(query) ||

    storm.id.toLowerCase().includes(query) ||

    String(storm.year) === query

  );

  const visible = results.slice(0, 250);

  $("result-count").textContent = `${results.length} matches`;

  if (!visible.length) {

    $("history-results").innerHTML = '<div class="empty-state">No matching storms. Try a different name or year.</div>';

    return;

  }

  const options = '<option value="">Choose a storm…</option>' +

    visible.map(storm => `<option value="${esc(storm.id)}">${esc(storm.name)} (${storm.year})</option>`).join("");

  $("storm-a").innerHTML = options;

  $("storm-b").innerHTML = options;

  $("storm-a").disabled = false;

  $("storm-b").disabled = false;

  $("compare-button").disabled = false;

  $("history-results").innerHTML = visible.map(storm => `

    <article class="result-row">

      <div class="result-head">

        <span class="result-name">${esc(storm.name)}</span>

        <span class="result-year">${storm.year}</span>

      </div>

      <div class="result-meta">${storm.points.length} observations · peak ${Math.round(peakWind(storm) * 1.15078)} mph · ${category(peakWind(storm))}</div>

      <div class="result-actions">

        <button class="small-button" data-a="${esc(storm.id)}">Set as Storm A</button>

        <button class="small-button" data-b="${esc(storm.id)}">Set as Storm B</button>

      </div>

    </article>`).join("");

  $("history-results").querySelectorAll("[data-a]").forEach(button => {

    button.onclick = () => {

      $("storm-a").value = button.dataset.a;

      drawComparison();

    };

  });

  $("history-results").querySelectorAll("[data-b]").forEach(button => {

    button.onclick = () => {

      $("storm-b").value = button.dataset.b;

      drawComparison();

    };

  });

}

function drawComparison() {

  if (!archiveLoaded) return;

  const stormA = archive.find(storm => storm.id === $("storm-a").value);

  const stormB = archive.find(storm => storm.id === $("storm-b").value);

  historyLayers.clearLayers();

  if (!stormA || !stormB || stormA.id === stormB.id) {

    $("compare-summary").innerHTML =

      '<p class="detail-placeholder">Choose two different storms to compare.</p>';

    return;

  }

  const colors = ["#52d8e8", "#ff78a9"];

  const allCoords = [];

  [stormA, stormB].forEach((storm, index) => {

    const points = storm.points.map(point => [point.lat, point.lon]);

    allCoords.push(...points);

    L.polyline(points, {

      color: colors[index],

      weight: 3,

      opacity: 0.9

    }).addTo(historyLayers).bindPopup(`${esc(storm.name)} (${storm.year})`);

    [storm.points[0], storm.points[storm.points.length - 1]].forEach(point => {

      L.circleMarker([point.lat, point.lon], {

        radius: 5,

        color: "#fff",

        weight: 1,

        fillColor: colors[index],

        fillOpacity: 1

      }).addTo(historyLayers);

    });

  });

  historyMap.fitBounds(allCoords, { padding: [25, 25], maxZoom: 5 });

  const stats = storm => {

    const wind = peakWind(storm);

    const pressures = storm.points.map(point => point.pressure).filter(Number.isFinite);

    const pressure = pressures.length ? Math.min(...pressures) + " mb" : "Not reported";

    return `

      <div class="summary-pill">

        <span>${esc(storm.name)} · ${storm.year}</span>

        <strong>${Math.round(wind * 1.15078)} mph</strong>

      </div>

      <div class="summary-pill">

        <span>MINIMUM PRESSURE</span>

        <strong>${pressure}</strong>

      </div>`;

  };

  $("compare-summary").innerHTML = `

    <div class="summary-stats">${stats(stormA)}${stats(stormB)}</div>

    <p><span style="color:#52d8e8">●</span> ${esc(stormA.name)} &nbsp;

    <span style="color:#ff78a9">●</span> ${esc(stormB.name)}</p>

    <p>Tracks show recorded historical positions, not forecast paths.</p>`;

}

$("history-load").addEventListener("click", loadArchive);

$("history-search").addEventListener("input", () => {

  if (archiveLoaded) updateResults();

});

$("compare-button").addEventListener("click", drawComparison);

$("basin-select").addEventListener("change", () => {

  archiveLoaded = false;

  archive = [];

  $("history-results").innerHTML = '<div class="empty-state">Load the selected archive to search it.</div>';

  $("result-count").textContent = "0 matches";

  $("storm-a").disabled = true;

  $("storm-b").disabled = true;

  $("compare-button").disabled = true;

});

document.querySelectorAll(".tab").forEach(tab => {

  tab.addEventListener("click", () => {

    document.querySelectorAll(".tab").forEach(item =>

      item.classList.toggle("active", item === tab)

    );

    $("live-view").hidden = tab.dataset.tab !== "live";

    $("history-view").hidden = tab.dataset.tab !== "history";

    setTimeout(() => {

      if (tab.dataset.tab === "history") historyMap.invalidateSize();

      else map.invalidateSize();

    }, 100);

  });

});