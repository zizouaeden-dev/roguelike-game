const SERVER_URL = 'http://localhost:3001';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

const socket = io(SERVER_URL);

window.myId = null;
window.roomCode = null;
window.isHost = false;

let players = {};
let enemies = [];
let bullets = [];
let camera = { x: 0, y: 0 };
let gameStarted = false;
let moveInput = { x: 0, y: 0 };
let gameStartTime = null;
let myKills = 0;
let isDead = false;

const AVAILABLE_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
let selectedColor = null;
let selectedColorJoin = null;

const keys = {};
window.addEventListener('keydown', (e) => keys[e.key] = true);
window.addEventListener('keyup', (e) => keys[e.key] = false);

const screenGameover = document.getElementById('screen-gameover');
const joystickLeft = document.getElementById('joystick-left');
const knobLeft = document.getElementById('knob-left');
const attackBtn = document.getElementById('attack-btn');
const btnStart = document.getElementById('btn-start');
const roomCodeBig = document.getElementById('room-code-big');
const roomStatus = document.getElementById('room-status');
const playerListEl = document.getElementById('player-list');
const errorMsg = document.getElementById('error-msg');
const errorMsgJoin = document.getElementById('error-msg-join');

// ==================== COLOR PICKER ====================
function buildColorPicker(containerId, disabledColors, onSelect) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  let firstSelectable = null;

  AVAILABLE_COLORS.forEach(color => {
    const dot = document.createElement('div');
    dot.className = 'color-dot';
    dot.style.background = color;
    dot.dataset.color = color;

    if (disabledColors.includes(color)) {
      dot.classList.add('disabled');
    } else {
      if (!firstSelectable) firstSelectable = { dot, color };
      dot.addEventListener('click', () => {
        container.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
        dot.classList.add('selected');
        onSelect(color);
      });
    }
    container.appendChild(dot);
  });

  // Auto-select first available
  if (firstSelectable) {
    firstSelectable.dot.classList.add('selected');
    onSelect(firstSelectable.color);
  }
}

function refreshColorPickers(usedColors) {
  buildColorPicker('color-picker', usedColors, (c) => { selectedColor = c; });
  buildColorPicker('color-picker-join', usedColors, (c) => { selectedColorJoin = c; });
}

refreshColorPickers([]);

// ==================== SCREEN NAVIGATION ====================
function showScreen(id) {
  ['screen-menu','screen-lobby','screen-join','screen-room','screen-gameover'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(id);
  if (target) target.style.display = 'flex';
}

document.getElementById('btn-goto-create').addEventListener('click', () => showScreen('screen-lobby'));
document.getElementById('btn-goto-join').addEventListener('click', () => showScreen('screen-join'));
document.getElementById('btn-back-create').addEventListener('click', () => showScreen('screen-menu'));
document.getElementById('btn-back-join').addEventListener('click', () => showScreen('screen-menu'));

// ==================== CREATE ROOM ====================
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('input-name-create').value.trim();
  if (!name) { errorMsg.textContent = 'Masukkan nama dulu!'; return; }
  if (!selectedColor) { errorMsg.textContent = 'Pilih warna dulu!'; return; }
  errorMsg.textContent = '';
  socket.emit('create_room', { name, color: selectedColor });
});

// ==================== JOIN ROOM ====================
document.getElementById('btn-join').addEventListener('click', () => {
  const name = document.getElementById('input-name-join').value.trim();
  const code = document.getElementById('input-code').value.trim().toUpperCase();
  if (!name) { errorMsgJoin.textContent = 'Masukkan nama dulu!'; return; }
  if (!code) { errorMsgJoin.textContent = 'Masukkan kode room!'; return; }
  if (!selectedColorJoin) { errorMsgJoin.textContent = 'Pilih warna dulu!'; return; }
  errorMsgJoin.textContent = '';
  socket.emit('join_room', { roomCode: code, name, color: selectedColorJoin });
});

// ==================== SOCKET EVENTS ====================
socket.on('room_created', ({ roomCode: code, playerId, players: roomPlayers, availableColors }) => {
  window.myId = playerId;
  window.roomCode = code;
  window.isHost = true;
  players = roomPlayers;
  roomCodeBig.textContent = code;
  roomStatus.textContent = 'Menunggu pemain lain... (min 2, maks 3)';
  updatePlayerList();
  showScreen('screen-room');
  refreshColorPickers(AVAILABLE_COLORS.filter(c => !availableColors.includes(c)));
});

socket.on('join_success', ({ roomCode: code, playerId, players: roomPlayers, availableColors }) => {
  window.myId = playerId;
  window.roomCode = code;
  players = roomPlayers;
  roomCodeBig.textContent = code;
  roomStatus.textContent = 'Menunggu host memulai game...';
  updatePlayerList();
  showScreen('screen-room');
});

socket.on('player_joined', ({ players: roomPlayers, availableColors }) => {
  players = roomPlayers;
  const count = Object.keys(roomPlayers).length;
  roomStatus.textContent = `${count} pemain di room`;
  updatePlayerList();
  if (window.isHost && count >= 2) btnStart.style.display = 'block';
});

socket.on('game_started', ({ players: roomPlayers }) => {
  players = roomPlayers;
  startGame();
});

socket.on('player_left', ({ playerId }) => {
  delete players[playerId];
  updatePlayerList();
});

socket.on('player_moved', ({ playerId, x, y }) => {
  if (players[playerId]) {
    players[playerId].x = x;
    players[playerId].y = y;
  }
});

socket.on('hp_update', ({ playerId, hp }) => {
  if (players[playerId]) players[playerId].hp = hp;
});

socket.on('enemies_update', ({ enemies: serverEnemies }) => {
  enemies = serverEnemies;
});

socket.on('enemy_spawned', ({ enemy }) => {
  if (!enemies.find(e => e.id === enemy.id)) enemies.push(enemy);
});

socket.on('bullet_fired', ({ bullet, shooterId }) => {
  if (shooterId !== window.myId) {
    bullets.push({ ...bullet, life: 80 });
  }
});

socket.on('player_dead', ({ playerId, stats }) => {
  if (playerId === window.myId) {
    isDead = true;
    const duration = Math.floor((Date.now() - gameStartTime) / 1000);
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    document.getElementById('gameover-stats').innerHTML =
      `⏱ Bertahan: ${mins}m ${secs}s<br>💀 Musuh dibunuh: ${myKills}`;
    joystickLeft.style.display = 'none';
    attackBtn.style.display = 'none';
    screenGameover.style.display = 'flex';
  } else {
    if (players[playerId]) players[playerId].dead = true;
  }
});

socket.on('error', ({ message }) => {
  errorMsg.textContent = message;
  errorMsgJoin.textContent = message;
});

// ==================== START BUTTON ====================
btnStart.addEventListener('click', () => {
  if (!window.isHost || !window.roomCode) return;
  socket.emit('start_game', { roomCode: window.roomCode });
});

document.getElementById('btn-exit').addEventListener('click', () => location.reload());

// ==================== PLAYER LIST UI ====================
function updatePlayerList() {
  playerListEl.innerHTML = '';
  for (const pid in players) {
    const p = players[pid];
    const div = document.createElement('div');
    div.className = 'player-entry';
    div.innerHTML = `<div class="player-dot" style="background:${p.color}"></div>
      <span>${p.name || 'Player'}${pid === window.myId ? ' (Kamu)' : ''}</span>`;
    playerListEl.appendChild(div);
  }
}

// ==================== GAME START ====================
function startGame() {
  if (gameStarted) return;
  gameStarted = true;
  gameStartTime = Date.now();
  // Hide all lobby screens
  ['screen-menu','screen-lobby','screen-join','screen-room'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = 'none';
  });
  screenGameover.style.display = 'none';
  joystickLeft.style.display = 'block';
  attackBtn.style.display = 'flex';
  gameLoop();
}

// ==================== JOYSTICK ====================
let joystickActive = false;
let joystickOrigin = { x: 0, y: 0 };

joystickLeft.addEventListener('touchstart', (e) => {
  e.preventDefault();
  joystickActive = true;
  const touch = e.touches[0];
  const rect = joystickLeft.getBoundingClientRect();
  joystickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
});

joystickLeft.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (!joystickActive) return;
  const touch = e.touches[0];
  let dx = touch.clientX - joystickOrigin.x;
  let dy = touch.clientY - joystickOrigin.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxDist = 40;
  if (dist > maxDist) { dx = (dx / dist) * maxDist; dy = (dy / dist) * maxDist; }
  knobLeft.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  moveInput.x = dx / maxDist;
  moveInput.y = dy / maxDist;
});

joystickLeft.addEventListener('touchend', () => {
  joystickActive = false;
  knobLeft.style.transform = 'translate(-50%, -50%)';
  moveInput = { x: 0, y: 0 };
});

// ==================== ATTACK ====================
attackBtn.addEventListener('touchstart', (e) => { e.preventDefault(); shoot(); });
attackBtn.addEventListener('click', () => shoot());
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && gameStarted && !isDead) { e.preventDefault(); shoot(); }
});

function shoot() {
  if (!window.myId || !players[window.myId] || isDead) return;
  const me = players[window.myId];
  const target = getNearestEnemy(me.x, me.y);
  if (!target) return;
  const dx = target.x - me.x;
  const dy = target.y - me.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const bullet = {
    x: me.x, y: me.y,
    vx: (dx / dist) * 8,
    vy: (dy / dist) * 8,
    life: 80,
    ownerId: window.myId
  };
  bullets.push(bullet);
  socket.emit('bullet_fired', { roomCode: window.roomCode, bullet });
}

function getNearestEnemy(x, y) {
  let nearest = null;
  let minDist = Infinity;
  for (const e of enemies) {
    const dx = e.x - x;
    const dy = e.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minDist) { minDist = dist; nearest = e; }
  }
  return nearest;
}

// ==================== GAME LOOP ====================
const SPEED = 3;

function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

function update() {
  if (!window.myId || !players[window.myId] || isDead) return;
  const me = players[window.myId];

  let kx = 0, ky = 0;
  if (keys['w'] || keys['W'] || keys['ArrowUp']) ky = -1;
  if (keys['s'] || keys['S'] || keys['ArrowDown']) ky = 1;
  if (keys['a'] || keys['A'] || keys['ArrowLeft']) kx = -1;
  if (keys['d'] || keys['D'] || keys['ArrowRight']) kx = 1;
  if (kx !== 0 && ky !== 0) { kx *= 0.707; ky *= 0.707; }

  const finalX = kx !== 0 ? kx : moveInput.x;
  const finalY = ky !== 0 ? ky : moveInput.y;

  if (finalX !== 0 || finalY !== 0) {
    me.x += finalX * SPEED;
    me.y += finalY * SPEED;
    socket.emit('player_move', { roomCode: window.roomCode, x: me.x, y: me.y });
  }

  camera.x = me.x - canvas.width / 2;
  camera.y = me.y - canvas.height / 2;

  // Update bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.life--;
    if (b.life <= 0) { bullets.splice(i, 1); continue; }
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      const dx = b.x - e.x;
      const dy = b.y - e.y;
      if (Math.sqrt(dx * dx + dy * dy) < 20) {
        socket.emit('bullet_hit', { roomCode: window.roomCode, enemyId: e.id });
        bullets.splice(i, 1);
        break;
      }
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Grid
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 1;
  const gridSize = 80;
  const startX = -((camera.x % gridSize) + gridSize) % gridSize;
  const startY = -((camera.y % gridSize) + gridSize) % gridSize;
  for (let x = startX; x < canvas.width; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = startY; y < canvas.height; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }

  // Enemies
  for (const e of enemies) {
    const sx = e.x - camera.x;
    const sy = e.y - camera.y;
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath(); ctx.arc(sx, sy, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#333';
    ctx.fillRect(sx - 20, sy - 28, 40, 5);
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(sx - 20, sy - 28, (e.hp / 3) * 40, 5);
  }

  // Bullets
  ctx.fillStyle = '#f1c40f';
  for (const b of bullets) {
    ctx.beginPath(); ctx.arc(b.x - camera.x, b.y - camera.y, 5, 0, Math.PI * 2); ctx.fill();
  }

  // Players
  for (const pid in players) {
    const p = players[pid];
    if (p.dead) continue;
    const sx = p.x - camera.x;
    const sy = p.y - camera.y;
    const isMe = pid === window.myId;

    ctx.fillStyle = p.color || '#3498db';
    ctx.beginPath(); ctx.arc(sx, sy, 20, 0, Math.PI * 2); ctx.fill();

    // HP bar
    ctx.fillStyle = '#333';
    ctx.fillRect(sx - 25, sy - 35, 50, 6);
    ctx.fillStyle = p.hp > 50 ? '#2ecc71' : p.hp > 25 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(sx - 25, sy - 35, (p.hp / 100) * 50, 6);

    // Name
    ctx.fillStyle = 'white';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText((p.name || 'Player') + (isMe ? ' ★' : ''), sx, sy - 40);
  }

  // Kills HUD
  if (gameStarted) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(10, 10, 160, 32);
    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`💀 Kills: ${myKills}`, 20, 31);
  }
}