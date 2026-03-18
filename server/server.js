require('dotenv').config();

const path = require('path');
const http = require('http');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');

const connectDB = require('./config/db');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Connect to MongoDB
connectDB();

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'client')));

// File uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/\s+/g, '_');
    cb(null, `${timestamp}_${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

app.use('/uploads', express.static(uploadDir));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// HTTP upload endpoint, returns file metadata; message is sent via socket.io
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileUrl = `/uploads/${req.file.filename}`;

  res.json({
    fileUrl,
    fileName: req.file.originalname,
    fileType: req.file.mimetype
  });
});

const onlineUsers = new Map(); // socketId -> username
const userSockets = new Map(); // username -> socketId
const activeCalls = new Map(); // username -> peer username

const PORT = process.env.PORT || 5000;

io.on('connection', (socket) => {
  console.log('New client connected', socket.id);

  // User joins with a username
  socket.on('join', async (username, callback) => {
    if (!username || typeof username !== 'string') {
      if (callback) callback({ error: 'Invalid username' });
      return;
    }

    username = username.trim();
    if (!username) {
      if (callback) callback({ error: 'Username cannot be empty' });
      return;
    }

    onlineUsers.set(socket.id, username);
    userSockets.set(username, socket.id);

    // Load last 50 messages
    try {
      const recent = await Message.find({})
        .sort({ timestamp: -1 })
        .limit(50)
        .lean();

      const ordered = recent.reverse();
      socket.emit('chat_history', ordered);
    } catch (err) {
      console.error('Error loading messages:', err.message);
      socket.emit('error_message', 'Failed to load chat history.');
    }

    // Broadcast join system message
    const joinMessage = {
      user: 'System',
      text: `${username} joined the chat`,
      to: 'all',
      timestamp: new Date().toISOString()
    };
    io.emit('system_message', joinMessage);

    // Update online users list
    io.emit('online_users', Array.from(userSockets.keys()));

    if (callback) callback({ success: true, username });
  });

  function isUserBusy(user) {
    return activeCalls.has(user);
  }

  function setCallPair(a, b) {
    activeCalls.set(a, b);
    activeCalls.set(b, a);
  }

  function clearCallPair(user) {
    const peer = activeCalls.get(user);
    if (peer) {
      activeCalls.delete(peer);
    }
    activeCalls.delete(user);
    return peer;
  }

  // Call signaling (WebRTC)
  socket.on('call:offer', (payload, callback) => {
    try {
      const fromUser = onlineUsers.get(socket.id);
      if (!fromUser) return callback && callback({ error: 'User not joined' });

      const to = payload && payload.to ? String(payload.to).trim() : '';
      const mode = payload && payload.mode ? String(payload.mode) : 'voice'; // voice|video
      const offer = payload && payload.offer ? payload.offer : null;

      if (!to || !offer) return callback && callback({ error: 'Invalid offer' });
      if (to === fromUser) return callback && callback({ error: 'Cannot call yourself' });

      const targetSocketId = userSockets.get(to);
      if (!targetSocketId) return callback && callback({ error: 'User is offline' });

      if (isUserBusy(fromUser)) return callback && callback({ error: 'You are already in a call' });
      if (isUserBusy(to)) return callback && callback({ error: 'User is busy' });

      setCallPair(fromUser, to);

      io.to(targetSocketId).emit('call:incoming', {
        from: fromUser,
        mode,
        offer
      });

      callback && callback({ success: true });
    } catch (err) {
      console.error('call:offer error:', err.message);
      callback && callback({ error: 'Failed to start call' });
    }
  });

  socket.on('call:answer', (payload, callback) => {
    try {
      const fromUser = onlineUsers.get(socket.id);
      if (!fromUser) return callback && callback({ error: 'User not joined' });

      const to = payload && payload.to ? String(payload.to).trim() : '';
      const answer = payload && payload.answer ? payload.answer : null;
      const accepted = payload && typeof payload.accepted === 'boolean' ? payload.accepted : true;

      if (!to) return callback && callback({ error: 'Invalid target' });

      const targetSocketId = userSockets.get(to);
      if (!targetSocketId) return callback && callback({ error: 'User is offline' });

      if (!accepted) {
        clearCallPair(fromUser);
        io.to(targetSocketId).emit('call:ended', { from: fromUser, reason: 'rejected' });
        return callback && callback({ success: true });
      }

      if (!answer) return callback && callback({ error: 'Invalid answer' });

      io.to(targetSocketId).emit('call:answered', {
        from: fromUser,
        answer
      });

      callback && callback({ success: true });
    } catch (err) {
      console.error('call:answer error:', err.message);
      callback && callback({ error: 'Failed to answer call' });
    }
  });

  socket.on('call:ice', (payload) => {
    const fromUser = onlineUsers.get(socket.id);
    if (!fromUser) return;

    const to = payload && payload.to ? String(payload.to).trim() : '';
    const candidate = payload && payload.candidate ? payload.candidate : null;
    if (!to || !candidate) return;

    const targetSocketId = userSockets.get(to);
    if (!targetSocketId) return;

    io.to(targetSocketId).emit('call:ice', { from: fromUser, candidate });
  });

  socket.on('call:end', (payload) => {
    const fromUser = onlineUsers.get(socket.id);
    if (!fromUser) return;

    const to = payload && payload.to ? String(payload.to).trim() : '';
    const peer = to || activeCalls.get(fromUser);

    const clearedPeer = clearCallPair(fromUser) || peer;
    if (!clearedPeer) return;

    const targetSocketId = userSockets.get(clearedPeer);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call:ended', { from: fromUser, reason: 'ended' });
    }
  });

  // Public & private messages
  socket.on('chat_message', async (payload, callback) => {
    try {
      const fromUser = onlineUsers.get(socket.id);
      if (!fromUser) {
        if (callback) callback({ error: 'User not joined' });
        return;
      }

      const text = (payload && payload.text ? String(payload.text) : '').trim();
      let to = payload && payload.to ? String(payload.to).trim() : 'all';
      const file = payload && payload.file ? payload.file : null;

      const fileUrl = file && file.url ? String(file.url) : null;
      const fileName = file && file.name ? String(file.name) : null;
      const fileType = file && file.type ? String(file.type) : null;

      if (!text && !fileUrl) {
        if (callback) callback({ error: 'Message must have text or file' });
        return;
      }

      if (!to) {
        to = 'all';
      }

      const messageDoc = await Message.create({
        user: fromUser,
        text,
        to,
        fileUrl,
        fileName,
        fileType
      });

      const message = {
        _id: messageDoc._id.toString(),
        user: messageDoc.user,
        text: messageDoc.text,
        to: messageDoc.to,
        timestamp: messageDoc.timestamp,
        fileUrl: messageDoc.fileUrl,
        fileName: messageDoc.fileName,
        fileType: messageDoc.fileType
      };

      if (to === 'all') {
        io.emit('chat_message', message);
      } else {
        const targetSocketId = userSockets.get(to);

        // Send to sender
        socket.emit('chat_message', message);

        // Send to receiver if online and not the same socket
        if (targetSocketId && targetSocketId !== socket.id) {
          io.to(targetSocketId).emit('chat_message', message);
        }
      }

      if (callback) callback({ success: true });
    } catch (err) {
      console.error('Error handling chat_message:', err.message);
      if (callback) callback({ error: 'Failed to send message' });
      socket.emit('error_message', 'Failed to send message.');
    }
  });

  // Typing indicator
  socket.on('typing', (payload) => {
    const fromUser = onlineUsers.get(socket.id);
    if (!fromUser) return;

    const isTyping = !!(payload && payload.isTyping);
    const to = payload && payload.to ? String(payload.to).trim() : 'all';

    const typingEvent = {
      user: fromUser,
      to,
      isTyping
    };

    if (to === 'all') {
      socket.broadcast.emit('typing', typingEvent);
    } else {
      const targetSocketId = userSockets.get(to);
      if (targetSocketId) {
        io.to(targetSocketId).emit('typing', typingEvent);
      }
    }
  });

  socket.on('disconnect', () => {
    const username = onlineUsers.get(socket.id);
    if (username) {
      const peer = clearCallPair(username);
      if (peer) {
        const peerSocketId = userSockets.get(peer);
        if (peerSocketId) {
          io.to(peerSocketId).emit('call:ended', { from: username, reason: 'disconnect' });
        }
      }

      onlineUsers.delete(socket.id);
      userSockets.delete(username);

      const leaveMessage = {
        user: 'System',
        text: `${username} left the chat`,
        to: 'all',
        timestamp: new Date().toISOString()
      };
      io.emit('system_message', leaveMessage);
      io.emit('online_users', Array.from(userSockets.keys()));
    }
    console.log('Client disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

