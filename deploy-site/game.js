const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

const scoreEl = document.querySelector("#score");
const bestEl = document.querySelector("#best");
const levelEl = document.querySelector("#level");
const overlay = document.querySelector("#overlay");
const overlayTitle = document.querySelector("#overlayTitle");
const overlayText = document.querySelector("#overlayText");
const startButton = document.querySelector("#startButton");
const pauseButton = document.querySelector("#pauseButton");
const restartButton = document.querySelector("#restartButton");
const soundButton = document.querySelector("#soundButton");
const autoPilotInput = document.querySelector("#autoPilot");
const speedButtons = document.querySelectorAll(".speed-option");

const grid = 24;
const tile = canvas.width / grid;
const speedProfiles = {
  slow: 190,
  medium: 140,
  high: 90,
};
const dirs = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  KeyW: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
};

const params = new URLSearchParams(window.location.search);
let best = Number(localStorage.getItem("velvet-snake-best") || 0);
let snake;
let food;
let dir;
let nextDir;
let score;
let level;
let stepMs;
let speed = speedProfiles[localStorage.getItem("velvet-snake-speed")] ? localStorage.getItem("velvet-snake-speed") : "medium";
let lastStep;
let running;
let paused;
let over;
let muted = params.has("muted");
let audio;
let particles = [];
let blooms = [];
let sparkle = 0;
let touchStart = null;

bestEl.textContent = best;
soundButton.textContent = muted ? "Sound Off" : "Sound On";

function reset() {
  snake = [
    { x: 11, y: 12 },
    { x: 10, y: 12 },
    { x: 9, y: 12 },
    { x: 8, y: 12 },
  ];
  dir = { x: 1, y: 0 };
  nextDir = { ...dir };
  score = 0;
  level = 1;
  stepMs = calculateStepMs();
  lastStep = performance.now();
  running = false;
  paused = false;
  over = false;
  particles = [];
  blooms = [];
  food = placeFood();
  updateHud();
  pauseButton.textContent = "Pause";
  showOverlay("Ready to glow?", "Arrow keys or WASD to move. Space pauses. Toggle autopilot to watch the snake seduce the grid by itself.", "Start");
}

function calculateStepMs() {
  const currentLevel = level || 1;
  return Math.max(48, speedProfiles[speed] - (currentLevel - 1) * 7);
}

function setSpeed(value) {
  if (!speedProfiles[value]) return;
  speed = value;
  localStorage.setItem("velvet-snake-speed", speed);
  stepMs = calculateStepMs();
  speedButtons.forEach((button) => {
    const active = button.dataset.speed === speed;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function bootAudio() {
  if (!audio) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audio = new AudioContext();
  }
  if (audio.state === "suspended") audio.resume();
}

function tone(freq, duration = 0.08, type = "sine", gain = 0.045, slide = 0) {
  if (muted || !audio) return;
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const vol = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), now + duration);
  vol.gain.setValueAtTime(0.0001, now);
  vol.gain.exponentialRampToValueAtTime(gain, now + 0.012);
  vol.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(vol);
  vol.connect(audio.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function sfx(name) {
  if (name === "eat") {
    tone(280 + level * 18, 0.08, "triangle", 0.055, 220);
    setTimeout(() => tone(580 + level * 24, 0.09, "sine", 0.038, 120), 42);
  }
  if (name === "crash") {
    tone(110, 0.16, "sawtooth", 0.06, -55);
    setTimeout(() => tone(66, 0.2, "square", 0.035, -18), 80);
  }
  if (name === "click") tone(520, 0.05, "sine", 0.026, 80);
  if (name === "level") {
    tone(420, 0.08, "triangle", 0.045, 150);
    setTimeout(() => tone(760, 0.12, "triangle", 0.04, 190), 70);
  }
}

function updateHud() {
  scoreEl.textContent = score;
  bestEl.textContent = best;
  levelEl.textContent = level;
}

function showOverlay(title, text, buttonText) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  startButton.textContent = buttonText;
  overlay.classList.remove("hidden");
}

function hideOverlay() {
  overlay.classList.add("hidden");
}

function start() {
  bootAudio();
  if (over) reset();
  running = true;
  paused = false;
  over = false;
  lastStep = performance.now();
  pauseButton.textContent = "Pause";
  hideOverlay();
  sfx("click");
}

function pauseToggle() {
  if (!running || over) return;
  paused = !paused;
  pauseButton.textContent = paused ? "Resume" : "Pause";
  if (paused) {
    showOverlay("Holding the pose", "The snake is paused mid-glide. Space or Resume brings the heat back.", "Resume");
  } else {
    lastStep = performance.now();
    hideOverlay();
  }
  sfx("click");
}

function restart() {
  reset();
  start();
}

function sameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

function key(p) {
  return `${p.x},${p.y}`;
}

function inBounds(p) {
  return p.x >= 0 && p.y >= 0 && p.x < grid && p.y < grid;
}

function isOpposite(a, b) {
  return a.x + b.x === 0 && a.y + b.y === 0;
}

function setDirection(candidate) {
  if (!candidate || isOpposite(candidate, dir)) return;
  nextDir = { ...candidate };
}

function placeFood() {
  const occupied = new Set((snake || []).map(key));
  const open = [];
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      if (!occupied.has(`${x},${y}`)) open.push({ x, y });
    }
  }
  return open[Math.floor(Math.random() * open.length)] || { x: 12, y: 12 };
}

function tick(now) {
  if (!running || paused || over) return;
  if (now - lastStep < stepMs) return;
  if (autoPilotInput.checked) setDirection(chooseAutoDirection());
  dir = { ...nextDir };
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
  const eating = sameCell(head, food);
  const bodyToCheck = eating ? snake : snake.slice(0, -1);

  if (!inBounds(head) || bodyToCheck.some((part) => sameCell(part, head))) {
    endGame();
    return;
  }

  snake.unshift(head);
  if (eating) {
    score += 10 + (level - 1) * 2;
    const oldLevel = level;
    level = 1 + Math.floor(score / 70);
    stepMs = calculateStepMs();
    food = placeFood();
    addBurst(head, level >= 4 ? 34 : 24);
    blooms.push({ x: head.x, y: head.y, life: 1 });
    sfx(oldLevel === level ? "eat" : "level");
    if (score > best) {
      best = score;
      localStorage.setItem("velvet-snake-best", String(best));
    }
  } else {
    snake.pop();
  }
  updateHud();
  lastStep = now;
}

function endGame() {
  running = false;
  over = true;
  paused = false;
  pauseButton.textContent = "Pause";
  addBurst(snake[0], 58, true);
  sfx("crash");
  showOverlay("Run ended", `Final score ${score}. The board still smells like ozone and ambition.`, "Play Again");
}

function addBurst(cell, amount, hot = false) {
  const cx = (cell.x + 0.5) * tile;
  const cy = (cell.y + 0.5) * tile;
  for (let i = 0; i < amount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.4 + Math.random() * (hot ? 6 : 4);
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.5 + Math.random() * 0.7,
      size: 2 + Math.random() * 4,
      hue: hot ? 330 + Math.random() * 45 : 155 + Math.random() * 95,
    });
  }
}

function chooseAutoDirection() {
  const path = findPath(snake[0], food, true);
  if (path.length > 1) return toDir(path[0], path[1]);

  const candidates = legalMoves();
  if (!candidates.length) return dir;
  candidates.sort((a, b) => {
    const aa = reachableArea({ x: snake[0].x + a.x, y: snake[0].y + a.y });
    const bb = reachableArea({ x: snake[0].x + b.x, y: snake[0].y + b.y });
    const ad = distance({ x: snake[0].x + a.x, y: snake[0].y + a.y }, food);
    const bd = distance({ x: snake[0].x + b.x, y: snake[0].y + b.y }, food);
    return bb - aa || ad - bd;
  });
  return candidates[0];
}

function legalMoves() {
  return [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ].filter((candidate) => {
    if (isOpposite(candidate, dir)) return false;
    const next = { x: snake[0].x + candidate.x, y: snake[0].y + candidate.y };
    const body = snake.slice(0, -1);
    return inBounds(next) && !body.some((part) => sameCell(part, next));
  });
}

function findPath(start, target, allowTail) {
  const blocked = new Set(snake.map(key));
  if (allowTail) blocked.delete(key(snake[snake.length - 1]));
  blocked.delete(key(start));
  const q = [start];
  const cameFrom = new Map([[key(start), null]]);

  for (let i = 0; i < q.length; i++) {
    const current = q[i];
    if (sameCell(current, target)) break;
    for (const d of Object.values(dirs).slice(0, 4)) {
      const next = { x: current.x + d.x, y: current.y + d.y };
      const nextKey = key(next);
      if (!inBounds(next) || blocked.has(nextKey) || cameFrom.has(nextKey)) continue;
      cameFrom.set(nextKey, current);
      q.push(next);
    }
  }

  const targetKey = key(target);
  if (!cameFrom.has(targetKey)) return [];
  const path = [];
  let current = target;
  while (current) {
    path.unshift(current);
    current = cameFrom.get(key(current));
  }
  return path;
}

function reachableArea(start) {
  if (!inBounds(start)) return 0;
  const blocked = new Set(snake.slice(0, -1).map(key));
  if (blocked.has(key(start))) return 0;
  const q = [start];
  const seen = new Set([key(start)]);
  for (let i = 0; i < q.length; i++) {
    const current = q[i];
    for (const d of Object.values(dirs).slice(0, 4)) {
      const next = { x: current.x + d.x, y: current.y + d.y };
      const nextKey = key(next);
      if (!inBounds(next) || blocked.has(nextKey) || seen.has(nextKey)) continue;
      seen.add(nextKey);
      q.push(next);
    }
  }
  return seen.size;
}

function distance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function toDir(a, b) {
  return { x: b.x - a.x, y: b.y - a.y };
}

function draw(now) {
  requestAnimationFrame(draw);
  const dt = Math.min(0.05, (now - (draw.last || now)) / 1000);
  draw.last = now;
  sparkle += dt;
  tick(now);
  updateParticles(dt);
  paint(now);
}

function updateParticles(dt) {
  particles = particles.filter((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.life -= dt;
    return p.life > 0;
  });
  blooms = blooms.filter((b) => {
    b.life -= dt * 1.8;
    return b.life > 0;
  });
}

function paint(now) {
  const w = canvas.width;
  const h = canvas.height;
  const time = now * 0.001;
  ctx.clearRect(0, 0, w, h);

  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#0c0812");
  bg.addColorStop(0.52, "#171021");
  bg.addColorStop(1, "#081b20");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  drawGrid(time);
  drawFood(time);
  drawBlooms();
  drawSnake(time);
  drawParticles();
  drawVignette();
}

function drawGrid(time) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.055)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= grid; i++) {
    const p = i * tile + 0.5;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(canvas.width, p);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "#ff3d8e";
  ctx.beginPath();
  const y = ((time * 28) % canvas.height) | 0;
  ctx.moveTo(0, y);
  ctx.lineTo(canvas.width, y);
  ctx.stroke();
  ctx.restore();
}

function drawFood(time) {
  const cx = (food.x + 0.5) * tile;
  const cy = (food.y + 0.5) * tile;
  const pulse = 0.84 + Math.sin(time * 6) * 0.16;
  const radius = tile * (0.3 + pulse * 0.08);
  const halo = ctx.createRadialGradient(cx, cy, 2, cx, cy, tile * 1.2);
  halo.addColorStop(0, "rgba(255,122,69,0.66)");
  halo.addColorStop(0.42, "rgba(255,61,142,0.18)");
  halo.addColorStop(1, "rgba(255,61,142,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, tile * 1.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ff784d";
  ctx.shadowColor = "#ff3d8e";
  ctx.shadowBlur = 22;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.beginPath();
  ctx.arc(cx - radius * 0.28, cy - radius * 0.28, radius * 0.22, 0, Math.PI * 2);
  ctx.fill();
}

function drawBlooms() {
  for (const b of blooms) {
    const cx = (b.x + 0.5) * tile;
    const cy = (b.y + 0.5) * tile;
    ctx.strokeStyle = `rgba(40,246,201,${b.life * 0.58})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, tile * (1.7 - b.life), 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawSnake(time) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (let i = snake.length - 1; i >= 0; i--) {
    const part = snake[i];
    const cx = (part.x + 0.5) * tile;
    const cy = (part.y + 0.5) * tile;
    const taper = Math.max(0.42, 1 - i / (snake.length + 6));
    const breath = Math.sin(time * 5 + i * 0.5) * 0.035;
    const r = tile * (0.48 * taper + breath);
    const grad = ctx.createRadialGradient(cx - r * 0.28, cy - r * 0.38, 1, cx, cy, r * 1.5);
    grad.addColorStop(0, i === 0 ? "#fff6fb" : "#fff1a8");
    grad.addColorStop(0.38, i === 0 ? "#28f6c9" : "#ff3d8e");
    grad.addColorStop(1, i === 0 ? "#187f95" : "#4b1f5c");
    ctx.fillStyle = grad;
    ctx.shadowColor = i === 0 ? "#28f6c9" : "#ff3d8e";
    ctx.shadowBlur = i === 0 ? 26 : 14;
    roundedRect(cx - r, cy - r, r * 2, r * 2, Math.max(8, r * 0.56));
    ctx.fill();
  }

  const head = snake[0];
  const hx = (head.x + 0.5) * tile;
  const hy = (head.y + 0.5) * tile;
  const eyeOffsetX = dir.y * tile * 0.18 + dir.x * tile * 0.17;
  const eyeOffsetY = dir.x * tile * -0.18 + dir.y * tile * 0.17;
  drawEye(hx + eyeOffsetX, hy + eyeOffsetY);
  drawEye(hx - eyeOffsetX, hy - eyeOffsetY);
  ctx.restore();
}

function drawEye(x, y) {
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#09070d";
  ctx.beginPath();
  ctx.arc(x, y, tile * 0.075, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(x - 1, y - 1, tile * 0.025, 0, Math.PI * 2);
  ctx.fill();
}

function roundedRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = `hsl(${p.hue} 95% 65%)`;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawVignette() {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const g = ctx.createRadialGradient(cx, cy, canvas.width * 0.18, cx, cy, canvas.width * 0.72);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

document.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    if (!running || over) start();
    else pauseToggle();
    return;
  }
  const candidate = dirs[event.code] || dirs[event.key];
  if (!candidate) return;
  event.preventDefault();
  autoPilotInput.checked = false;
  if (!running) start();
  setDirection(candidate);
});

canvas.addEventListener("pointerdown", (event) => {
  touchStart = { x: event.clientX, y: event.clientY };
});

canvas.addEventListener("pointerup", (event) => {
  if (!touchStart) return;
  const dx = event.clientX - touchStart.x;
  const dy = event.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return;
  autoPilotInput.checked = false;
  setDirection(Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) });
  if (!running) start();
});

startButton.addEventListener("click", start);
pauseButton.addEventListener("click", pauseToggle);
restartButton.addEventListener("click", restart);
soundButton.addEventListener("click", () => {
  bootAudio();
  muted = !muted;
  soundButton.textContent = muted ? "Sound Off" : "Sound On";
  sfx("click");
});
autoPilotInput.addEventListener("change", () => {
  bootAudio();
  if (autoPilotInput.checked && !running) start();
  sfx("click");
});
speedButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setSpeed(button.dataset.speed);
    sfx("click");
  });
});

window.__velvetSnake = {
  start,
  restart,
  setSpeed,
  setAutoPilot(value) {
    autoPilotInput.checked = Boolean(value);
    if (value && !running) start();
  },
  state() {
    return {
      score,
      best,
      level,
      speed,
      stepMs,
      length: snake.length,
      running,
      paused,
      over,
      autopilot: autoPilotInput.checked,
      food,
      head: snake[0],
    };
  },
};

setSpeed(speed);
reset();
if (params.has("autoplay")) {
  autoPilotInput.checked = true;
  setTimeout(start, 200);
}
requestAnimationFrame(draw);
