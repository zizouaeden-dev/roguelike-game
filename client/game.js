const SERVER_URL = 'https://roguelike-game-production.up.railway.app';

// Firebase setup
const firebaseConfig = {
  apiKey: "AIzaSyC4FaA3fCPhNhdmHDUzjCeCUQyxp9umAng",
  authDomain: "roguelike-game-583fd.firebaseapp.com",
  databaseURL: "https://roguelike-game-583fd-default-rtdb.firebaseio.com",
  projectId: "roguelike-game-583fd",
  storageBucket: "roguelike-game-583fd.firebasestorage.app",
  messagingSenderId: "193448038177",
  appId: "1:193448038117:web:f7d37ce1e9f0067c75b860"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ==================== AUDIO ====================
const sounds = {
  shoot: new Audio('sounds/shoot.wav'),
  enemyDeath: new Audio('sounds/enemy_death.wav'),
  waveStart: new Audio('sounds/wave_start.wav'),
  powerUp: new Audio('sounds/power_up.wav'),
  playerHurt: new Audio('sounds/player_hurt.wav'),
  menuBgm: new Audio('sounds/menu_bgm.mp3'),
  mainBgm: new Audio('sounds/main_bgm.mp3'),
};
sounds.shoot.volume = 0.4;
sounds.enemyDeath.volume = 0.6;
sounds.waveStart.volume = 0.8;
sounds.powerUp.volume = 0.7;
sounds.playerHurt.volume = 0.8;
sounds.menuBgm.volume = 0.3;
sounds.mainBgm.volume = 0.3;
sounds.menuBgm.loop = true;
sounds.mainBgm.loop = true;

let bgmStarted = false;
function playSound(name) {
  const s = sounds[name];
  if (!s) return;
  s.currentTime = 0;
  s.play().catch(() => {});
}
function playBgm(name) {
  Object.values(sounds).forEach(s => { if (s.loop) { s.pause(); s.currentTime = 0; } });
  sounds[name].play().catch(() => {});
}
function tryStartMenuBgm() {
  if (bgmStarted) return;
  bgmStarted = true;
  playBgm('menuBgm');
}
document.addEventListener('click', tryStartMenuBgm, { once: true });
document.addEventListener('touchstart', tryStartMenuBgm, { once: true });
document.addEventListener('keydown', tryStartMenuBgm, { once: true });

// ==================== CANVAS ====================
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
let gameStarted = false;
let moveInput = { x: 0, y: 0 };
let gameStartTime = null;
let myKills = 0;
let isDead = false;
let currentWave = 1;
let waveAnnouncement = null;
let myUpgrades = { damage: 1, fireRate: 333, shotCount: 1 };
let cardTimerInterval = null;

// ==================== VISUAL EFFECTS STATE ====================
// Camera (smooth follow)
let camera = { x: 0, y: 0, targetX: 0, targetY: 0 };

// Screen shake
let shakeAmount = 0;
let shakeX = 0;
let shakeY = 0;

// Particles
let particles = [];

// Damage numbers
let damageNumbers = [];

// Hit flashes (enemy flash white)
let hitFlashes = {}; // enemyId -> timer

function triggerShake(amount) {
  shakeAmount = Math.max(shakeAmount, amount);
}

function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 3;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 30 + Math.random() * 20,
      maxLife: 50,
      color,
      size: 2 + Math.random() * 3
    });
  }
}

function spawnDamageNumber(x, y, damage) {
  damageNumbers.push({
    x, y,
    vy: -1.5,
    life: 50,
    maxLife: 50,
    text: Math.ceil(damage).toString(),
    color: damage >= 5 ? '#f39c12' : '#fff'
  });
}

const AVAILABLE_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
let selectedColor = null;
let selectedColorJoin = null;

const keys = {};
window.addEventListener('keydown', (e) => keys[e.key] = true);
window.addEventListener('keyup', (e) => keys[e.key] = false);

const screenGameover = document.getElementById('screen-gameover');
const cardScreen = document.getElementById('card-screen');
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
  ['screen-menu','screen-lobby','screen-join','screen-room','screen-gameover','screen-leaderboard'].forEach(s => {
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
document.getElementById('btn-goto-leaderboard').addEventListener('click', () => { loadLeaderboard(); showScreen('screen-leaderboard'); });
document.getElementById('btn-back-leaderboard').addEventListener('click', () => showScreen('screen-menu'));

// ==================== CREATE / JOIN ====================
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('input-name-create').value.trim();
  if (!name) { errorMsg.textContent = 'Masukkan nama dulu!'; return; }
  if (!selectedColor) { errorMsg.textContent = 'Pilih warna dulu!'; return; }
  errorMsg.textContent = '';
  socket.emit('create_room', { name, color: selectedColor });
});
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
  window.myId = playerId; window.roomCode = code; window.isHost = true;
  players = roomPlayers; roomCodeBig.textContent = code;
  roomStatus.textContent = 'Menunggu pemain lain... (min 2, maks 3)';
  updatePlayerList(); showScreen('screen-room');
  refreshColorPickers(AVAILABLE_COLORS.filter(c => !availableColors.includes(c)));
});
socket.on('join_success', ({ roomCode: code, playerId, players: roomPlayers }) => {
  window.myId = playerId; window.roomCode = code;
  players = roomPlayers; roomCodeBig.textContent = code;
  roomStatus.textContent = 'Menunggu host memulai game...';
  updatePlayerList(); showScreen('screen-room');
});
socket.on('player_joined', ({ players: roomPlayers, availableColors }) => {
  players = roomPlayers;
  const count = Object.keys(roomPlayers).length;
  roomStatus.textContent = `${count} pemain di room`;
  updatePlayerList();
  if (window.isHost && count >= 2) btnStart.style.display = 'block';
});
socket.on('game_started', ({ players: roomPlayers }) => { players = roomPlayers; startGame(); });
socket.on('player_left', ({ playerId }) => { delete players[playerId]; updatePlayerList(); });
socket.on('player_moved', ({ playerId, x, y }) => { if (players[playerId]) { players[playerId].x = x; players[playerId].y = y; } });

socket.on('hp_update', ({ playerId, hp }) => {
  if (players[playerId]) {
    if (playerId === window.myId && hp < players[playerId].hp) {
      playSound('playerHurt');
      triggerShake(6);
    }
    players[playerId].hp = hp;
  }
});

socket.on('enemies_update', ({ enemies: serverEnemies }) => { enemies = serverEnemies; });
socket.on('enemy_spawned', ({ enemy }) => { if (!enemies.find(e => e.id === enemy.id)) enemies.push(enemy); });

socket.on('enemy_hp_update', ({ enemyId, hp }) => {
  const e = enemies.find(e => e.id === enemyId);
  if (e) {
    const dmgTaken = e.hp - hp;
    // spawn damage number di posisi musuh (world coords)
    spawnDamageNumber(e.x, e.y - 20, dmgTaken);
    // hit flash
    hitFlashes[enemyId] = 8;
    e.hp = hp;
  }
});

socket.on('enemy_killed', ({ enemyId, killerId }) => {
  const idx = enemies.findIndex(e => e.id === enemyId);
  if (idx !== -1) {
    const e = enemies[idx];
    // particle burst saat mati
    spawnParticles(e.x, e.y, e.isBoss ? '#f39c12' : '#e74c3c', e.isBoss ? 30 : 12);
    triggerShake(e.isBoss ? 12 : 4);
    enemies.splice(idx, 1);
  }
  if (killerId === window.myId) myKills++;
  playSound('enemyDeath');
});

socket.on('wave_start', ({ wave, enemyCount, isBossWave }) => {
  currentWave = wave;
  waveAnnouncement = { text: isBossWave ? `⚠️ WAVE ${wave} — BOSS!` : `WAVE ${wave}`, timer: 180 };
  playSound('waveStart');
});
socket.on('wave_complete', ({ wave }) => { waveAnnouncement = { text: `WAVE ${wave} SELESAI!`, timer: 120 }; });

// ==================== CARD UPGRADE ====================
const CARD_INFO = {
  damage: { icon: '⚔️', title: 'Damage Up', desc: 'Damage peluru x1.5' },
  fire_rate: { icon: '🔥', title: 'Fire Rate Up', desc: 'Tembak 1.5x lebih cepat' },
  double_shot: { icon: '🎯', title: 'Multi Shot', desc: '+1 peluru, damage -20%' }
};
socket.on('show_cards', ({ cards, timeLeft }) => {
  const container = document.getElementById('card-container');
  const timerEl = document.getElementById('card-timer');
  container.innerHTML = '';
  cards.forEach(cardType => {
    const info = CARD_INFO[cardType];
    const card = document.createElement('div');
    card.className = 'upgrade-card';
    card.innerHTML = `<div class="card-icon">${info.icon}</div><div class="card-title">${info.title}</div><div class="card-desc">${info.desc}</div>`;
    card.addEventListener('click', () => selectCard(cardType));
    card.addEventListener('touchstart', (e) => { e.preventDefault(); selectCard(cardType); });
    container.appendChild(card);
  });
  cardScreen.style.display = 'flex';
  let timeRemaining = timeLeft;
  timerEl.textContent = `${timeRemaining} detik`;
  cardTimerInterval = setInterval(() => {
    timeRemaining--;
    timerEl.textContent = `${timeRemaining} detik`;
    if (timeRemaining <= 0) clearInterval(cardTimerInterval);
  }, 1000);
});
function selectCard(cardType) {
  clearInterval(cardTimerInterval);
  cardScreen.style.display = 'none';
  playSound('powerUp');
  socket.emit('card_selected', { roomCode: window.roomCode, cardType });
}
socket.on('upgrade_applied', ({ upgrades }) => { myUpgrades = upgrades; });
socket.on('hide_cards', () => { clearInterval(cardTimerInterval); cardScreen.style.display = 'none'; });

socket.on('game_won', ({ message }) => {
  isDead = true;
  const duration = Math.floor((Date.now() - gameStartTime) / 1000);
  const mins = Math.floor(duration / 60); const secs = duration % 60;
  document.getElementById('gameover-stats').innerHTML = `🏆 ${message}<br>⏱ Bertahan: ${mins}m ${secs}s<br>💀 Musuh dibunuh: ${myKills}`;
  joystickLeft.style.display = 'none'; attackBtn.style.display = 'none';
  if (players[window.myId]) saveToLeaderboard(players[window.myId].name, myKills, duration);
  screenGameover.style.display = 'flex';
});
socket.on('bullet_fired', ({ bullet, shooterId }) => { if (shooterId !== window.myId) bullets.push({ ...bullet, life: 80 }); });
socket.on('player_dead', ({ playerId }) => {
  if (playerId === window.myId) {
    isDead = true;
    const duration = Math.floor((Date.now() - gameStartTime) / 1000);
    const mins = Math.floor(duration / 60); const secs = duration % 60;
    document.getElementById('gameover-stats').innerHTML = `⏱ Bertahan: ${mins}m ${secs}s<br>💀 Musuh dibunuh: ${myKills}`;
    joystickLeft.style.display = 'none'; attackBtn.style.display = 'none';
    saveToLeaderboard(players[window.myId]?.name || 'Player', myKills, duration);
    screenGameover.style.display = 'flex';
  } else { if (players[playerId]) players[playerId].dead = true; }
});
socket.on('error', ({ message }) => { errorMsg.textContent = message; errorMsgJoin.textContent = message; });

btnStart.addEventListener('click', () => { if (!window.isHost || !window.roomCode) return; socket.emit('start_game', { roomCode: window.roomCode }); });
document.getElementById('btn-exit').addEventListener('click', () => location.reload());

function updatePlayerList() {
  playerListEl.innerHTML = '';
  for (const pid in players) {
    const p = players[pid];
    const div = document.createElement('div');
    div.className = 'player-entry';
    div.innerHTML = `<div class="player-dot" style="background:${p.color}"></div><span>${p.name || 'Player'}${pid === window.myId ? ' (Kamu)' : ''}</span>`;
    playerListEl.appendChild(div);
  }
}

function saveToLeaderboard(name, kills, duration) {
  db.ref('leaderboard').push({ name, kills, duration, timestamp: Date.now() });
}
function loadLeaderboard() {
  db.ref('leaderboard').orderByChild('kills').limitToLast(10).once('value', (snapshot) => {
    const data = snapshot.val();
    if (!data) { document.getElementById('leaderboard-list').innerHTML = '<div style="color:#aaa">Belum ada data</div>'; return; }
    const entries = Object.values(data).sort((a, b) => b.kills - a.kills || b.duration - a.duration);
    document.getElementById('leaderboard-list').innerHTML = entries.map((e, i) => {
      const mins = Math.floor(e.duration / 60); const secs = e.duration % 60;
      return `<div class="lb-entry"><span class="lb-rank">#${i+1}</span><span class="lb-name">${e.name}</span><span class="lb-kills">💀 ${e.kills}</span><span class="lb-time">⏱ ${mins}m ${secs}s</span></div>`;
    }).join('');
  });
}

// ==================== GAME START ====================
function startGame() {
  if (gameStarted) return;
  gameStarted = true;
  gameStartTime = Date.now();
  playBgm('mainBgm');
  ['screen-menu','screen-lobby','screen-join','screen-room'].forEach(s => { const el = document.getElementById(s); if (el) el.style.display = 'none'; });
  screenGameover.style.display = 'none';
  joystickLeft.style.display = 'block';
  attackBtn.style.display = 'flex';
  gameLoop();
}

// ==================== JOYSTICK ====================
let joystickActive = false;
let joystickOrigin = { x: 0, y: 0 };
let joystickTouchId = null;

joystickLeft.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const touch = e.changedTouches[0];
  joystickTouchId = touch.identifier; joystickActive = true;
  const rect = joystickLeft.getBoundingClientRect();
  joystickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
});
joystickLeft.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (!joystickActive) return;
  const touch = [...e.changedTouches].find(t => t.identifier === joystickTouchId);
  if (!touch) return;
  let dx = touch.clientX - joystickOrigin.x;
  let dy = touch.clientY - joystickOrigin.y;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const maxDist = 40;
  if (dist > maxDist) { dx = (dx/dist)*maxDist; dy = (dy/dist)*maxDist; }
  knobLeft.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  moveInput.x = dx / maxDist; moveInput.y = dy / maxDist;
});
joystickLeft.addEventListener('touchend', (e) => {
  const touch = [...e.changedTouches].find(t => t.identifier === joystickTouchId);
  if (!touch) return;
  joystickActive = false; joystickTouchId = null;
  knobLeft.style.transform = 'translate(-50%, -50%)';
  moveInput = { x: 0, y: 0 };
});

// ==================== ATTACK ====================
let lastShotTime = 0;
attackBtn.addEventListener('touchstart', (e) => { e.preventDefault(); shoot(); });
attackBtn.addEventListener('click', () => shoot());
window.addEventListener('keydown', (e) => { if (e.code === 'Space' && gameStarted && !isDead) { e.preventDefault(); shoot(); } });

function shoot() {
  if (!window.myId || !players[window.myId] || isDead) return;
  const now = Date.now();
  if (now - lastShotTime < myUpgrades.fireRate) return;
  lastShotTime = now;
  playSound('shoot');

  const me = players[window.myId];
  const target = getNearestEnemy(me.x, me.y);
  if (!target) return;

  const dx = target.x - me.x;
  const dy = target.y - me.y;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const baseVx = (dx/dist) * 10;
  const baseVy = (dy/dist) * 10;

  const shotCount = myUpgrades.shotCount || 1;
  const spreadAngles = shotCount === 1 ? [0] : Array.from({length: shotCount}, (_, i) => (i - (shotCount-1)/2) * 0.15);

  spreadAngles.forEach(angle => {
    const cos = Math.cos(angle); const sin = Math.sin(angle);
    const bullet = {
      x: me.x, y: me.y,
      vx: baseVx*cos - baseVy*sin,
      vy: baseVx*sin + baseVy*cos,
      life: 80, ownerId: window.myId, damage: myUpgrades.damage
    };
    bullets.push(bullet);
    socket.emit('bullet_fired', { roomCode: window.roomCode, bullet });
  });
}

function getNearestEnemy(x, y) {
  let nearest = null; let minDist = Infinity;
  for (const e of enemies) {
    const dx = e.x - x; const dy = e.y - y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < minDist) { minDist = dist; nearest = e; }
  }
  return nearest;
}

// ==================== GAME LOOP ====================
const SPEED = 5;

function gameLoop() { update(); draw(); requestAnimationFrame(gameLoop); }

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
    me.x += finalX * SPEED; me.y += finalY * SPEED;
    socket.emit('player_move', { roomCode: window.roomCode, x: me.x, y: me.y });
  }

  // Smooth camera follow
  const isMobile = Math.min(canvas.width, canvas.height) < 500;
  const scale = Math.min(canvas.width, canvas.height) / (isMobile ? 320 : 600);
  camera.targetX = me.x - (canvas.width / 2) / scale;
  camera.targetY = me.y - (canvas.height / 2) / scale;
  camera.x += (camera.targetX - camera.x) * 0.1;
  camera.y += (camera.targetY - camera.y) * 0.1;

  // Screen shake decay
  if (shakeAmount > 0) {
    shakeX = (Math.random() - 0.5) * shakeAmount * 2;
    shakeY = (Math.random() - 0.5) * shakeAmount * 2;
    shakeAmount *= 0.85;
    if (shakeAmount < 0.1) shakeAmount = 0;
  } else { shakeX = 0; shakeY = 0; }

  // Update particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.92; p.vy *= 0.92;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }

  // Update damage numbers
  for (let i = damageNumbers.length - 1; i >= 0; i--) {
    const d = damageNumbers[i];
    d.y += d.vy; d.life--;
    if (d.life <= 0) damageNumbers.splice(i, 1);
  }

  // Decay hit flashes
  for (const id in hitFlashes) {
    hitFlashes[id]--;
    if (hitFlashes[id] <= 0) delete hitFlashes[id];
  }

  // Bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx; b.y += b.vy; b.life--;
    if (b.life <= 0) { bullets.splice(i, 1); continue; }
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      const dx = b.x - e.x; const dy = b.y - e.y;
      const hitRadius = e.isBoss ? 40 : 20;
      if (Math.sqrt(dx*dx + dy*dy) < hitRadius) {
        if (b.ownerId === window.myId) {
          socket.emit('bullet_hit', { roomCode: window.roomCode, enemyId: e.id, damage: b.damage || 1 });
          triggerShake(2);
        }
        bullets.splice(i, 1); break;
      }
    }
  }

  if (waveAnnouncement) { waveAnnouncement.timer--; if (waveAnnouncement.timer <= 0) waveAnnouncement = null; }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Apply screen shake
  ctx.save();
  ctx.translate(shakeX, shakeY);

  const isMobile = Math.min(canvas.width, canvas.height) < 500;
  const scale = Math.min(canvas.width, canvas.height) / (isMobile ? 320 : 600);
  ctx.save();
  ctx.scale(scale, scale);

  const cx = camera.x;
  const cy = camera.y;

  // Grid
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 1 / scale;
  const gridSize = 80;
  const startX = -((cx % gridSize) + gridSize) % gridSize;
  const startY = -((cy % gridSize) + gridSize) % gridSize;
  const cols = Math.ceil(canvas.width / scale / gridSize) + 1;
  const rows = Math.ceil(canvas.height / scale / gridSize) + 1;
  for (let i = 0; i <= cols; i++) { const x = startX + i*gridSize; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height/scale); ctx.stroke(); }
  for (let i = 0; i <= rows; i++) { const y = startY + i*gridSize; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width/scale, y); ctx.stroke(); }

  // Particles (world space)
  for (const p of particles) {
    const sx = p.x - cx; const sy = p.y - cy;
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(sx, sy, p.size, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // Enemies
  for (const e of enemies) {
    const sx = e.x - cx; const sy = e.y - cy;
    const radius = e.isBoss ? 40 : 18;
    const maxHp = e.maxHp || (e.isBoss ? 740 : 4);
    const isFlashing = hitFlashes[e.id] > 0;

    ctx.save();
    if (isFlashing) {
      ctx.shadowColor = 'white';
      ctx.shadowBlur = 20;
    }

    if (e.isBoss) {
      ctx.fillStyle = isFlashing ? 'white' : '#8e44ad';
      ctx.fillRect(sx - radius, sy - radius, radius*2, radius*2);
      if (!isFlashing) {
        ctx.strokeStyle = '#f39c12';
        ctx.lineWidth = 3 / scale;
        ctx.strokeRect(sx - radius, sy - radius, radius*2, radius*2);
        // Light glow boss
        const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius * 2);
        grad.addColorStop(0, 'rgba(142,68,173,0.3)');
        grad.addColorStop(1, 'rgba(142,68,173,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(sx - radius*2, sy - radius*2, radius*4, radius*4);
      }
      ctx.fillStyle = 'white';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('BOSS', sx, sy + 5);
    } else {
      ctx.fillStyle = isFlashing ? 'white' : '#e74c3c';
      // Light radius musuh
      if (!isFlashing) {
        const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius * 2.5);
        grad.addColorStop(0, 'rgba(231,76,60,0.2)');
        grad.addColorStop(1, 'rgba(231,76,60,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(sx, sy, radius * 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e74c3c';
      }
      ctx.beginPath(); ctx.arc(sx, sy, radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // HP bar
    const barW = e.isBoss ? 80 : 40;
    const barY = sy - radius - 10;
    ctx.fillStyle = '#333'; ctx.fillRect(sx - barW/2, barY, barW, 5);
    ctx.fillStyle = e.isBoss ? '#f39c12' : '#e74c3c';
    ctx.fillRect(sx - barW/2, barY, (e.hp / maxHp) * barW, 5);
  }

  // Bullets (with bloom)
  for (const b of bullets) {
    const bx = b.x - cx; const by = b.y - cy;
    ctx.save();
    ctx.shadowColor = '#f1c40f';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#f1c40f';
    ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Players
  for (const pid in players) {
    const p = players[pid];
    if (p.dead) continue;
    const sx = p.x - cx; const sy = p.y - cy;
    const isMe = pid === window.myId;

    // Light radius player
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, 60);
    grad.addColorStop(0, `${p.color || '#3498db'}33`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(sx, sy, 60, 0, Math.PI * 2); ctx.fill();

    // Player body (bloom)
    ctx.save();
    ctx.shadowColor = p.color || '#3498db';
    ctx.shadowBlur = isMe ? 16 : 8;
    ctx.fillStyle = p.color || '#3498db';
    ctx.beginPath(); ctx.arc(sx, sy, 20, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // HP bar
    ctx.fillStyle = '#333'; ctx.fillRect(sx - 25, sy - 35, 50, 6);
    ctx.fillStyle = p.hp > 50 ? '#2ecc71' : p.hp > 25 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(sx - 25, sy - 35, (p.hp / 100) * 50, 6);

    // Name
    ctx.fillStyle = 'white';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText((p.name || 'Player') + (isMe ? ' ★' : ''), sx, sy - 40);
  }

  // Damage numbers (world space)
  for (const d of damageNumbers) {
    const sx = d.x - cx; const sy = d.y - cy;
    const alpha = d.life / d.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = d.color;
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.shadowColor = d.color;
    ctx.shadowBlur = 4;
    ctx.fillText(d.text, sx, sy);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  ctx.restore(); // end scale

  // HUD (no shake, no scale)
  if (gameStarted) {
    // Kills
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(10, 10, 160, 32);
    ctx.fillStyle = 'white'; ctx.font = '14px Arial'; ctx.textAlign = 'left';
    ctx.fillText(`💀 Kills: ${myKills}`, 20, 31);

    // Upgrades
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(10, 50, 200, 32);
    ctx.fillStyle = '#f39c12'; ctx.font = '13px Arial'; ctx.textAlign = 'left';
    ctx.fillText(`⚔️ ${myUpgrades.damage.toFixed(1)}x  🔥 ${(1000/myUpgrades.fireRate).toFixed(1)}/s  🎯 ${myUpgrades.shotCount}`, 16, 71);

    // Wave
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(canvas.width/2 - 60, 10, 120, 32);
    ctx.fillStyle = currentWave === 10 ? '#f39c12' : 'white';
    ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center';
    ctx.fillText(`WAVE ${currentWave}/10`, canvas.width/2, 31);

    // Wave announcement
    if (waveAnnouncement) {
      const alpha = Math.min(1, waveAnnouncement.timer / 30);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = waveAnnouncement.text.includes('BOSS') ? '#f39c12' : '#2ecc71';
      ctx.font = 'bold 36px Arial'; ctx.textAlign = 'center';
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 20;
      ctx.fillText(waveAnnouncement.text, canvas.width/2, canvas.height/2 - 40);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
  }

  // Vignette effect
  const vignette = ctx.createRadialGradient(
    canvas.width/2, canvas.height/2, canvas.height * 0.3,
    canvas.width/2, canvas.height/2, canvas.height * 0.85
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.restore(); // end shake translate
}