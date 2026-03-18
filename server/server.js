require('dotenv').config();

const path = require('path');
const http = require('http');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');

const connectDB = require('./config/db');
const Message = require('./models/Message');
const User = require('./models/User');
const Story = require('./models/Story');

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
const socketRooms = new Map(); // socketId -> room

const defaultRooms = ['public', 'general', 'random', 'help'];

async function emitOnlineUsers() {
  const usernames = Array.from(userSockets.keys());
  const docs = await User.find({ username: { $in: usernames } })
    .select('username avatarSeed lastSeen')
    .lean();
  const byName = new Map(docs.map((d) => [d.username, d]));
  const payload = usernames.map((u) => ({
    username: u,
    avatarSeed: (byName.get(u) && byName.get(u).avatarSeed) || u,
    lastSeen: (byName.get(u) && byName.get(u).lastSeen) || new Date().toISOString(),
    online: true
  }));
  io.emit('online_users', payload);
}

const PORT = process.env.PORT || 5000;

io.on('connection', (socket) => {
  console.log('New client connected', socket.id);

  // User joins with a username
  socket.on('join', async (input, callback) => {
    const usernameRaw =
      typeof input === 'string'
        ? input
        : input && typeof input.username === 'string'
          ? input.username
          : '';

    const silent = !!(input && typeof input === 'object' && input.silent);
    const avatarSeed =
      input && typeof input === 'object' && typeof input.avatarSeed === 'string'
        ? input.avatarSeed.trim()
        : usernameRaw.trim();

    if (!usernameRaw) {
      if (callback) callback({ error: 'Invalid username' });
      return;
    }

    const username = usernameRaw.trim();
    if (!username) {
      if (callback) callback({ error: 'Username cannot be empty' });
      return;
    }

    onlineUsers.set(socket.id, username);
    userSockets.set(username, socket.id);
    socketRooms.set(socket.id, 'public');
    socket.join('public');

    await User.updateOne(
      { username },
      { $set: { username, avatarSeed, lastSeen: new Date() } },
      { upsert: true }
    );

    // Load last 50 messages (public room)
    try {
      const recent = await Message.find({ room: 'public', to: 'all' })
        .sort({ timestamp: -1 })
        .limit(50)
        .lean();

      const ordered = recent.reverse();
      socket.emit('chat_history', ordered);
    } catch (err) {
      console.error('Error loading messages:', err.message);
      socket.emit('error_message', 'Failed to load chat history.');
    }

    if (!silent) {
      const joinMessage = {
        user: 'System',
        text: `${username} joined the chat`,
        to: 'all',
        timestamp: new Date().toISOString()
      };
      io.emit('system_message', joinMessage);
    }

    await emitOnlineUsers();

    if (callback) callback({ success: true, username });
  });

  socket.on('rooms:list', (callback) => {
    callback && callback({ rooms: defaultRooms });
  });

  socket.on('room:join', async (payload, callback) => {
    const username = onlineUsers.get(socket.id);
    if (!username) return callback && callback({ error: 'User not joined' });

    const room = payload && payload.room ? String(payload.room).trim().toLowerCase() : 'public';
    if (!room) return callback && callback({ error: 'Invalid room' });

    const prev = socketRooms.get(socket.id) || 'public';
    socket.leave(prev);
    socket.join(room);
    socketRooms.set(socket.id, room);

    try {
      const recent = await Message.find({ room, to: 'all' })
        .sort({ timestamp: -1 })
        .limit(50)
        .lean();
      socket.emit('chat_history', recent.reverse());
      callback && callback({ success: true, room });
    } catch (e) {
      callback && callback({ error: 'Failed to load room history' });
    }
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
      const room = payload && payload.room ? String(payload.room).trim().toLowerCase() : null;
      const file = payload && payload.file ? payload.file : null;

      const fileUrl = file && file.url ? String(file.url) : null;
      const fileName = file && file.name ? String(file.name) : null;
      const fileType = file && file.type ? String(file.type) : null;

      if (!text && !fileUrl) {
        if (callback) callback({ error: 'Message must have text or file' });
        return;
      }

      if (!to) to = 'all';

      const messageDoc = await Message.create({
        user: fromUser,
        room: to === 'all' ? (room || socketRooms.get(socket.id) || 'public') : 'dm',
        text,
        to,
        fileUrl,
        fileName,
        fileType
      });

      const message = {
        _id: messageDoc._id.toString(),
        user: messageDoc.user,
        room: messageDoc.room,
        text: messageDoc.text,
        to: messageDoc.to,
        timestamp: messageDoc.timestamp,
        fileUrl: messageDoc.fileUrl,
        fileName: messageDoc.fileName,
        fileType: messageDoc.fileType,
        reactions: messageDoc.reactions || [],
        dmStatus: messageDoc.dmStatus || { deliveredAt: null, seenAt: null }
      };

      if (to === 'all') {
        io.to(message.room).emit('chat_message', message);
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

  socket.on('message:delivered', async (payload) => {
    const me = onlineUsers.get(socket.id);
    if (!me) return;
    const messageId = payload && payload.messageId ? String(payload.messageId) : '';
    if (!messageId) return;
    const doc = await Message.findById(messageId);
    if (!doc) return;
    if (doc.to !== me) return;
    if (!doc.dmStatus) doc.dmStatus = {};
    if (!doc.dmStatus.deliveredAt) {
      doc.dmStatus.deliveredAt = new Date();
      await doc.save();
      const senderSock = userSockets.get(doc.user);
      if (senderSock) {
        io.to(senderSock).emit('message:status', {
          messageId: doc._id.toString(),
          dmStatus: doc.dmStatus
        });
      }
    }
  });

  socket.on('message:seen', async (payload) => {
    const me = onlineUsers.get(socket.id);
    if (!me) return;
    const ids = payload && Array.isArray(payload.messageIds) ? payload.messageIds.map(String) : [];
    if (ids.length === 0) return;
    const docs = await Message.find({ _id: { $in: ids }, to: me });
    const now = new Date();
    for (const doc of docs) {
      if (!doc.dmStatus) doc.dmStatus = {};
      if (!doc.dmStatus.seenAt) {
        doc.dmStatus.seenAt = now;
        if (!doc.dmStatus.deliveredAt) doc.dmStatus.deliveredAt = now;
        await doc.save();
        const senderSock = userSockets.get(doc.user);
        if (senderSock) {
          io.to(senderSock).emit('message:status', {
            messageId: doc._id.toString(),
            dmStatus: doc.dmStatus
          });
        }
      }
    }
  });

  // Stories
  socket.on('story:list', async (callback) => {
    const now = new Date();
    const stories = await Story.find({ expiresAt: { $gt: now } })
      .sort({ timestamp: -1 })
      .lean();
    callback && callback({ stories });
  });

  socket.on('story:add', async (payload, callback) => {
    const me = onlineUsers.get(socket.id);
    if (!me) return callback && callback({ error: 'User not joined' });
    const text = payload && payload.text ? String(payload.text).trim() : '';
    const fileUrl = payload && payload.fileUrl ? String(payload.fileUrl) : null;
    const fileType = payload && payload.fileType ? String(payload.fileType) : null;
    if (!text && !fileUrl) return callback && callback({ error: 'Story must have text or file' });

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const story = await Story.create({ user: me, text, fileUrl, fileType, expiresAt });
    io.emit('story:new', story.toObject());
    callback && callback({ success: true });
  });

  socket.on('story:view', async (payload) => {
    const me = onlineUsers.get(socket.id);
    if (!me) return;
    const storyId = payload && payload.storyId ? String(payload.storyId) : '';
    if (!storyId) return;
    await Story.updateOne({ _id: storyId }, { $addToSet: { viewers: me } });
  });

  // Reactions (toggle)
  socket.on('message:react', async (payload, callback) => {
    try {
      const fromUser = onlineUsers.get(socket.id);
      if (!fromUser) return callback && callback({ error: 'User not joined' });

      const messageId = payload && payload.messageId ? String(payload.messageId) : '';
      const emoji = payload && payload.emoji ? String(payload.emoji).trim() : '';

      const allowed = new Set(['👍', '❤️', '😂', '🔥', '🎉', '😮']);
      if (!messageId || !emoji || !allowed.has(emoji)) {
        return callback && callback({ error: 'Invalid reaction' });
      }

      const doc = await Message.findById(messageId);
      if (!doc) return callback && callback({ error: 'Message not found' });

      const existingIdx = (doc.reactions || []).findIndex(
        (r) => r.emoji === emoji && r.user === fromUser
      );

      if (existingIdx >= 0) {
        doc.reactions.splice(existingIdx, 1);
      } else {
        doc.reactions.push({ emoji, user: fromUser });
      }

      await doc.save();

      const updated = {
        messageId: doc._id.toString(),
        reactions: doc.reactions || []
      };

      if (doc.to === 'all') {
        io.emit('message:reactions', updated);
      } else {
        const a = doc.user;
        const b = doc.to;
        const sockA = userSockets.get(a);
        const sockB = userSockets.get(b);
        if (sockA) io.to(sockA).emit('message:reactions', updated);
        if (sockB && sockB !== sockA) io.to(sockB).emit('message:reactions', updated);
      }

      callback && callback({ success: true });
    } catch (err) {
      console.error('message:react error:', err.message);
      callback && callback({ error: 'Failed to react' });
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
      User.updateOne({ username }, { $set: { lastSeen: new Date() } }).catch(() => {});
      const peer = clearCallPair(username);
      if (peer) {
        const peerSocketId = userSockets.get(peer);
        if (peerSocketId) {
          io.to(peerSocketId).emit('call:ended', { from: username, reason: 'disconnect' });
        }
      }

      onlineUsers.delete(socket.id);
      userSockets.delete(username);
      socketRooms.delete(socket.id);

      const leaveMessage = {
        user: 'System',
        text: `${username} left the chat`,
        to: 'all',
        timestamp: new Date().toISOString()
      };
      io.emit('system_message', leaveMessage);
      emitOnlineUsers().catch(() => {});
    }
    console.log('Client disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

