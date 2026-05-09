const SERVER_URL = 'https://roguelike-game-production.up.railway.app';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

const socket = io(SERVER_URL);

// Game state - semua di window supaya bisa diakses global
window.myId = null;
window.roomCode = null;
window.isHost = false;

let players = {};
let enemies = [];
let bullets = [];
let camera = { x: 0, y: 0 };
let gameStarted = false;
let moveInput = { x: 0, y: 0 };

// Keyboard input
const keys = {};
window.addEventListener('keydown', (e) => keys[e.key] = true);
window.addEventListener('keyup', (e) => keys[e.key] = false);

const lobby = document.getElementById('lobby');
const joystickLeft = document.getElementById('joystick-left');
const knobLeft = document.getElementById('knob-left');
const attackBtn = document.getElementById('attack-btn');
const roomCodeDisplay = document.getElementById('room-code-display');
const lobbyStatus = document.getElementById('lobby-status');
const btnStart = document.getElementById('btn-start');

// ==================== LOBBY ====================
document.getElementById('btn-create').addEventListener('click', () => {
  socket.emit('create_room');
});

document.getElementById('btn-join').addEventListener('click', () => {
  const code = document.getElementById('input-code').value.trim().toUpperCase();
  if (!code) return;
  socket.emit('join_room', { roomCode: code });
});

btnStart.addEventListener('click', () => {
  console.log('Mulai game diklik, isHost:', window.isHost, 'roomCode:', window.roomCode);
  if (!window.isHost || !window.roomCode) return;
  socket.emit('start_game', { roomCode: window.roomCode });
});

socket.on('room_created', ({ roomCode: code, playerId }) => {
  window.myId = playerId;
  window.roomCode = code;
  window.isHost = true;
  roomCodeDisplay.textContent = `Kode Room: ${code}`;
  lobbyStatus.textContent = 'Menunggu pemain lain... (min 2, maks 3 orang)';
  players[window.myId] = { id: window.myId, x: 400, y: 300, hp: 100 };
  console.log('Room created, isHost:', window.isHost, 'roomCode:', window.roomCode);
});

socket.on('player_joined', ({ players: roomPlayers }) => {
  players = roomPlayers;
  const count = Object.keys(roomPlayers).length;
  lobbyStatus.textContent = `${count} pemain di room`;
  if (window.isHost && count >= 2) {
    btnStart.style.display = 'block';
  }
});

socket.on('join_success', ({ roomCode: code, playerId, players: roomPlayers }) => {
  window.myId = playerId;
  window.roomCode = code;
  players = roomPlayers;
  lobbyStatus.textContent = 'Menunggu host memulai game...';
});

socket.on('game_started', ({ players: roomPlayers }) => {
  players = roomPlayers;
  startGame();
});

socket.on('player_left', ({ playerId }) => {
  delete players[playerId];
});

socket.on('player_moved', ({ playerId, x, y }) => {
  if (players[playerId]) {
    players[playerId].x = x;
    players[playerId].y = y;
  }
});

socket.on('error', ({ message }) => {
  lobbyStatus.textContent = message;
});

// ==================== GAME START ====================
function startGame() {
  if (gameStarted) return;
  gameStarted = true;
  lobby.style.display = 'none';
  joystickLeft.style.display = 'block';
  attackBtn.style.display = 'flex';
  spawnEnemyLoop();
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
  joystickOrigin = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
});

joystickLeft.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (!joystickActive) return;
  const touch = e.touches[0];
  let dx = touch.clientX - joystickOrigin.x;
  let dy = touch.clientY - joystickOrigin.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxDist = 40;
  if (dist > maxDist) {
    dx = (dx / dist) * maxDist;
    dy = (dy / dist) * maxDist;
  }
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
attackBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  shoot();
});

attackBtn.addEventListener('click', () => shoot());

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && gameStarted) {
    e.preventDefault();
    shoot();
  }
});

function shoot() {
  if (!window.myId || !players[window.myId]) return;
  const me = players[window.myId];
  const target = getNearestEnemy(me.x, me.y);
  if (!target) return;
  const dx = target.x - me.x;
  const dy = target.y - me.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  bullets.push({
    x: me.x, y: me.y,
    vx: (dx / dist) * 8,
    vy: (dy / dist) * 8,
    life: 80
  });
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

// ==================== ENEMIES ====================
function spawnEnemy() {
  if (!window.myId || !players[window.myId]) return;
  const me = players[window.myId];
  const angle = Math.random() * Math.PI * 2;
  const spawnDist = 600;
  enemies.push({
    id: Date.now() + Math.random(),
    x: me.x + Math.cos(angle) * spawnDist,
    y: me.y + Math.sin(angle) * spawnDist,
    hp: 3, speed: 1.5
  });
}

function spawnEnemyLoop() {
  spawnEnemy();
  setTimeout(spawnEnemyLoop, 2000);
}

// ==================== GAME LOOP ====================
const SPEED = 3;

function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

function update() {
  if (!window.myId || !players[window.myId]) return;
  const me = players[window.myId];

  let kx = 0, ky = 0;
  if (keys['w'] || keys['W'] || keys['ArrowUp']) ky = -1;
  if (keys['s'] || keys['S'] || keys['ArrowDown']) ky = 1;
  if (keys['a'] || keys['A'] || keys['ArrowLeft']) kx = -1;
  if (keys['d'] || keys['D'] || keys['ArrowRight']) kx = 1;

  if (kx !== 0 && ky !== 0) {
    kx *= 0.707;
    ky *= 0.707;
  }

  const finalX = kx !== 0 ? kx : moveInput.x;
  const finalY = ky !== 0 ? ky : moveInput.y;

  if (finalX !== 0 || finalY !== 0) {
    me.x += finalX * SPEED;
    me.y += finalY * SPEED;
    socket.emit('player_move', { roomCode: window.roomCode, x: me.x, y: me.y });
  }

  camera.x = me.x - canvas.width / 2;
  camera.y = me.y - canvas.height / 2;

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
        e.hp--;
        bullets.splice(i, 1);
        if (e.hp <= 0) enemies.splice(j, 1);
        break;
      }
    }
  }

  for (const e of enemies) {
    let nearestPlayer = null;
    let minDist = Infinity;
    for (const pid in players) {
      const p = players[pid];
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) { minDist = dist; nearestPlayer = p; }
    }
    if (nearestPlayer) {
      const dx = nearestPlayer.x - e.x;
      const dy = nearestPlayer.y - e.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      e.x += (dx / dist) * e.speed;
      e.y += (dy / dist) * e.speed;
      if (dist < 25 && nearestPlayer.id === window.myId) {
        nearestPlayer.hp = Math.max(0, nearestPlayer.hp - 0.1);
      }
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

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

  for (const e of enemies) {
    const sx = e.x - camera.x;
    const sy = e.y - camera.y;
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(sx, sy, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#555';
    ctx.fillRect(sx - 20, sy - 28, 40, 5);
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(sx - 20, sy - 28, (e.hp / 3) * 40, 5);
  }

  ctx.fillStyle = '#f1c40f';
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x - camera.x, b.y - camera.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const pid in players) {
    const p = players[pid];
    const sx = p.x - camera.x;
    const sy = p.y - camera.y;
    const isMe = pid === window.myId;
    ctx.fillStyle = isMe ? '#3498db' : '#2ecc71';
    ctx.beginPath();
    ctx.arc(sx, sy, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#555';
    ctx.fillRect(sx - 25, sy - 35, 50, 6);
    ctx.fillStyle = '#2ecc71';
    ctx.fillRect(sx - 25, sy - 35, (p.hp / 100) * 50, 6);
    ctx.fillStyle = 'white';
    ctx.font = '11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(isMe ? 'Kamu' : 'Player', sx, sy - 40);
  }
}