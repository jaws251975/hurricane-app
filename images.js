
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

  let storm, clouds, islands, houses;
  let score, collected, hits, power, category;
  let running = false;
  let paused = false;
  let animationId = null;
  let lastTime = 0;
  let landCooldown = 0;
  let stormAngle = 0;
  let touchingLand = false;
  let gameOver = false;
  let gameWon = false;

  const categoryNames = [
    'Tropical Depression',
    'Category 1',
    'Category 2',
    'Category 3',
    'Category 4',
    'Category 5'
  ];

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

  function contains(x, y, island) {
    const cos = Math.cos(-island.a);
    const sin = Math.sin(-island.a);
    const dx = x - island.x;
    const dy = y - island.y;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;

    return (rx * rx) / (island.rx * island.rx) +
      (ry * ry) / (island.ry * island.ry) <= 1;
  }

  function onLand(x, y) {
    return islands.some(island => contains(x, y, island));
  }

  function spawnCloud() {
    let cloud;
    let attempts = 0;

    do {
      cloud = {
        x: 30 + Math.random() * (W - 60),
        y: 30 + Math.random() * (H - 60),
        r: 19
      };
      attempts++;
    } while (attempts < 60 && onLand(cloud.x, cloud.y));

    return cloud;
  }

  function makeHouses() {
    const result = [];

    islands.forEach(island => {
      const count = Math.max(2, Math.floor(island.rx / 22));

      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.sqrt(Math.random()) * 0.68;

        result.push({
          x: island.x + Math.cos(angle) * island.rx * distance,
          y: island.y + Math.sin(angle) * island.ry * distance,
          alive: true,
          size: 8 + Math.random() * 3,
          color: ['#f5d06f', '#f18a70', '#a8d8ff'][i % 3]
        });
      }
    });

    return result;
  }

  function getCategory() {
    return Math.min(5, 1 + Math.floor(score / 150));
  }

  function updateHUD() {
    scoreEl.textContent = score;
    cloudEl.textContent = collected;
    hitsEl.textContent = hits;

    let powerEl = document.getElementById('storm-power');

    if (!powerEl) {
      powerEl = document.createElement('div');
      powerEl.id = 'storm-power';
      powerEl.style.cssText =
        'margin:8px 0;font-weight:bold;color:#b9e9f5';

      const hud = scoreEl.parentElement?.parentElement;

      if (hud) hud.appendChild(powerEl);
      else canvas.parentElement.insertBefore(powerEl, canvas);
    }

    powerEl.textContent =
      'Power: ' + Math.ceil(power) + '% | ' + categoryNames[category];

    powerEl.style.color = power < 25 ? '#ff6b6b' : '#b9e9f5';
  }

  function reset() {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    islands = makeIslands();
    clouds = Array.from({ length: 8 }, spawnCloud);
    houses = makeHouses();

    score = 0;
    collected = 0;
    hits = 0;
    power = 100;
    category = 1;

    storm = {
      x: W / 2,
      y: H / 2,
      r: 23,
      speed: 225
    };

    running = false;
    paused = false;
    lastTime = 0;
    landCooldown = 0;
    stormAngle = 0;
    touchingLand = false;
    gameOver = false;
    gameWon = false;
    keys.clear();

    startBtn.textContent = 'Start game';
    pauseBtn.textContent = 'Pause';
    message.textContent =
      'Collect clouds (+10), destroy houses (+25), and avoid land!';

    updateHUD();
    draw();
  }

  function update(dt) {
    let dx = 0;
    let dy = 0;

    if (keys.has('ArrowLeft') || keys.has('a')) dx--;
    if (keys.has('ArrowRight') || keys.has('d')) dx++;
    if (keys.has('ArrowUp') || keys.has('w')) dy--;
    if (keys.has('ArrowDown') || keys.has('s')) dy++;

    const length = Math.hypot(dx, dy) || 1;

    storm.x += dx / length * storm.speed * dt;
    storm.y += dy / length * storm.speed * dt;

    storm.x = Math.max(storm.r, Math.min(W - storm.r, storm.x));
    storm.y = Math.max(storm.r, Math.min(H - storm.r, storm.y));

    stormAngle += dt * (2.5 + category * 0.35);
    landCooldown = Math.max(0, landCooldown - dt);

    const wasLand = touchingLand;
    touchingLand = onLand(storm.x, storm.y);

    if (touchingLand) {
      power -= 18 * dt;

      if (!wasLand && landCooldown <= 0) {
        hits++;
        landCooldown = 1.2;
        message.textContent =
          'Over land! Your hurricane is losing power!';
      }
    } else {
      power = Math.min(100, power + 3 * dt);
    }

    power = Math.max(0, Math.min(100, power));

    // Collect clouds for 10 points.
    for (let i = 0; i < clouds.length; i++) {
      const cloud = clouds[i];

      if (Math.hypot(storm.x - cloud.x, storm.y - cloud.y)
          < storm.r + cloud.r) {
        score += 10;
        collected++;
        clouds[i] = spawnCloud();
        message.textContent = 'Cloud collected! +10 points!';
      }
    }

    // Destroy houses for 25 points each.
    for (const house of houses) {
      if (!house.alive) continue;

      if (Math.hypot(storm.x - house.x, storm.y - house.y)
          < storm.r + house.size) {
        house.alive = false;
        score += 25;
        message.textContent = 'House destroyed! +25 points!';
      }
    }

    // WIN when every house has been destroyed.
    if (houses.length > 0 && houses.every(house => !house.alive)) {
      gameWon = true;
      running = false;
      paused = false;
      startBtn.textContent = 'You won!';
      message.textContent =
        'YOU WIN! Every house has been destroyed! Final score: ' + score;
      updateHUD();
      return;
    }

    // Lose points while over land.
    if (touchingLand && landCooldown <= 0) {
      score = Math.max(0, score - 5);
      landCooldown = 1.2;
    }

    const newCategory = getCategory();

    if (newCategory > category) {
      category = newCategory;
      storm.r = 23 + (category - 1) * 4;
      storm.speed = 225 + (category - 1) * 8;

      message.textContent =
        'UPGRADE! You reached ' + categoryNames[category] +
        '! Your hurricane is bigger and faster!';
    }

    if (power <= 0) {
      power = 0;
      gameOver = true;
      running = false;
      startBtn.textContent = 'Start game';
      message.textContent =
        'Your hurricane lost all its power! Press Restart to try again.';
    }

    updateHUD();
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
      -island.rx * 0.18, -island.ry * 0.08,
      island.rx * 0.48, island.ry * 0.38,
      -0.3, 0, Math.PI * 2
    );
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(
      island.rx * 0.35, island.ry * 0.2,
      island.rx * 0.25, island.ry * 0.22,
      0.4, 0, Math.PI * 2
    );
    ctx.fill();

    ctx.restore();
  }

  function drawHouse(house) {
    if (!house.alive) return;

    const s = house.size;

    ctx.save();
    ctx.translate(house.x, house.y);

    ctx.fillStyle = house.color;
    ctx.strokeStyle = '#253442';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-s * 0.65, -s * 0.2, s * 1.3, s);
    ctx.strokeRect(-s * 0.65, -s * 0.2, s * 1.3, s);

    ctx.fillStyle = '#a94e42';
    ctx.beginPath();
    ctx.moveTo(-s, -s * 0.2);
    ctx.lineTo(0, -s);
    ctx.lineTo(s, -s * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#563c30';
    ctx.fillRect(-s * 0.16, s * 0.25, s * 0.32, s * 0.55);

    ctx.restore();
  }

  function drawStorm() {
    const colors = [
      '#a9d8e8',
      '#f5d84e',
      '#f59e32',
      '#ff7777',
      '#e53935',
      '#8b101c'
    ];

    ctx.save();
    ctx.translate(storm.x, storm.y);
    ctx.rotate(stormAngle);

    ctx.shadowColor = colors[category];
    ctx.shadowBlur = 12 + category * 3;
    ctx.fillStyle = '#092033';
    ctx.strokeStyle = colors[category];
    ctx.lineWidth = 3 + category * 0.4;

    ctx.beginPath();
    ctx.arc(0, 0, storm.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.strokeStyle = i % 2 ? '#55dbea' : '#ffffff';
      ctx.lineWidth = 5 - i * 0.7;
      ctx.arc(
        0, 0,
        storm.r * (0.3 + i * 0.17),
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

    ctx.font = 'bold 13px system-ui';
    ctx.fillStyle = colors[category];
    ctx.fillText(
      'CAT ' + category,
      storm.x,
      storm.y - storm.r - 9
    );
    ctx.restore();
  }

  function draw() {
    const ocean = ctx.createLinearGradient(0, 0, W, H);
    ocean.addColorStop(0, '#0c4260');
    ocean.addColorStop(1, '#071d35');

    ctx.fillStyle = ocean;
    ctx.fillRect(0, 0, W, H);

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
    houses.forEach(drawHouse);
    clouds.forEach(drawCloud);
    drawStorm();

    // Power bar.
    const barW = 180;
    ctx.fillStyle = '#172c3d';
    ctx.fillRect(16, 16, barW, 16);

    ctx.fillStyle = power < 25 ? '#ff5252' :
      power < 55 ? '#ffc857' : '#44d18a';
    ctx.fillRect(16, 16, barW * power / 100, 16);

    ctx.strokeStyle = '#ffffffaa';
    ctx.strokeRect(16, 16, barW, 16);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('POWER ' + Math.ceil(power) + '%', 20, 46);

    ctx.textAlign = 'right';
    ctx.fillText(categoryNames[category], W - 16, 28);
    ctx.fillText(
      'Next upgrade: ' +
      (category < 5 ? (category * 150 - score) + ' pts' : 'MAX'),
      W - 16, 47
    );

    // End screens: victory, game over, pause, or starting screen.
    if (gameWon || !running || paused || gameOver) {
      ctx.fillStyle = '#04111de8';
      ctx.fillRect(0, 0, W, H);

      ctx.textAlign = 'center';
      ctx.fillStyle = gameWon ? '#44ffad' : '#ffffff';
      ctx.font = '800 38px system-ui';

      let heading;
      let sub;

      if (gameWon) {
        heading = 'YOU WIN!';
        sub = 'All houses destroyed!';
      } else if (gameOver) {
        heading = 'HURRICANE DEPLETED';
        sub = 'Final score: ' + score + ' — press Restart';
      } else if (paused) {
        heading = 'PAUSED';
        sub = 'Press Resume to continue';
      } else {
        heading = 'HURRICANE RUN';
        sub = 'Collect clouds. Destroy houses. Avoid land.';
      }

      ctx.fillText(heading, W / 2, H / 2 - 25);

      ctx.font = '18px system-ui';
      ctx.fillStyle = '#b9d6e8';
      ctx.fillText(sub, W / 2, H / 2 + 15);

      if (gameWon) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px system-ui';
        ctx.fillText('Final score: ' + score, W / 2, H / 2 + 53);
        ctx.font = '15px system-ui';
        ctx.fillText('Press Restart to play again', W / 2, H / 2 + 83);
      } else if (!gameOver && !paused) {
        ctx.font = '15px system-ui';
        ctx.fillText(
          'Every 150 points = a stronger category!',
          W / 2, H / 2 + 48
        );
      }
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

    if (running) animationId = requestAnimationFrame(frame);
  }

  function start() {
    if (gameWon) {
      message.textContent = 'You won! Press Restart to play again.';
      return;
    }

    if (gameOver) {
      message.textContent = 'Press Restart to begin a new hurricane.';
      return;
    }

    if (running) {
      if (paused) {
        paused = false;
        lastTime = 0;
        pauseBtn.textContent = 'Pause';
        message.textContent = 'Storm active! Collect clouds and houses.';
      }
      return;
    }

    running = true;
    paused = false;
    lastTime = 0;
    startBtn.textContent = 'Running…';
    pauseBtn.textContent = 'Pause';
    message.textContent =
      'Storm active! Clouds +10, houses +25. Land drains power.';

    animationId = requestAnimationFrame(frame);
  }

  function togglePause() {
    if (!running || gameWon || gameOver) return;

    paused = !paused;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    message.textContent = paused ?
      'Game paused. Press Resume when ready.' :
      'Storm active! Keep collecting points.';
    draw();
  }

  document.addEventListener('keydown', event => {
    const key = event.key.length === 1 ?
      event.key.toLowerCase() : event.key;

    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ']
        .includes(event.key)) {
      event.preventDefault();
    }

    if ([
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'w', 'a', 's', 'd'
    ].includes(key)) {
      keys.add(key);
    }

    if (event.key === ' ' && !running) start();
  });

  document.addEventListener('keyup', event => {
    const key = event.key.length === 1 ?
      event.key.toLowerCase() : event.key;
    keys.delete(key);
  });

  document.querySelectorAll('[data-dir]').forEach(button => {
    const key = {
      up: 'ArrowUp',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight'
    }[button.dataset.dir];

    if (!key) return;

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
