
(() => {
  "use strict";

  const lab = document.getElementById("formation-lab");
  if (!lab || lab.dataset.ready) return;
  lab.dataset.ready = "true";

  const $ = id => lab.querySelector("#" + id);
  const canvas = $("formation-canvas");
  const ctx = canvas.getContext("2d");
  const ocean = $("ocean-temp");
  const moisture = $("air-moisture");
  const shear = $("wind-shear");
  const speed = $("formation-speed");
  const timeline = $("formation-progress");

  const scenes = [
    ["1 · Warm, humid air",
     "Warm ocean water evaporates. Moist air rises and carries water vapor into the atmosphere."],
    ["2 · Growing thunderstorms",
     "Rising air cools and water vapor condenses. Clouds grow as thunderstorms release heat."],
    ["3 · Low pressure",
     "Air flows inward near the ocean to replace rising air. This helps feed the developing system."],
    ["4 · Rotation organizes",
     "Earth's rotation helps organize the circulation. Thunderstorms begin to curve around the center."],
    ["5 · Tropical depression",
     "A closed circulation and organized thunderstorms develop. The storm may strengthen if conditions remain favorable."],
    ["6 · Tropical storm",
     "At sustained winds of 39 mph, the system is classified as a tropical storm."],
    ["7 · Hurricane",
     "At sustained winds of 74 mph, the system qualifies as a hurricane. Its eye, eyewall, and rainbands may become organized."],
    ["8 · Overhead view",
     "Look down from above: spiral rainbands wrap around the eye. The eyewall surrounds the center, where air is descending. The whole storm rotates."],
    ["9 · Landfall",
     "Strong winds bend trees, rain reduces visibility, and lightning flashes around thunderstorms. Coastal flooding and storm surge can be extremely dangerous. The animation is illustrative, not a forecast."],
    ["10 · Inside the eye",
     "The eye can be calmer and clearer than the eyewall, and daylight may become visible. The surrounding storm can still be dangerous, and winds may return quickly."],
    ["11 · After the storm",
     "Flooding, fallen trees, damaged buildings, and power outages can remain after the storm passes. This scene is a fictional illustration of possible impacts."]
  ];

  let stage = 0;
  let playing = false;
  let last = 0;
  let elapsed = 0;
  let animation = 0;
  let width = 600;
  let height = 320;
  let overhead = false;
  let sceneStart = 0;


function resize() {
  const box = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  // Match the drawing coordinates to the actual visible canvas.
  width = Math.max(1, box.width);
  height = Math.max(1, box.height);

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}


  function label(text, x, y, color = "#102b43") {
    ctx.font = "bold 12px system-ui";
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = "rgba(255,255,255,.92)";
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 14, w, 25, 7);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(text, x, y + 3);
    ctx.textAlign = "left";
  }

  function arrow(x1, y1, x2, y2, color, phase) {
    const pulse = Math.sin(phase) * 4;
    const ex = x2 + pulse;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(ex, y2);
    ctx.stroke();

    const a = Math.atan2(y2 - y1, ex - x1);
    ctx.beginPath();
    ctx.moveTo(ex, y2);
    ctx.lineTo(ex - 10 * Math.cos(a - .5), y2 - 10 * Math.sin(a - .5));
    ctx.lineTo(ex - 10 * Math.cos(a + .5), y2 - 10 * Math.sin(a + .5));
    ctx.closePath();
    ctx.fill();
  }


function cloud(x, base, top, w, growth, t) {
  const g = Math.max(0.05, Math.min(1, growth));
  const y = base - (base - top) * g;
  const sway = Math.sin(t * 0.65 + x * 0.015) * 3;
  const puff = 5 + g * 5;

  ctx.save();
  ctx.translate(sway, 0);

  // Soft shadow underneath the growing cloud tower.
  ctx.fillStyle = "rgba(66,100,125,0.13)";
  ctx.beginPath();
  ctx.ellipse(x, base - 5, w * 0.48, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rounded cloud tower, with gently animated edges.
  ctx.beginPath();
  ctx.moveTo(x - w * 0.35, base);
  ctx.bezierCurveTo(
    x - w * 0.53, base - 30 * g,
    x - w * 0.22, y + 35,
    x - w * 0.20, y + 14
  );

  ctx.bezierCurveTo(
    x - w * 0.39, y + 2,
    x - w * 0.29, y - puff,
    x - w * 0.12, y + 3
  );

  ctx.bezierCurveTo(
    x - w * 0.16, y - 16 - puff,
    x - w * 0.02, y - 25 - puff,
    x + w * 0.08, y - 10
  );

  ctx.bezierCurveTo(
    x + w * 0.31, y - 25,
    x + w * 0.35, y + 1,
    x + w * 0.20, y + 15
  );

  ctx.bezierCurveTo(
    x + w * 0.40, base - 45 * g,
    x + w * 0.45, base - 20 * g,
    x + w * 0.35, base
  );

  ctx.closePath();

  const gradient = ctx.createLinearGradient(x, y, x, base);
  gradient.addColorStop(0, "#edf7fc");
  gradient.addColorStop(0.35, "#b9cbd8");
  gradient.addColorStop(1, "#899eaf");
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}


  
function stormSpiral(cx, cy, radius, t, color = "#f6fbff", arms = 7) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t * 0.22);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 0; i < arms; i++) {
    ctx.save();
    ctx.rotate(i * Math.PI * 2 / arms);

    ctx.beginPath();

    // A flowing spiral that curls inward toward the eye.
    for (let j = 0; j <= 100; j++) {
      const u = j / 100;
      const angle = u * Math.PI * 1.65;
      const r = radius * (0.16 + u * 0.82);
      const x = r * Math.cos(angle);
      const y = r * Math.sin(angle);

      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.strokeStyle = "rgba(105,154,185,0.45)";
    ctx.lineWidth = Math.max(7, radius * 0.13);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(4, radius * 0.075);
    ctx.stroke();

    ctx.restore();
  }

  // A clear eye that stays visible while the storm rotates.
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = "#72c8e9";
  ctx.fill();

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.restore();
}


 

  function drawOverhead() {
    const t = elapsed / 1000;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width * .38, height * .38) *
      Math.min(1.2, .48 + Math.max(0, stage - 6) * .12);

    // Ocean.
    ctx.fillStyle = "#07558b";
    ctx.fillRect(0, 0, width, height);

    // Ocean texture.
    ctx.strokeStyle = "rgba(120,210,255,.18)";
    ctx.lineWidth = 1;
    for (let y = 12; y < height; y += 24) {
      ctx.beginPath();
      for (let x = 0; x <= width; x += 8) {
        const yy = y + Math.sin(x * .04 + t + y) * 2;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }

    // Whole storm: rotating cloud bands and a growing eyewall.
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, radius * 1.5);
    glow.addColorStop(0, "rgba(255,255,255,.18)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    stormSpiral(cx, cy, radius, t, "#e8f4fb", 9);

    ctx.beginPath();
    ctx.arc(cx, cy, radius * .32, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(3, radius * .06);
    ctx.stroke();

    // Eye stays clear while the surrounding cloud bands spin.
    ctx.beginPath();
    ctx.arc(cx, cy, radius * .12, 0, Math.PI * 2);
    ctx.fillStyle = "#7cc8e7";
    ctx.fill();

   label("EYE", cx, cy);
label("EYEWALL", cx, cy + radius * 0.32 + 22);
label("SPIRAL RAINBANDS", width * 0.76, height * 0.24);
  }

  function drawLandfall() {
    const t = elapsed / 1000;
    const cx = width * .67;
    const ground = height * .79;

    // Stormy sky.
    const sky = ctx.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, "#263648");
    sky.addColorStop(1, "#73818a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, ground);

    // Rain streaks.
    ctx.strokeStyle = "rgba(205,230,245,.55)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 85; i++) {
      const x = (i * 47 + t * 100) % (width + 30);
      const y = (i * 31 + t * 220) % ground;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 8, y + 18);
      ctx.stroke();
    }

    // Distant animated lightning flashes.
    const flash = Math.sin(t * 5.3) > .965 || Math.sin(t * 8.1) > .985;
    if (flash) {
      ctx.fillStyle = "rgba(255,255,230,.28)";
      ctx.fillRect(0, 0, width, ground);

      ctx.strokeStyle = "#fff6a8";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(width * .76, 20);
      ctx.lineTo(width * .70, height * .25);
      ctx.lineTo(width * .76, height * .25);
      ctx.lineTo(width * .65, height * .48);
      ctx.stroke();
    }

    // Blowing trees.
    ctx.fillStyle = "#4e3c2d";
    for (let i = 0; i < 5; i++) {
      const x = width * (.09 + i * .115);
      const lean = 10 + Math.sin(t * 3 + i) * 14;
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#4e3c2d";
      ctx.beginPath();
      ctx.moveTo(x, ground);
      ctx.lineTo(x + lean, ground - 55);
      ctx.stroke();

      ctx.fillStyle = "#314d43";
      ctx.beginPath();
      ctx.ellipse(x + lean, ground - 65, 20, 28, -.25, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ground and rising flood water.
    ctx.fillStyle = "#35464c";
    ctx.fillRect(0, ground, width, height - ground);
    ctx.fillStyle = "#277eaa";
    ctx.fillRect(0, ground + 12, width, height - ground);
    ctx.strokeStyle = "rgba(220,245,255,.5)";
    for (let i = 0; i < 7; i++) {
      const x = (i * 95 + t * 30) % width;
      ctx.beginPath();
      ctx.moveTo(x, ground + 20 + Math.sin(t + i) * 3);
      ctx.lineTo(x + 35, ground + 20 + Math.sin(t + i) * 3);
      ctx.stroke();
    }

    // Small house, wind-bent roof.
    ctx.fillStyle = "#b7a58c";
    ctx.fillRect(width * .62, ground - 42, 64, 42);
    ctx.fillStyle = "#493b39";
    ctx.beginPath();
    ctx.moveTo(width * .60, ground - 42);
    ctx.lineTo(width * .66, ground - 66 + Math.sin(t * 2) * 3);
    ctx.lineTo(width * .72, ground - 42);
    ctx.closePath();
    ctx.fill();

    label("DAMAGING WINDS", width * .28, 32, "#79202b");
    label("HEAVY RAIN + LIGHTNING", width * .70, 58, "#79202b");
    label("FLOODING RISK", width * .5, height - 12, "#ffffff");
  }

  function drawEye() {
    const t = elapsed / 1000;
    const cx = width / 2;
    const ground = height * .78;

    // Daylight returns, but damage remains.
    const sky = ctx.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, "#70c7f2");
    sky.addColorStop(1, "#d3f0ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, ground);

    // Storm wall surrounding the eye.
    ctx.fillStyle = "#778797";
    ctx.beginPath();
    ctx.ellipse(cx, height * .22, width * .58, height * .27, 0, Math.PI, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#c5d4e1";
    ctx.beginPath();
    ctx.ellipse(cx, height * .24, width * .34, height * .18, 0, Math.PI, Math.PI * 2);
    ctx.fill();

    label("INSIDE THE EYE · DAYLIGHT", cx, 26);
    label("CALMER CENTER", cx, height * .24);

    // Ground, broken trees, damaged home.
    ctx.fillStyle = "#6b735f";
    ctx.fillRect(0, ground, width, height - ground);

    ctx.strokeStyle = "#514034";
    ctx.lineWidth = 6;
    for (let i = 0; i < 5; i++) {
      const x = width * (.1 + i * .17);
      ctx.beginPath();
      ctx.moveTo(x, ground);
      ctx.lineTo(x + 18, ground - 22);
      ctx.lineTo(x + 32, ground - 18);
      ctx.stroke();
    }

    ctx.fillStyle = "#b5a38c";
    ctx.fillRect(cx - 34, ground - 35, 68, 35);
    ctx.fillStyle = "#59433d";
    ctx.beginPath();
    ctx.moveTo(cx - 38, ground - 35);
    ctx.lineTo(cx - 5, ground - 54);
    ctx.lineTo(cx + 4, ground - 46);
    ctx.lineTo(cx + 38, ground - 35);
    ctx.fill();

    ctx.fillStyle = "#397da1";
    ctx.fillRect(0, ground + 14, width, height - ground - 14);
    label("DAMAGE AND FLOODING REMAIN", cx, height - 12, "#ffffff");
  }

  function drawAftermath() {
    const t = elapsed / 1000;
    const ground = height * .68;

    // Overcast clearing sky.
    const sky = ctx.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, "#91a5b1");
    sky.addColorStop(1, "#e0d7c8");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, ground);

    ctx.fillStyle = "#676d61";
    ctx.fillRect(0, ground, width, height - ground);

    // Flooded street.
    ctx.fillStyle = "#347f9c";
    ctx.fillRect(0, ground + 22, width, height - ground - 22);
    ctx.strokeStyle = "rgba(230,250,255,.5)";
    for (let i = 0; i < 8; i++) {
      const x = (i * 71 + t * 18) % width;
      ctx.beginPath();
      ctx.moveTo(x, ground + 34 + Math.sin(t + i) * 2);
      ctx.lineTo(x + 27, ground + 34 + Math.sin(t + i) * 2);
      ctx.stroke();
    }

    // Broken trees and debris.
    ctx.strokeStyle = "#4d4034";
    ctx.lineWidth = 7;
    for (let i = 0; i < 6; i++) {
      const x = width * (.07 + i * .16);
      ctx.beginPath();
      ctx.moveTo(x, ground + 24);
      ctx.lineTo(x + 25, ground - 10);
      ctx.lineTo(x + 46, ground - 5);
      ctx.stroke();
    }

    // Damaged houses and roofs.
    for (let i = 0; i < 3; i++) {
      const x = width * (.12 + i * .29);
      ctx.fillStyle = "#b5a58c";
      ctx.fillRect(x, ground - 52, 68, 52);
      ctx.fillStyle = "#554b49";
      ctx.beginPath();
      ctx.moveTo(x - 8, ground - 52);
      ctx.lineTo(x + 20, ground - 75);
      ctx.lineTo(x + 38, ground - 60);
      ctx.lineTo(x + 76, ground - 52);
      ctx.fill();

      ctx.fillStyle = "#35414a";
      ctx.fillRect(x + 15, ground - 32, 15, 20);
    }

    label("AFTERMATH", width / 2, 25);
    label("DAMAGED BUILDINGS", width * .5, ground - 86);
    label("FLOODING · DEBRIS · POWER OUTAGES", width / 2, height - 12, "#ffffff");
  }

  function drawSideView() {
    const t = elapsed / 1000;
    const p = stage / 6;
    const cx = width / 2;
    const seaY = height * .84;

    const sky = ctx.createLinearGradient(0, 0, 0, seaY);
    sky.addColorStop(0, "#bce8fb");
    sky.addColorStop(1, "#e3f7ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#0861a8";
    ctx.fillRect(0, seaY, width, height - seaY);

    ctx.strokeStyle = "#3f9bd1";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 4) {
      const y = seaY + Math.sin(x * .045 + t * 2) * 4;
      if (!x) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    label("WARM OCEAN", cx, height - 12, "#ffffff");

    for (let i = 0; i < 5; i++) {
      const x = width * (.12 + i * .19);
      arrow(x, seaY - 8, x + Math.sin(t + i) * 7,
        seaY - (stage === 0 ? 25 : 55 + p * 95), "#1698bc", t * 2 + i);
    }

    if (stage <= 1) {
      label("EVAPORATION", cx, seaY - 35);
      label("WARM, HUMID AIR RISES", cx, seaY - 75);
    }

    if (stage >= 1) {
      const top = height * (.43 - p * .25);
      cloud(cx - width * .19, seaY - 5, top, width * .27,
        Math.min(1, .2 + p), t);
      cloud(cx + width * .19, seaY - 5, top, width * .27,
        Math.min(1, .2 + p), t + 2);
      label("RISING AIR COOLS · CLOUDS GROW", cx, height * .34);
    }

    if (stage >= 2) {
      arrow(width * .08, seaY - 16, cx - 18, seaY - 16, "#df273b", t * 2);
      arrow(width * .92, seaY - 16, cx + 18, seaY - 16, "#df273b", t * 2 + 1);
      label("LOW PRESSURE · AIR FLOWS IN", cx, seaY - 40);
    }

    if (stage >= 3) {
      arrow(cx - 22, height * .34, width * .18, height * .20, "#df273b", t * 2);
      arrow(cx + 22, height * .34, width * .82, height * .20, "#df273b", t * 2 + 1);
      label("AIR SPREADS OUT ALOFT", cx, height * .16);

      stormSpiral(cx, height * .57,
        Math.min(width * .2, height * .2) * (.5 + p * .5), t, "#ffffff", 6);
    }

    if (stage >= 4) label("ORGANIZED CIRCULATION", cx, height * .94);
    if (stage >= 5) label("TROPICAL STORM", cx, 28);
    if (stage >= 6) {
      label("HURRICANE", cx, 50);
      label("EYE · EYEWALL · RAINBANDS", cx, height * .72);
    }

    if (Number(shear.value) >= 35 && stage >= 2) {
      arrow(cx - 40, 40, cx + 40, 40, "#bd4a27", t);
      label("WIND SHEAR", cx, 24, "#8e351f");
    }
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    if (stage === 8) {
      drawLandfall();
    } else if (stage === 9) {
      drawEye();
    } else if (stage === 10) {
      drawAftermath();
    } else if (overhead || stage === 7) {
      drawOverhead();
    } else {
      drawSideView();
    }
  }

  function update() {
    $("ocean-value").textContent = ocean.value + "°C";
    $("moisture-value").textContent = moisture.value + "%";
    $("shear-value").textContent = shear.value + "%";

    const temp = Number(ocean.value);
    const wet = Number(moisture.value);
    const sh = Number(shear.value);

    $("formation-conditions").textContent =
      temp >= 27 && wet >= 60 && sh <= 40
        ? "Illustration: favorable conditions"
        : "Illustration: some conditions may limit development";

    $("formation-stage").textContent = scenes[stage][0];
    $("formation-explanation").textContent = scenes[stage][1];
    timeline.value = stage;

    $("formation-view").textContent =
      (overhead || stage === 7) ? "↙ Side view" : "↗ Overhead view";

    draw();
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(animation);
    $("formation-play").textContent = "▶ Play";
  }

  function next() {
    if (stage < scenes.length - 1) {
      stage++;
      sceneStart = elapsed;
    } else {
      pause();
    }
    update();
  }

  function play() {
    if (playing) return;
    playing = true;
    last = 0;
    sceneStart = elapsed;
    $("formation-play").textContent = "Ⅱ Pause";
    animation = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!playing) return;
    if (!last) last = now;

    elapsed += Math.min(100, now - last);
    last = now;

    const interval = 14000 / Number(speed.value);
    if (elapsed - sceneStart >= interval) {
      if (stage < scenes.length - 1) {
        next();
        sceneStart = elapsed;
      } else {
        pause();
        draw();
        return;
      }
    }

    draw();
    animation = requestAnimationFrame(tick);
  }

  $("formation-play").addEventListener("click", () => {
    if (playing) pause();
    else {
      if (stage >= scenes.length - 1) {
        stage = 0;
        elapsed = 0;
      }
      play();
    }
  });

  $("formation-next").addEventListener("click", () => {
    pause();
    next();
  });

  $("formation-view").addEventListener("click", () => {
    overhead = !overhead;
    draw();
    $("formation-view").textContent =
      overhead ? "↙ Side view" : "↗ Overhead view";
  });

  $("formation-reset").addEventListener("click", () => {
    pause();
    stage = 0;
    overhead = false;
    elapsed = 0;
    sceneStart = 0;
    update();
  });

  timeline.addEventListener("input", () => {
    pause();
    stage = Number(timeline.value);
    overhead = stage === 7;
    sceneStart = elapsed;
    update();
  });

  [ocean, moisture, shear].forEach(el =>
    el.addEventListener("input", update)
  );

  speed.addEventListener("change", draw);

  if ("ResizeObserver" in window) {
    new ResizeObserver(resize).observe(canvas);
  } else {
    window.addEventListener("resize", resize);
  }

  update();
  resize();
})();
