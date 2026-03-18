const mongoose = require('mongoose');

const ReactionSchema = new mongoose.Schema(
  {
    emoji: { type: String, required: true, trim: true },
    user: { type: String, required: true, trim: true }
  },
  { _id: false }
);

const MessageSchema = new mongoose.Schema(
  {
    user: {
      type: String,
      required: true,
      trim: true
    },
    room: {
      type: String,
      default: 'public',
      trim: true
    },
    text: {
      type: String,
      trim: true
    },
    to: {
      type: String,
      default: 'all',
      trim: true
    },
    fileUrl: {
      type: String,
      default: null,
      trim: true
    },
    fileName: {
      type: String,
      default: null,
      trim: true
    },
    fileType: {
      type: String,
      default: null,
      trim: true
    },
    reactions: {
      type: [ReactionSchema],
      default: []
    },
    dmStatus: {
      deliveredAt: { type: Date, default: null },
      seenAt: { type: Date, default: null }
    }
  },
  {
    timestamps: { createdAt: 'timestamp', updatedAt: false }
  }
);

module.exports = mongoose.model('Message', MessageSchema);

