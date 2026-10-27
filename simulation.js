 
(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const map = L.map("sim-map", {
    worldCopyJump: true
  }).setView([24, -72], 3);

  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 9,
      attribution: "&copy; OpenStreetMap contributors"
    }
  ).addTo(map);

  let start = null;
  let current = null;
  let storm = null;
  let trackLine = null;
  let trackPoints = [];
  let pressure = null;
  let pressureCircle = null;
  let timer = null;
  let step = 0;
  let pressureMode = false;
  let currentWind = 75;
  let maxWind = 75;
  let totalDamage = 0;
  let totalHouses = 0;
  let totalDeaths = 0;

  const stormIcon = L.divIcon({
    className: "",
    html: '<div style="width:32px;height:32px;border:2px solid white;border-radius:50%;background:#d92738;display:flex;align-items:center;justify-content:center;font-size:19px;box-shadow:0 0 15px #ff4242">🌀</div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  const pressureIcon = L.divIcon({
    className: "",
    html: '<div class="pressure-icon">H</div>',
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });

  function showStatus(message) {
    $("sim-status").textContent = message;
  }

  function category(wind) {
    if (wind >= 137) return 5;
    if (wind >= 113) return 4;
    if (wind >= 96) return 3;
    if (wind >= 83) return 2;
    if (wind >= 64) return 1;
    return 0;
  }

  function formatMoney(amount) {
    if (amount >= 1e9) {
      return "$" + (amount / 1e9).toFixed(1) + "B";
    }
    if (amount >= 1e6) {
      return "$" + (amount / 1e6).toFixed(1) + "M";
    }
    return "$" + Math.round(amount / 1000) + "K";
  }

  function updateDashboard() {
    const cat = category(maxWind);

    $("metric-wind").textContent = maxWind + " mph";
    $("metric-category").textContent =
      cat === 0 ? "Tropical storm" : "Cat " + cat;

    $("metric-houses").textContent =
      Math.round(totalHouses).toLocaleString();

    $("metric-damage").textContent =
      formatMoney(totalDamage);

    $("metric-deaths").textContent =
      Math.round(totalDeaths).toLocaleString();

    $("metric-steps").textContent = step;
  }

  function stopSimulation() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function removeStormLayers() {
    if (storm) map.removeLayer(storm);
    if (trackLine) map.removeLayer(trackLine);

    storm = null;
    trackLine = null;
    trackPoints = [];
  }

  function resetSimulation() {
    stopSimulation();
    removeStormLayers();

    step = 0;
    currentWind = Number($("wind").value);
    maxWind = currentWind;
    totalDamage = 0;
    totalHouses = 0;
    totalDeaths = 0;

    current = start
      ? { lat: start.lat, lng: start.lng }
      : null;

    if (start) {
      storm = L.marker(start, { icon: stormIcon })
        .addTo(map);
    }

    updateDashboard();

    showStatus(
      start
        ? "Starting point selected. Press Start to run the simulation."
        : "Click the map to select a starting point."
    );
  }

  function selectStartingPoint(latlng) {
    start = {
      lat: latlng.lat,
      lng: latlng.lng
    };

    resetSimulation();

    map.setView(latlng, Math.max(map.getZoom(), 4));

    showStatus(
      "Start point: " +
      latlng.lat.toFixed(2) + ", " +
      latlng.lng.toFixed(2) +
      ". Press Start to begin."
    );
  }

  function placeHighPressure(latlng) {
    if (pressure) map.removeLayer(pressure);
    if (pressureCircle) map.removeLayer(pressureCircle);

    pressure = L.marker(latlng, {
      icon: pressureIcon
    }).addTo(map);

    pressure.bindPopup(
      "Illustrative high-pressure center"
    );

    pressureCircle = L.circle(latlng, {
      radius: 850000,
      color: "#5da2ff",
      weight: 2,
      fillColor: "#2f7df6",
      fillOpacity: 0.12,
      dashArray: "7 7"
    }).addTo(map);

    pressureMode = false;
    $("pressure-mode").textContent = "＋ Place high pressure";

    $("pressure-help").textContent =
      "High-pressure center placed. The simplified model will steer the storm away from its center.";

    showStatus(
      "High pressure placed. Start or continue the simulation to see its modeled influence."
    );
  }

  map.on("click", event => {
    if (pressureMode) {
      placeHighPressure(event.latlng);
    } else {
      selectStartingPoint(event.latlng);
    }
  });

  $("pressure-mode").addEventListener("click", () => {
    pressureMode = !pressureMode;

    $("pressure-mode").textContent = pressureMode
      ? "Click map to place H"
      : "＋ Place high pressure";

    $("pressure-help").textContent = pressureMode
      ? "Now click the map where you want the high-pressure center."
      : "High-pressure placement mode is off.";
  });

  $("clear-pressure").addEventListener("click", () => {
    if (pressure) map.removeLayer(pressure);
    if (pressureCircle) map.removeLayer(pressureCircle);

    pressure = null;
    pressureCircle = null;

    showStatus("High-pressure system removed.");
  });

  $("wind").addEventListener("input", () => {
    $("wind-value").textContent = $("wind").value + " mph";

    if (timer === null) {
      currentWind = Number($("wind").value);
      maxWind = currentWind;
      updateDashboard();
    }
  });

  $("profile").addEventListener("change", () => {
    const presets = {
      moderate: 75,
      intense: 130,
      slow: 65
    };

    const wind = presets[$("profile").value];

    $("wind").value = wind;
    $("wind-value").textContent = wind + " mph";

    if (timer === null) {
      currentWind = wind;
      maxWind = wind;
      updateDashboard();
    }
  });

  function runStep() {
    if (!current) {
      stopSimulation();
      showStatus("Click the map to choose a starting point first.");
      return;
    }

    const speed = Number($("speed").value);
    const profile = $("profile").value;

    // Simplified general west/northwest steering.
    let dLat = 0.13 + Math.sin(step * 0.55) * 0.045;
    let dLng = -0.22 + Math.cos(step * 0.37) * 0.04;

    if (profile === "slow") {
      dLat *= 0.65;
      dLng *= 0.55;
    }

    if (profile === "intense") {
      dLat *= 1.12;
      dLng *= 1.08;
    }

    dLat *= speed;
    dLng *= speed;

    // A simplified high-pressure influence:
    // the storm is nudged away from the pressure center.
    if (pressure) {
      const p = pressure.getLatLng();
      const dx = current.lng - p.lng;
      const dy = current.lat - p.lat;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 18 && distance > 0.01) {
        dLat += (dy / distance) * 0.22 * speed;
        dLng += (dx / distance) * 0.22 * speed;
      }
    }

    current = {
      lat: Math.max(-5, Math.min(55, current.lat + dLat)),
      lng: Math.max(-125, Math.min(-5, current.lng + dLng))
    };

    step++;

    // Illustrative wind variation, not a physical intensity forecast.
    currentWind = Math.max(
      35,
      Math.min(
        160,
        Number($("wind").value) +
          Math.round(Math.sin(step * 0.22) * 4) +
          Math.min(20, Math.floor(step / 8) * 2)
      )
    );

    maxWind = Math.max(maxWind, currentWind);

    const point = [current.lat, current.lng];
    trackPoints.push(point);

    if (!storm) {
      storm = L.marker(point, { icon: stormIcon }).addTo(map);
    } else {
      storm.setLatLng(point);
    }

    if (!trackLine) {
      trackLine = L.polyline(trackPoints, {
        color: "#ff4545",
        weight: 3,
        opacity: 0.9
      }).addTo(map);
    } else {
      trackLine.setLatLngs(trackPoints);
    }

    storm.bindPopup(
      "Simulated hurricane<br>" +
      "Wind: " + currentWind + " mph<br>" +
      "Model category: " +
      (category(currentWind) || "Tropical storm")
    );

    // These are fictional scenario counters, not real impact forecasts.
    const coastalFactor =
      Math.max(0, 1 - Math.abs(current.lat - 28) / 38) *
      Math.max(0, 1 - Math.abs(current.lng + 80) / 65);

    const intensity = currentWind / 150;

    totalHouses += Math.round(
      18 * intensity * coastalFactor
    );

    totalDamage +=
      Math.round(18 * intensity * coastalFactor) *
      (18000 + currentWind * 450);

    totalDeaths +=
      coastalFactor *
      (currentWind >= 130 ? 0.025 :
       currentWind >= 100 ? 0.01 : 0.003);

    updateDashboard();

    showStatus(
      "Simulation running · step " + step +
      ". The track and impact counters are generated by a simplified educational model."
    );

    if (
      current.lat >= 54 ||
      current.lng <= -124 ||
      current.lng >= -6 ||
      current.lat <= -4
    ) {
      stopSimulation();
      showStatus(
        "The storm reached the edge of the simulation area. Reset to try another scenario."
      );
    }
  }

  $("start-sim").addEventListener("click", () => {
    if (!start) {
      showStatus("First click the map to choose a starting point.");
      return;
    }

    if (timer !== null) return;

    timer = setInterval(runStep, 700);

    showStatus("Simulation running.");
  });

  $("pause-sim").addEventListener("click", () => {
    stopSimulation();
    showStatus("Simulation paused. Press Start to continue.");
  });

  $("reset-sim").addEventListener("click", resetSimulation);

  $("wind-value").textContent = $("wind").value + " mph";
  updateDashboard();
})();
