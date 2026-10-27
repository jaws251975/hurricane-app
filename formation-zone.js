 
(() => {
  "use strict";

  const lab = document.getElementById("formation-lab");
  if (!lab) return;

  const canvas = lab.querySelector("#formation-canvas");
  const ctx = canvas.getContext("2d");

  const ocean = lab.querySelector("#ocean-temp");
  const moisture = lab.querySelector("#air-moisture");
  const shear = lab.querySelector("#wind-shear");
  const speed = lab.querySelector("#formation-speed");

  const stageOutput = lab.querySelector("#formation-stage");
  const explanation = lab.querySelector("#formation-explanation");
  const progress = lab.querySelector("#formation-progress");

  const stages = [
    {
      name: "1 · Warm ocean",
      text: "Sunlight warms the ocean. Water evaporates and adds moisture to the air."
    },
    {
      name: "2 · Rising air",
      text: "Warm, moist air rises. Water vapor condenses into clouds and releases heat."
    },
    {
      name: "3 · Low pressure",
      text: "As air rises, surface pressure can fall. More air flows inward to replace it."
    },
    {
      name: "4 · Rotation develops",
      text: "Earth's rotation helps organize the inward-moving air into a rotating system."
    },
    {
      name: "5 · Tropical depression",
      text: "Thunderstorms begin organizing around a circulation. The system may strengthen if conditions remain favorable."
    },
    {
      name: "6 · Tropical storm",
      text: "A more organized circulation develops. At sustained winds of 39 mph, it qualifies as a tropical storm."
    },
    {
      name: "7 · Hurricane",
      text: "At sustained winds of 74 mph, a tropical cyclone qualifies as a hurricane. Strong wind shear or cooler water can prevent this development."
    }
  ];

  let stage = 0;
  let playing = false;
  let elapsed = 0;
  let lastTime = 0;
  let animationId = 0;
  let width = 0;
  let height = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;

    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);

    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }

  function conditions() {
    const warm = Number(ocean.value);
    const wet = Number(moisture.value);
    const strongShear = Number(shear.value);

    // Illustrative score, not a real forecasting equation.
    const score =
      (warm - 24) * 3 +
      wet * 0.45 -
      strongShear * 0.8;

    return { warm, wet, strongShear, score };
  }

  function updateLabels() {
    lab.querySelector("#ocean-value").textContent =
      ocean.value + "°C";
    lab.querySelector("#moisture-value").textContent =
      moisture.value + "%";
    lab.querySelector("#shear-value").textContent =
      shear.value + "%";

    const c = conditions();

    let result = "Conditions are less favorable";
    if (c.score > 48) result = "Very favorable in this illustration";
    else if (c.score > 25) result = "Some favorable conditions";

    lab.querySelector("#formation-conditions").textContent = result;
    stageOutput.textContent = stages[stage].name;
    explanation.textContent = stages[stage].text;
    progress.value = stage;
    progress.max = stages.length - 1;

    draw();
  }

  function draw() {
    if (!ctx || width < 1 || height < 1) return;

    const c = conditions();
    const cx = width / 2;
    const cy = height / 2;
    const base = Math.min(width, height) * 0.31;
    const warmth = Math.max(0, Math.min(1, (c.warm - 20) / 14));
    const organization = stage / (stages.length - 1);
    const rotation = elapsed * 0.0003;

    ctx.clearRect(0, 0, width, height);

    // Ocean background.
    const oceanGradient = ctx.createLinearGradient(0, 0, 0, height);
    oceanGradient.addColorStop(0, "#123c5a");
    oceanGradient.addColorStop(1, "#061b32");
    ctx.fillStyle = oceanGradient;
    ctx.fillRect(0, 0, width, height);

    // Surface waves.
    ctx.strokeStyle = "rgba(116, 203, 231, 0.2)";
    ctx.lineWidth = 1;

    for (let y = 18; y < height; y += 28) {
      ctx.beginPath();
      for (let x = 0; x <= width; x += 5) {
        const waveY = y + Math.sin(x * 0.035 + elapsed * 0.001) * 3;
        if (x === 0) ctx.moveTo(x, waveY);
        else ctx.lineTo(x, waveY);
      }
      ctx.stroke();
    }

    // Warm ocean heat glow.
    const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, base * 2.2);
    glow.addColorStop(0, `rgba(255, 157, 71, ${0.06 + warmth * 0.22})`);
    glow.addColorStop(1, "rgba(255, 157, 71, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    // Rising moist-air columns.
    if (stage >= 1) {
      for (let i = 0; i < 7; i++) {
        const x = cx + Math.cos(i * 0.9) * base * 1.1;
        const drift = Math.sin(elapsed * 0.0015 + i) * 8;

        ctx.strokeStyle = `rgba(155, 230, 255, ${0.18 + c.wet / 400})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, cy + base * 0.65);
        ctx.bezierCurveTo(
          x + drift, cy + base * 0.3,
          x - drift, cy - base * 0.3,
          x + drift * 0.5, cy - base * 0.8
        );
        ctx.stroke();
      }
    }

    // Cloud bands become more organized as the lesson advances.
    if (stage >= 2) {
      const cloudCount = 2 + stage * 2;

      for (let i = 0; i < cloudCount; i++) {
        const angle = i * Math.PI * 2 / cloudCount + rotation;
        const radius = base * (0.45 + (i % 3) * 0.24);

        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * 0.72;

        ctx.fillStyle = "rgba(225, 244, 255, 0.8)";
        ctx.beginPath();
        ctx.ellipse(x, y, 15 + stage, 8 + stage * 0.35, angle, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Stylized spiral hurricane. This is a teaching illustration,
    // not a physical fluid simulation.
    if (stage >= 3) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation * (1 + organization));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const arms = 6;
      const armLength = base * (0.4 + organization * 0.65);

      for (let arm = 0; arm < arms; arm++) {
        const angle = arm * Math.PI * 2 / arms;

        ctx.save();
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(9, 0);
        ctx.bezierCurveTo(
          armLength * 0.2, -armLength * 0.18,
          armLength * 0.9, -armLength * 0.12,
          armLength, -armLength * 0.72
        );

        ctx.strokeStyle = "#f4fbff";
        ctx.lineWidth = Math.max(3, 7 - organization * 2);
        ctx.stroke();
        ctx.restore();
      }

      // The eye.
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(5, base * (0.05 + organization * 0.025)), 0, Math.PI * 2);
      ctx.fillStyle = "#061b32";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();

      ctx.restore();
    }

    // Strong wind shear is represented by a visible sideways arrow.
    if (c.strongShear >= 35) {
      const arrowY = height - 30;
      const arrowLength = Math.min(width * 0.35, 35 + c.strongShear);

      ctx.strokeStyle = "#ffcc66";
      ctx.fillStyle = "#ffcc66";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(18, arrowY);
      ctx.lineTo(18 + arrowLength, arrowY);
      ctx.lineTo(18 + arrowLength - 8, arrowY - 5);
      ctx.moveTo(18 + arrowLength, arrowY);
      ctx.lineTo(18 + arrowLength - 8, arrowY + 5);
      ctx.stroke();

      ctx.font = "11px sans-serif";
      ctx.fillText("WIND SHEAR", 18, arrowY - 10);
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = "12px sans-serif";
    ctx.fillText("ILLUSTRATIVE STORM MODEL", 12, 20);
  }

  function nextStage() {
    if (stage < stages.length - 1) {
      stage++;
      updateLabels();
    } else {
      pause();
      explanation.textContent =
        "Lesson complete! Change the conditions or reset to explore another scenario.";
    }
  }

  function play() {
    if (playing) return;
    playing = true;
    lastTime = 0;

    lab.querySelector("#formation-play").textContent = "Ⅱ Pause";
    animationId = requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(animationId);
    lab.querySelector("#formation-play").textContent = "▶ Play";
  }

  function tick(time) {
    if (!playing) return;

    if (!lastTime) lastTime = time;
    const delta = time - lastTime;
    lastTime = time;
    elapsed += delta;

    const interval = Number(speed.value);

    if (elapsed >= 0 && !tick.lastStep) tick.lastStep = elapsed;

    if (elapsed - (tick.lastStep || 0) >= 4000 / interval) {
      tick.lastStep = elapsed;
      nextStage();
      if (!playing) return;
    }

    draw();
    animationId = requestAnimationFrame(tick);
  }

  lab.querySelector("#formation-play").addEventListener("click", () => {
    if (playing) pause();
    else play();
  });

  lab.querySelector("#formation-next").addEventListener("click", nextStage);

  lab.querySelector("#formation-reset").addEventListener("click", () => {
    pause();
    stage = 0;
    elapsed = 0;
    tick.lastStep = 0;
    updateLabels();
  });

  [ocean, moisture, shear].forEach(input => {
    input.addEventListener("input", updateLabels);
  });

  speed.addEventListener("change", () => {
    draw();
  });

  progress.addEventListener("input", () => {
    pause();
    stage = Number(progress.value);
    updateLabels();
  });

  if ("ResizeObserver" in window) {
    new ResizeObserver(resize).observe(canvas);
  } else {
    window.addEventListener("resize", resize);
  }

  updateLabels();
  resize();
})();
