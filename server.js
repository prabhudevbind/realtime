// server.js - WebRTC Signaling Server
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const users = new Map(); // userId -> socketId
const rooms = new Map(); // roomId -> [userId1, userId2]

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Register user
  socket.on('register', (userId) => {
    users.set(userId, socket.id);
    socket.userId = userId;
    console.log(`User ${userId} registered with socket ${socket.id}`);
  });

  // Join room for 1-on-1 call
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, []);
    }
    
    const room = rooms.get(roomId);
    room.push(socket.userId);
    
    console.log(`User ${socket.userId} joined room ${roomId}`);
    
    // Notify other users in room
    socket.to(roomId).emit('user-joined', {
      userId: socket.userId,
      socketId: socket.id
    });
    
    // Send existing users to the new joiner
    const otherUsers = room.filter(id => id !== socket.userId);
    socket.emit('existing-users', otherUsers);
  });

  // WebRTC Signaling
  socket.on('offer', (data) => {
    const { offer, to } = data;
    const targetSocket = users.get(to);
    
    if (targetSocket) {
      io.to(targetSocket).emit('offer', {
        offer,
        from: socket.userId
      });
    }
  });

  socket.on('answer', (data) => {
    const { answer, to } = data;
    const targetSocket = users.get(to);
    
    if (targetSocket) {
      io.to(targetSocket).emit('answer', {
        answer,
        from: socket.userId
      });
    }
  });

  socket.on('ice-candidate', (data) => {
    const { candidate, to } = data;
    const targetSocket = users.get(to);
    
    if (targetSocket) {
      io.to(targetSocket).emit('ice-candidate', {
        candidate,
        from: socket.userId
      });
    }
  });

  // End call
  socket.on('end-call', (data) => {
    const { to } = data;
    const targetSocket = users.get(to);
    
    if (targetSocket) {
      io.to(targetSocket).emit('call-ended', {
        from: socket.userId
      });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    if (socket.userId) {
      users.delete(socket.userId);
      
      // Remove from rooms and notify others
      rooms.forEach((userList, roomId) => {
        const index = userList.indexOf(socket.userId);
        if (index > -1) {
          userList.splice(index, 1);
          socket.to(roomId).emit('user-left', socket.userId);
        }
      });
    }
  });
});

// Serve static files from the built frontend
app.use(express.static('dist'));

// Handle React routing, return all requests to React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});