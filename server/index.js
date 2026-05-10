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

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function startEnemyLoop(roomCode) {
  const spawnEnemy = () => {
    const r = rooms[roomCode];
    if (!r || !r.started) return;
    const playerIds = Object.keys(r.players).filter(pid => !r.players[pid].dead);
    if (playerIds.length === 0) return;

    const targetId = playerIds[Math.floor(Math.random() * playerIds.length)];
    const target = r.players[targetId];
    const angle = Math.random() * Math.PI * 2;

    const enemy = {
      id: Date.now() + Math.random(),
      x: target.x + Math.cos(angle) * 600,
      y: target.y + Math.sin(angle) * 600,
      hp: 3,
      speed: 3.0
    };

    r.enemies.push(enemy);
    io.to(roomCode).emit('enemy_spawned', { enemy });
    r.spawnTimeout = setTimeout(spawnEnemy, 2000);
  };

  rooms[roomCode].spawnTimeout = setTimeout(spawnEnemy, 1000);

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

        if (dist < 25) {
          nearestPlayer.p.hp = Math.max(0, nearestPlayer.p.hp - 0.5);
          io.to(roomCode).emit('hp_update', {
            playerId: nearestPlayer.pid,
            hp: nearestPlayer.p.hp
          });
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
      players: {},
      enemies: [],
      started: false,
      hostId: socket.id,
      startTime: null,
      usedColors: [color]
    };
    socket.join(roomCode);
    rooms[roomCode].players[socket.id] = {
      id: socket.id,
      name: name || 'Player',
      color: color,
      x: 400, y: 300,
      hp: 100, kills: 0, dead: false
    };
    const availableColors = AVAILABLE_COLORS.filter(c => !rooms[roomCode].usedColors.includes(c));
    socket.emit('room_created', {
      roomCode,
      playerId: socket.id,
      players: rooms[roomCode].players,
      availableColors
    });
    console.log('Room created:', roomCode, 'by', name, color);
  });

  socket.on('join_room', ({ roomCode, name, color }) => {
    const room = rooms[roomCode];
    if (!room) { socket.emit('error', { message: 'Room tidak ditemukan!' }); return; }
    if (Object.keys(room.players).length >= 3) { socket.emit('error', { message: 'Room sudah penuh!' }); return; }
    if (room.started) { socket.emit('error', { message: 'Game sudah dimulai!' }); return; }
    if (room.usedColors.includes(color)) { socket.emit('error', { message: 'Warna sudah dipakai!' }); return; }

    socket.join(roomCode);
    room.players[socket.id] = {
      id: socket.id,
      name: name || 'Player',
      color: color,
      x: 400, y: 300,
      hp: 100, kills: 0, dead: false
    };
    room.usedColors.push(color);

    const availableColors = AVAILABLE_COLORS.filter(c => !room.usedColors.includes(c));
    socket.emit('join_success', { roomCode, playerId: socket.id, players: room.players, availableColors });
    socket.to(roomCode).emit('player_joined', { players: room.players, availableColors });
    console.log('Player joined:', name, color, 'room:', roomCode);
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
    io.to(roomCode).emit('game_started', { players: room.players });
    startEnemyLoop(roomCode);
    console.log('Game started in room:', roomCode);
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
  
  socket.on('bullet_hit', ({ roomCode, enemyId }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const idx = room.enemies.findIndex(e => e.id === enemyId);
    if (idx === -1) return;
    room.enemies[idx].hp--;
    if (room.enemies[idx].hp <= 0) {
      room.enemies.splice(idx, 1);
      if (room.players[socket.id]) room.players[socket.id].kills++;
      io.to(roomCode).emit('enemy_killed', { enemyId, killerId: socket.id });
    }
  });

  socket.on('disconnecting', () => {
    for (const roomCode of socket.rooms) {
      if (rooms[roomCode]) {
        delete rooms[roomCode].players[socket.id];
        io.to(roomCode).emit('player_left', { playerId: socket.id });
        if (Object.keys(rooms[roomCode].players).length === 0) {
          clearInterval(rooms[roomCode].gameInterval);
          clearTimeout(rooms[roomCode].spawnTimeout);
          delete rooms[roomCode];
          console.log('Room deleted:', roomCode);
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