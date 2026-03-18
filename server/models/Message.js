const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema(
  {
    user: {
      type: String,
      required: true,
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
    }
  },
  {
    timestamps: { createdAt: 'timestamp', updatedAt: false }
  }
);

module.exports = mongoose.model('Message', MessageSchema);

