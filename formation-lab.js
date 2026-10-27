
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

  const stages = [
    ["1 · Warm, humid air",
     "The warm ocean evaporates. Warm, moist air rises, carrying water vapor into the atmosphere."],
    ["2 · Rising air and clouds",
     "As moist air rises, it cools. Water vapor condenses into cloud droplets, and thunderstorms begin to develop."],
    ["3 · A low-pressure center",
     "Rising air helps lower surface pressure. More air flows inward near the ocean, feeding the developing storm."],
    ["4 · Rotation organizes",
     "Earth's rotation helps organize the circulation. Thunderstorms begin wrapping around the center."],
    ["5 · Tropical depression",
     "A closed circulation and organized thunderstorms develop. Warm water and low wind shear can help the system strengthen."],
    ["6 · Tropical storm",
     "The circulation becomes better organized. At sustained winds of 39 mph, the system is classified as a tropical storm."],
    ["7 · Hurricane",
     "At sustained winds of 74 mph, it qualifies as a hurricane. The eye, eyewall, and spiral rainbands can become more defined."]
  ];

  let stage = 0;
  let playing = false;
  let last = 0;
  let elapsed = 0;
  let animation = 0;
  let width = 600;
  let height = 390;

  function resize() {
    const box = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    width = Math.max(300, box.width);
    height = Math.max(300, box.height || 320);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function roundedLabel(text, x, y, color = "#102b43") {
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

  function arrow(x1, y1, x2, y2, color, phase, label) {
    const pulse = Math.sin(phase) * 5;
    const ex = x2 + pulse;
    const ey = y2;

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    const a = Math.atan2(ey - y1, ex - x1);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 10 * Math.cos(a - 0.5), ey - 10 * Math.sin(a - 0.5));
    ctx.lineTo(ex - 10 * Math.cos(a + 0.5), ey - 10 * Math.sin(a + 0.5));
    ctx.closePath();
    ctx.fill();

    if (label) {
      ctx.font = "11px system-ui";
      ctx.fillStyle = color;
      ctx.fillText(label, x1 + 5, (y1 + y2) / 2);
    }
  }

  function cloudTower(x, baseY, topY, cloudWidth, growth, phase) {
    const top = baseY - (baseY - topY) * growth;
    const sway = Math.sin(phase + x * 0.03) * 3;

    ctx.fillStyle = "#9da8b5";
    ctx.strokeStyle = "#8796a5";
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(x - cloudWidth * 0.35, baseY);

    ctx.bezierCurveTo(
      x - cloudWidth * 0.55, baseY - 35 * growth,
      x - cloudWidth * 0.22, top + 35,
      x - cloudWidth * 0.12 + sway, top + 15
    );

    ctx.bezierCurveTo(
      x - cloudWidth * 0.42, top - 8,
      x - cloudWidth * 0.2, top - 18,
      x, top - 8
    );

    ctx.bezierCurveTo(
      x + cloudWidth * 0.22, top - 22,
      x + cloudWidth * 0.3, top + 4,
      x + cloudWidth * 0.13, top + 19
    );

    ctx.bezierCurveTo(
      x + cloudWidth * 0.28, baseY - 35 * growth,
      x + cloudWidth * 0.45, baseY - 18 * growth,
      x + cloudWidth * 0.35, baseY
    );

    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function draw() {
    if (!ctx) return;

    const t = elapsed / 1000;
    const progress = stage / 6;
    const temp = Number(ocean.value);
    const wet = Number(moisture.value);
    const windShear = Number(shear.value);

    const cx = width / 2;
    const seaY = height * 0.84;
    const skyTop = 30;
    const warmFactor = Math.max(0, Math.min(1, (temp - 20) / 12));
    const moistureFactor = wet / 100;
    const cloudGrowth = Math.min(1, 0.12 + progress * 1.2) *
      (0.55 + moistureFactor * 0.45);

    ctx.clearRect(0, 0, width, height);

    // Sky and ocean, like a scientific atmosphere cross-section.
    const sky = ctx.createLinearGradient(0, 0, 0, seaY);
    sky.addColorStop(0, "#bce8fb");
    sky.addColorStop(1, "#e3f7ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#0861a8";
    ctx.fillRect(0, seaY, width, height - seaY);

    // Moving ocean waves.
    ctx.strokeStyle = "#3f9bd1";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 4) {
      const y = seaY + Math.sin(x * 0.045 + t * 2) * 4;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    roundedLabel("WARM OCEAN", cx, height - 12, "#ffffff");

    // Evaporation and surface inflow.
    for (let i = 0; i < 5; i++) {
      const x = width * (0.12 + i * 0.19);
      const rise = stage === 0 ? 25 : 50 + progress * 100;
      arrow(
        x, seaY - 8,
        x + Math.sin(t * 1.5 + i) * 7, seaY - rise,
        "#1698bc", t * 2 + i, ""
      );
    }

    if (stage <= 1) {
      roundedLabel("EVAPORATION", cx, seaY - 35);
      roundedLabel("WARM, HUMID AIR RISES", cx, seaY - 75);
    }

    // Thunderstorm towers grow taller through the lesson.
    if (stage >= 1) {
      const towerBase = seaY - 5;
      const towerTop = height * (0.43 - progress * 0.25);
      const separation = width * (0.13 + progress * 0.08);

      cloudTower(cx - separation, towerBase, towerTop, width * 0.23,
        cloudGrowth, t);
      cloudTower(cx + separation, towerBase, towerTop, width * 0.23,
        cloudGrowth, t + 2);

      if (stage >= 2) {
        roundedLabel("RISING AIR COOLS", cx, height * 0.40);
        roundedLabel("CONDENSATION RELEASES HEAT", cx, height * 0.47);
      }
    }

    // Inflow at the surface and outward flow high in the atmosphere.
    if (stage >= 2) {
      arrow(width * 0.08, seaY - 16, cx - 18, seaY - 16,
        "#df273b", t * 2, "");
      arrow(width * 0.92, seaY - 16, cx + 18, seaY - 16,
        "#df273b", t * 2 + 1, "");
      roundedLabel("LOW PRESSURE · AIR FLOWS IN", cx, seaY - 40);

      if (stage >= 3) {
        arrow(cx - 22, height * 0.34, width * 0.18, height * 0.20,
          "#df273b", t * 2, "");
        arrow(cx + 22, height * 0.34, width * 0.82, height * 0.20,
          "#df273b", t * 2 + 1, "");
        roundedLabel("AIR SPREADS OUT ALOFT", cx, height * 0.16);
      }
    }

    // Developing rotating bands.
    if (stage >= 3) {
      ctx.save();
      ctx.translate(cx, height * 0.53);
      ctx.rotate(t * (windShear > 60 ? 0.12 : 0.32));

      const radius = Math.min(width * 0.26, height * 0.24) *
        (0.35 + progress * 0.85);

      for (let arm = 0; arm < 5; arm++) {
        ctx.save();
        ctx.rotate(arm * Math.PI * 2 / 5);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(0, 0, radius, -0.25, Math.PI * 0.72);
        ctx.stroke();
        ctx.restore();
      }

      ctx.fillStyle = "#143b61";
      ctx.beginPath();
      ctx.arc(0, 0, 8 + progress * 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 11 + progress * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      if (stage >= 4) {
        roundedLabel("CENTER OF CIRCULATION", cx, height * 0.53 + 32);
      }

      if (stage >= 5) {
        roundedLabel("SPIRAL RAINBANDS", cx + radius * 0.55,
          height * 0.53 - radius * 0.45);
      }

      if (stage >= 6) {
        roundedLabel("EYE", cx, height * 0.53 - 3);
        roundedLabel("EYEWALL · STRONGEST WINDS", cx, height * 0.53 + radius + 25);
      }
    }

    // Wind shear illustration: strong shear tilts cloud tops away from the center.
    if (stage >= 2 && windShear >= 35) {
      const offset = windShear * 0.45;
      arrow(cx - offset, 45, cx + offset, 45, "#bd4a27", t, "");
      roundedLabel("WIND SHEAR TILTS THE STORM", cx, 28, "#8e351f");
    }

    // Footer legend.
    ctx.fillStyle = "#12334d";
    ctx.font = "11px system-ui";
    ctx.fillText("BLUE: moist air  ·  RED: airflow  ·  WHITE: cloud bands", 10, 16);
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

    $("formation-stage").textContent = stages[stage][0];
    $("formation-explanation").textContent = stages[stage][1];
    timeline.value = stage;
    draw();
  }

  function next() {
    if (stage < 6) stage++;
    else pause();
    update();
  }

  function tick(now) {
    if (!playing) return;
    if (!last) last = now;

    const delta = Math.min(100, now - last);
    last = now;
    elapsed += delta;

    const interval = 4200 / Number(speed.value);
    if (elapsed >= (stage + 1) * interval) next();

    draw();
    animation = requestAnimationFrame(tick);
  }

  function play() {
    if (playing) return;
    playing = true;
    last = 0;
    $("formation-play").textContent = "Ⅱ Pause";
    animation = requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(animation);
    $("formation-play").textContent = "▶ Play";
  }

  $("formation-play").addEventListener("click", () => {
    if (playing) pause();
    else {
      if (stage >= 6) stage = 0;
      play();
    }
  });

  $("formation-next").addEventListener("click", () => {
    pause();
    next();
  });

  $("formation-reset").addEventListener("click", () => {
    pause();
    stage = 0;
    elapsed = 0;
    update();
  });

  timeline.addEventListener("input", () => {
    pause();
    stage = Number(timeline.value);
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
