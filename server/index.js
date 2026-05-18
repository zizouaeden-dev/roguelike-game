const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};
const AVAILABLE_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
const MAX_WAVE = 10;

const CARD_POOL = ['damage', 'fire_rate', 'double_shot'];

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRandomCards() {
  const shuffled = [...CARD_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

function getWaveConfig(wave) {
  const isBossWave = wave === MAX_WAVE;
  const enemyCount = Math.floor(isBossWave ? 15 * Math.pow(1.5, wave - 1) : 15 * Math.pow(1.5, wave - 1));
  const enemyHp = 4 + (wave - 1) * 2;
  const enemySpeed = 3;
  return { enemyCount, enemyHp, enemySpeed, isBossWave };
}

function spawnWaveEnemies(roomCode) {
  const r = rooms[roomCode];
  if (!r) return;

  const { enemyCount, enemyHp, enemySpeed, isBossWave } = getWaveConfig(r.wave);
  const playerIds = Object.keys(r.players).filter(pid => !r.players[pid].dead);
  if (playerIds.length === 0) return;

  r.enemiesLeftInWave = enemyCount;
  r.enemiesSpawnedInWave = 0;

  if (isBossWave) {
    const targetId = playerIds[Math.floor(Math.random() * playerIds.length)];
    const target = r.players[targetId];
    const angle = Math.random() * Math.PI * 2;
    const boss = {
      id: 'boss_' + Date.now(),
      x: target.x + Math.cos(angle) * 700,
      y: target.y + Math.sin(angle) * 700,
      hp: 740,
      maxHp: 740,
      speed: enemySpeed * 0.7,
      isBoss: true,
      radius: 40
    };
    r.enemies.push(boss);
    r.enemiesSpawnedInWave++;
  }

  const spawnNext = () => {
    const r = rooms[roomCode];
    if (!r || !r.started) return;
    if (r.enemiesSpawnedInWave >= enemyCount) return;

    const alivePlayers = Object.keys(r.players).filter(pid => !r.players[pid].dead);
    if (alivePlayers.length === 0) return;

    const targetId = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    const target = r.players[targetId];
    const angle = Math.random() * Math.PI * 2;
    const spawnDist = 600 + Math.random() * 200;

    const enemy = {
      id: Date.now() + Math.random(),
      x: target.x + Math.cos(angle) * spawnDist,
      y: target.y + Math.sin(angle) * spawnDist,
      hp: enemyHp,
      maxHp: enemyHp,
      speed: enemySpeed,
      isBoss: false,
      radius: 18
    };

    r.enemies.push(enemy);
    r.enemiesSpawnedInWave++;
    io.to(roomCode).emit('enemy_spawned', { enemy });

    if (r.enemiesSpawnedInWave < enemyCount) {
      const spawnInterval = Math.max(400, 1500 - r.wave * 100);
      r.spawnTimeout = setTimeout(spawnNext, spawnInterval);
    }
  };

  io.to(roomCode).emit('wave_start', { wave: r.wave, enemyCount, isBossWave });
  setTimeout(spawnNext, 1000);
}

function startCardPhase(roomCode) {
  const r = rooms[roomCode];
  if (!r) return;

  // Generate 3 card acak untuk tiap player
  r.cardPhase = true;
  r.cardChoices = {};
  r.pendingCards = {};

  const playerIds = Object.keys(r.players).filter(pid => !r.players[pid].dead);
  playerIds.forEach(pid => {
    r.pendingCards[pid] = false; // belum milih
    const cards = getRandomCards();
    r.cardChoices[pid] = cards;
    io.to(pid).emit('show_cards', { cards, timeLeft: 15 });
  });

  // Timer 15 detik
  r.cardTimer = setTimeout(() => {
    // Auto pilih random buat yang belum milih
    playerIds.forEach(pid => {
      if (!r.pendingCards[pid]) {
        const cards = r.cardChoices[pid];
        const randomCard = cards[Math.floor(Math.random() * cards.length)];
        applyUpgrade(roomCode, pid, randomCard);
      }
    });
    endCardPhase(roomCode);
  }, 15000);
}

function applyUpgrade(roomCode, playerId, cardType) {
  const r = rooms[roomCode];
  if (!r || !r.players[playerId]) return;
  const p = r.players[playerId];

  if (!p.upgrades) p.upgrades = { damage: 1, fireRate: 500, shotCount: 1 };

  if (!p.upgrades.damageCount) p.upgrades.damageCount = 0;
if (!p.upgrades.fireRateCount) p.upgrades.fireRateCount = 0;

if (cardType === 'damage') {
  if (p.upgrades.damageCount < 5) {
    p.upgrades.damage = parseFloat((p.upgrades.damage * 1.5).toFixed(2));
    p.upgrades.damageCount++;
  }
} else if (cardType === 'fire_rate') {
  if (p.upgrades.fireRateCount < 5) {
    p.upgrades.fireRate = Math.max(167, Math.floor(p.upgrades.fireRate / 1.5));
    p.upgrades.fireRateCount++;
  }
} else if (cardType === 'double_shot') {
  p.upgrades.shotCount = (p.upgrades.shotCount || 1) + 1;
  p.upgrades.damage = parseFloat((p.upgrades.damage * 0.8).toFixed(2));
}

  // Kirim upgrade ke player yang bersangkutan
  io.to(playerId).emit('upgrade_applied', { upgrades: p.upgrades });
}

function endCardPhase(roomCode) {
  const r = rooms[roomCode];
  if (!r) return;
  r.cardPhase = false;
  clearTimeout(r.cardTimer);
  io.to(roomCode).emit('hide_cards');

  if (r.wave >= MAX_WAVE) {
    io.to(roomCode).emit('game_won', { message: 'Semua wave selesai! Kalian menang!' });
    return;
  }
  r.wave++;
  setTimeout(() => spawnWaveEnemies(roomCode), 2000);
}

function checkWaveComplete(roomCode) {
  const r = rooms[roomCode];
  if (!r || !r.started || r.cardPhase) return;
  if (r.enemies.length === 0 && r.enemiesSpawnedInWave >= r.enemiesLeftInWave) {
    io.to(roomCode).emit('wave_complete', { wave: r.wave });
    setTimeout(() => startCardPhase(roomCode), 2000);
  }
}

function startGameLoop(roomCode) {
  rooms[roomCode].gameInterval = setInterval(() => {
    const r = rooms[roomCode];
    if (!r || !r.started) return;

    for (let i = r.enemies.length - 1; i >= 0; i--) {
      const e = r.enemies[i];
      let nearestPlayer = null;
      let minDist = Infinity;

      for (const pid in r.players) {
        const p = r.players[pid];
        if (p.dead) continue;
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) { minDist = dist; nearestPlayer = { p, pid }; }
      }

      if (nearestPlayer) {
        const dx = nearestPlayer.p.x - e.x;
        const dy = nearestPlayer.p.y - e.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        e.x += (dx / dist) * e.speed;
        e.y += (dy / dist) * e.speed;

        const hitRadius = e.isBoss ? 45 : 25;
        if (dist < hitRadius) {
          const dmg = e.isBoss ? 3 : 1;
          nearestPlayer.p.hp = Math.max(0, nearestPlayer.p.hp - dmg);
          io.to(roomCode).emit('hp_update', { playerId: nearestPlayer.pid, hp: nearestPlayer.p.hp });
          if (nearestPlayer.p.hp <= 0 && !nearestPlayer.p.dead) {
            nearestPlayer.p.dead = true;
            io.to(roomCode).emit('player_dead', { playerId: nearestPlayer.pid });
          }
        }
      }
    }

    io.to(roomCode).emit('enemies_update', { enemies: r.enemies });
  }, 50);
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('create_room', ({ name, color }) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      players: {}, enemies: [], started: false,
      hostId: socket.id, startTime: null,
      usedColors: [color], wave: 1,
      enemiesLeftInWave: 0, enemiesSpawnedInWave: 0,
      cardPhase: false, cardChoices: {}, pendingCards: {}
    };
    socket.join(roomCode);
    rooms[roomCode].players[socket.id] = {
      id: socket.id, name: name || 'Player', color,
      x: 400, y: 300, hp: 100, kills: 0, dead: false,
      upgrades: { damage: 1, fireRate: 500, shotCount: 1 }
    };
    const availableColors = AVAILABLE_COLORS.filter(c => !rooms[roomCode].usedColors.includes(c));
    socket.emit('room_created', { roomCode, playerId: socket.id, players: rooms[roomCode].players, availableColors });
  });

  socket.on('join_room', ({ roomCode, name, color }) => {
    const room = rooms[roomCode];
    if (!room) { socket.emit('error', { message: 'Room tidak ditemukan!' }); return; }
    if (Object.keys(room.players).length >= 3) { socket.emit('error', { message: 'Room sudah penuh!' }); return; }
    if (room.started) { socket.emit('error', { message: 'Game sudah dimulai!' }); return; }
    if (room.usedColors.includes(color)) { socket.emit('error', { message: 'Warna sudah dipakai!' }); return; }

    socket.join(roomCode);
    room.players[socket.id] = {
      id: socket.id, name: name || 'Player', color,
      x: 400, y: 300, hp: 100, kills: 0, dead: false,
      upgrades: { damage: 1, fireRate: 500, shotCount: 1 }
    };
    room.usedColors.push(color);

    const availableColors = AVAILABLE_COLORS.filter(c => !room.usedColors.includes(c));
    socket.emit('join_success', { roomCode, playerId: socket.id, players: room.players, availableColors });
    socket.to(roomCode).emit('player_joined', { players: room.players, availableColors });
  });

  socket.on('start_game', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (Object.keys(room.players).length < 2) {
      socket.emit('error', { message: 'Minimal 2 pemain untuk mulai!' });
      return;
    }
    room.started = true;
    room.startTime = Date.now();
    room.wave = 1;
    io.to(roomCode).emit('game_started', { players: room.players });
    startGameLoop(roomCode);
    spawnWaveEnemies(roomCode);
  });

  socket.on('player_move', ({ roomCode, x, y }) => {
    const room = rooms[roomCode];
    if (!room || !room.players[socket.id]) return;
    room.players[socket.id].x = x;
    room.players[socket.id].y = y;
    socket.to(roomCode).emit('player_moved', { playerId: socket.id, x, y });
  });

  socket.on('bullet_fired', ({ roomCode, bullet }) => {
    socket.to(roomCode).emit('bullet_fired', { bullet, shooterId: socket.id });
  });

  socket.on('bullet_hit', ({ roomCode, enemyId, damage }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const idx = room.enemies.findIndex(e => e.id === enemyId);
    if (idx === -1) return;
    const dmg = damage || 1;
    room.enemies[idx].hp -= dmg;
    if (room.enemies[idx].hp <= 0) {
      room.enemies.splice(idx, 1);
      if (room.players[socket.id]) room.players[socket.id].kills++;
      io.to(roomCode).emit('enemy_killed', { enemyId, killerId: socket.id });
      checkWaveComplete(roomCode);
    } else {
      io.to(roomCode).emit('enemy_hp_update', { enemyId, hp: room.enemies[idx].hp });
    }
  });

  socket.on('card_selected', ({ roomCode, cardType }) => {
    const room = rooms[roomCode];
    if (!room || !room.cardPhase) return;
    if (room.pendingCards[socket.id]) return; // udah milih
    room.pendingCards[socket.id] = true;
    applyUpgrade(roomCode, socket.id, cardType);

    // Cek kalau semua udah milih
    const playerIds = Object.keys(room.players).filter(pid => !room.players[pid].dead);
    const allChosen = playerIds.every(pid => room.pendingCards[pid]);
    if (allChosen) endCardPhase(roomCode);
  });

  socket.on('disconnecting', () => {
    for (const roomCode of socket.rooms) {
      if (rooms[roomCode]) {
        delete rooms[roomCode].players[socket.id];
        io.to(roomCode).emit('player_left', { playerId: socket.id });
        if (Object.keys(rooms[roomCode].players).length === 0) {
          clearInterval(rooms[roomCode].gameInterval);
          clearTimeout(rooms[roomCode].spawnTimeout);
          clearTimeout(rooms[roomCode].cardTimer);
          delete rooms[roomCode];
        }
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});