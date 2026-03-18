const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    avatarSeed: { type: String, default: '', trim: true },
    lastSeen: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);

