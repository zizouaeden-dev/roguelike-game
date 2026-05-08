const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Buat room baru
  socket.on('create_room', () => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      players: {}
    };
    socket.join(roomCode);
    rooms[roomCode].players[socket.id] = {
      id: socket.id,
      x: 400,
      y: 300,
      hp: 100
    };
    socket.emit('room_created', { roomCode, playerId: socket.id });
    console.log('Room created:', roomCode);
  });

  // Join room
  socket.on('join_room', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit('error', { message: 'Room tidak ditemukan!' });
      return;
    }
    if (Object.keys(room.players).length >= 3) {
      socket.emit('error', { message: 'Room sudah penuh!' });
      return;
    }
    socket.join(roomCode);
    room.players[socket.id] = {
      id: socket.id,
      x: 400,
      y: 300,
      hp: 100
    };
    io.to(roomCode).emit('player_joined', { players: room.players });
    socket.emit('join_success', { roomCode, playerId: socket.id, players: room.players });
    console.log('Player joined room:', roomCode);
  });

  // Update posisi player
  socket.on('player_move', ({ roomCode, x, y }) => {
    const room = rooms[roomCode];
    if (!room || !room.players[socket.id]) return;
    room.players[socket.id].x = x;
    room.players[socket.id].y = y;
    socket.to(roomCode).emit('player_moved', {
      playerId: socket.id,
      x, y
    });
  });

  // Player disconnect
  socket.on('disconnecting', () => {
    for (const roomCode of socket.rooms) {
      if (rooms[roomCode]) {
        delete rooms[roomCode].players[socket.id];
        io.to(roomCode).emit('player_left', { playerId: socket.id });
        if (Object.keys(rooms[roomCode].players).length === 0) {
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