 
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
  let landPenalty = 0;

  function makeStormIcon(wind) {
    const size = Math.max(30, Math.min(64, 30 + (wind - 35) * 0.32));
    const cat = category(wind);
    const color =
      cat >= 5 ? "#8b0000" :
      cat >= 4 ? "#ef233c" :
      cat >= 3 ? "#ff654f" :
      cat >= 2 ? "#ff9f1c" :
      cat >= 1 ? "#ffd43b" :
      "#48d597";

    const label = cat === 0 ? "TS" : "CAT " + cat;

    return L.divIcon({
      className: "",
      html: `
        <div class="sim-storm-wrap" style="width:${size}px;height:${size}px">
          <div class="sim-storm-halo" style="border-color:${color}"></div>
          <div class="sim-storm-bands"></div>
          <div class="sim-storm-bands sim-storm-bands-two"></div>
          <div class="sim-storm-eye"></div>
          <span class="sim-storm-label" style="background:${color}">
            ${label}
          </span>
        </div>
      `,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2]
    });
  }

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
    // Approximate land areas for this educational Atlantic-basin simulation.
  // These simplified polygons are not precise coastline data.
  function isOverLand(lat, lng) {
    const areas = [
      // Eastern and southeastern United States
      [[25, -98], [29, -97], [32, -90], [30, -82],
       [35, -75], [45, -67], [49, -67], [49, -95],
       [40, -100]],

      // Mexico and Central America
      [[7, -105], [24, -105], [32, -97], [25, -80],
       [18, -82], [7, -77]],

      // Cuba
      [[19.5, -85], [23.5, -85], [23.5, -74],
       [19.5, -74]],

      // Hispaniola
      [[17.4, -74.8], [20.1, -74.8],
       [20.1, -68.3], [17.4, -68.3]],

      // Puerto Rico
      [[17.8, -67.3], [18.6, -67.3],
       [18.6, -65.2], [17.8, -65.2]]
    ];

    return areas.some(poly => {
      let inside = false;

      for (let i = 0, j = poly.length - 1;
           i < poly.length; j = i++) {
        const yi = poly[i][0], xi = poly[i][1];
        const yj = poly[j][0], xj = poly[j][1];

        const crosses =
          (yi > lat) !== (yj > lat) &&
          lng < ((xj - xi) * (lat - yi)) /
                ((yj - yi) || 0.000001) + xi;

        if (crosses) inside = !inside;
      }

      return inside;
    });
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
    landPenalty = 0;
    currentWind = Number($("wind").value);
    maxWind = currentWind;
    totalDamage = 0;
    totalHouses = 0;
    totalDeaths = 0;

    current = start
      ? { lat: start.lat, lng: start.lng }
      : null;

 if (start) {
  storm = L.marker(start, {
    icon: makeStormIcon(currentWind)
  }).addTo(map);
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
       const baseWind =
      Number($("wind").value) +
      Math.round(Math.sin(step * 0.22) * 4) +
      Math.min(20, Math.floor(step / 8) * 2);

    const overLand = isOverLand(current.lat, current.lng);

    if (overLand) {
      // Gradually weaken the storm over land.
      landPenalty = Math.min(55, landPenalty + 8);
    } else {
      // Allow gradual recovery after returning over water.
      landPenalty = Math.max(0, landPenalty - 2);
    }

    currentWind = Math.max(
      25,
      Math.min(160, baseWind - landPenalty)
    );

    maxWind = Math.max(maxWind, currentWind);

    maxWind = Math.max(maxWind, currentWind);

    const point = [current.lat, current.lng];
    trackPoints.push(point);

    if (!storm) {
storm = L.marker(point, {
  icon: makeStormIcon(currentWind)
}).addTo(map);
    } else {
      storm.setLatLng(point);
      storm.setIcon(makeStormIcon(currentWind));
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
