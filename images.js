
'use strict';

(() => {
  const canvas = document.getElementById('game-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const cloudEl = document.getElementById('cloud-count');
  const hitsEl = document.getElementById('land-hits');
  const message = document.getElementById('game-message');
  const startBtn = document.getElementById('start-button');
  const pauseBtn = document.getElementById('pause-button');
  const restartBtn = document.getElementById('restart-button');

  const W = canvas.width;
  const H = canvas.height;
  const keys = new Set();

  let storm, clouds, islands;
  let score, collected, hits;
  let running = false;
  let paused = false;
  let animationId = null;
  let lastTime = 0;
  let landCooldown = 0;
  let stormAngle = 0;

  function makeIslands() {
    return [
      { x: 95, y: 105, rx: 68, ry: 43, a: -0.35 },
      { x: 260, y: 440, rx: 93, ry: 50, a: 0.2 },
      { x: 460, y: 130, rx: 55, ry: 35, a: 0.5 },
      { x: 670, y: 365, rx: 105, ry: 61, a: -0.3 },
      { x: 790, y: 120, rx: 48, ry: 72, a: 0.1 },
      { x: 470, y: 510, rx: 43, ry: 25, a: -0.2 }
    ];
  }

  function spawnCloud() {
    let cloud;
    let attempts = 0;

    do {
      cloud = {
        x: 35 + Math.random() * (W - 70),
        y: 35 + Math.random() * (H - 70),
        r: 19
      };
      attempts++;
    } while (
      attempts < 50 &&
      islands.some(island => contains(cloud.x, cloud.y, island))
    );

    return cloud;
  }

  function reset() {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    storm = { x: W / 2, y: H / 2, r: 23, speed: 225 };
    islands = makeIslands();
    clouds = Array.from({ length: 8 }, spawnCloud);

    score = 0;
    collected = 0;
    hits = 0;
    running = false;
    paused = false;
    lastTime = 0;
    landCooldown = 0;
    stormAngle = 0;
    keys.clear();

    updateHUD();
    startBtn.textContent = 'Start game';
    pauseBtn.textContent = 'Pause';
    message.textContent =
      'Ready! Collect clouds (+10) and avoid land (−5).';
    draw();
  }

  function updateHUD() {
    scoreEl.textContent = score;
    cloudEl.textContent = collected;
    hitsEl.textContent = hits;
  }

  function contains(x, y, island) {
    const cos = Math.cos(-island.a);
    const sin = Math.sin(-island.a);
    const dx = x - island.x;
    const dy = y - island.y;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;

    return (
      (rx * rx) / (island.rx * island.rx) +
      (ry * ry) / (island.ry * island.ry)
    ) <= 1;
  }

  function update(dt) {
    let dx = 0;
    let dy = 0;

    if (keys.has('ArrowLeft') || keys.has('a')) dx--;
    if (keys.has('ArrowRight') || keys.has('d')) dx++;
    if (keys.has('ArrowUp') || keys.has('w')) dy--;
    if (keys.has('ArrowDown') || keys.has('s')) dy++;

    const length = Math.hypot(dx, dy) || 1;

    storm.x += (dx / length) * storm.speed * dt;
    storm.y += (dy / length) * storm.speed * dt;

    storm.x = Math.max(
      storm.r,
      Math.min(W - storm.r, storm.x)
    );
    storm.y = Math.max(
      storm.r,
      Math.min(H - storm.r, storm.y)
    );

    stormAngle += dt * 2.5;
    landCooldown = Math.max(0, landCooldown - dt);

    // Collect clouds.
    for (let i = 0; i < clouds.length; i++) {
      const cloud = clouds[i];

      if (
        Math.hypot(storm.x - cloud.x, storm.y - cloud.y) <
        storm.r + cloud.r
      ) {
        score += 10;
        collected++;
        clouds[i] = spawnCloud();
        updateHUD();
        message.textContent = 'Cloud collected! +10 points!';
      }
    }

    // Land costs points, with a short cooldown to prevent rapid penalties.
    const touchingLand = islands.some(island =>
      contains(storm.x, storm.y, island)
    );

    if (touchingLand && landCooldown <= 0) {
      score = Math.max(0, score - 5);
      hits++;
      landCooldown = 1.2;
      updateHUD();
      message.textContent = 'Land hit! −5 points. Get back over water!';
    }
  }

  function drawCloud(cloud) {
    ctx.save();
    ctx.translate(cloud.x, cloud.y);

    ctx.fillStyle = '#f3fbff';
    ctx.strokeStyle = '#b9e9f5';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(-cloud.r * 0.42, 2, cloud.r * 0.45, 0, Math.PI * 2);
    ctx.arc(0, -cloud.r * 0.2, cloud.r * 0.58, 0, Math.PI * 2);
    ctx.arc(cloud.r * 0.45, 3, cloud.r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  function drawIsland(island) {
    ctx.save();
    ctx.translate(island.x, island.y);
    ctx.rotate(island.a);

    ctx.fillStyle = '#b3a36d';
    ctx.strokeStyle = '#e2d5a0';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.ellipse(0, 0, island.rx, island.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#4b986a';

    ctx.beginPath();
    ctx.ellipse(
      -island.rx * 0.18,
      -island.ry * 0.08,
      island.rx * 0.48,
      island.ry * 0.38,
      -0.3,
      0,
      Math.PI * 2
    );
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(
      island.rx * 0.35,
      island.ry * 0.2,
      island.rx * 0.25,
      island.ry * 0.22,
      0.4,
      0,
      Math.PI * 2
    );
    ctx.fill();

    ctx.restore();
  }

  function drawStorm() {
    ctx.save();
    ctx.translate(storm.x, storm.y);
    ctx.rotate(stormAngle);

    ctx.shadowColor = '#55dbea';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#092033';
    ctx.strokeStyle = '#f4fdff';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.arc(0, 0, storm.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;

    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.strokeStyle = i % 2 ? '#55dbea' : '#ffffff';
      ctx.lineWidth = 5 - i;
      ctx.arc(
        0,
        0,
        storm.r * (0.35 + i * 0.2),
        i * 1.7,
        i * 1.7 + Math.PI * 1.35
      );
      ctx.stroke();
    }

    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('YOU', storm.x, storm.y);
    ctx.restore();
  }

  function draw() {
    const ocean = ctx.createLinearGradient(0, 0, W, H);
    ocean.addColorStop(0, '#0c4260');
    ocean.addColorStop(1, '#071d35');

    ctx.fillStyle = ocean;
    ctx.fillRect(0, 0, W, H);

    // Ocean grid.
    ctx.strokeStyle = '#ffffff0d';
    ctx.lineWidth = 1;

    for (let x = 0; x < W; x += 45) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    for (let y = 0; y < H; y += 45) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    islands.forEach(drawIsland);
    clouds.forEach(drawCloud);
    drawStorm();

    if (!running || paused) {
      ctx.fillStyle = '#04111dd9';
      ctx.fillRect(0, 0, W, H);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 38px system-ui';
      ctx.fillText(
        paused ? 'PAUSED' : 'HURRICANE RUN',
        W / 2,
        H / 2 - 12
      );

      ctx.font = '18px system-ui';
      ctx.fillStyle = '#b9d6e8';
      ctx.fillText(
        paused ? 'Press Resume to continue' : 'Collect clouds. Avoid land.',
        W / 2,
        H / 2 + 27
      );
    }
  }

  function frame(time) {
    animationId = null;
    if (!running) return;

    if (!lastTime) lastTime = time;
    const dt = Math.min((time - lastTime) / 1000, 0.04);
    lastTime = time;

    if (!paused) update(dt);
    draw();

    animationId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) {
      if (paused) {
        paused = false;
        lastTime = 0;
        pauseBtn.textContent = 'Pause';
        message.textContent = 'Storm active! Collect clouds and avoid land.';
      }
      return;
    }

    running = true;
    paused = false;
    lastTime = 0;
    startBtn.textContent = 'Running…';
    pauseBtn.textContent = 'Pause';
    message.textContent = 'Storm active! Clouds +10. Land hits −5.';

    animationId = requestAnimationFrame(frame);
  }

  function togglePause() {
    if (!running) return;

    paused = !paused;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    message.textContent = paused
      ? 'Game paused. Press Resume when you are ready.'
      : 'Storm active! Collect clouds and avoid land.';
    draw();
  }

  // Keyboard controls.
  document.addEventListener('keydown', event => {
    const key = event.key.length === 1
      ? event.key.toLowerCase()
      : event.key;

    if (
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ']
        .includes(event.key)
    ) {
      event.preventDefault();
    }

    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'w', 'a', 's', 'd'].includes(key)) {
      keys.add(key);
    }

    if (event.key === ' ' && !running) start();
  });

  document.addEventListener('keyup', event => {
    const key = event.key.length === 1
      ? event.key.toLowerCase()
      : event.key;
    keys.delete(key);
  });

  // Mobile touch controls.
  document.querySelectorAll('[data-dir]').forEach(button => {
    const key = {
      up: 'ArrowUp',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight'
    }[button.dataset.dir];

    const press = event => {
      event.preventDefault();
      keys.add(key);
    };

    const release = event => {
      event.preventDefault();
      keys.delete(key);
    };

    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointerleave', release);
    button.addEventListener('pointercancel', release);
  });

  startBtn.addEventListener('click', start);
  pauseBtn.addEventListener('click', togglePause);
  restartBtn.addEventListener('click', reset);

  reset();
})();
