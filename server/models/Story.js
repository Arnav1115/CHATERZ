const mongoose = require('mongoose');

const StorySchema = new mongoose.Schema(
  {
    user: { type: String, required: true, trim: true },
    text: { type: String, default: '', trim: true },
    fileUrl: { type: String, default: null, trim: true },
    fileType: { type: String, default: null, trim: true },
    expiresAt: { type: Date, required: true, index: true },
    viewers: { type: [String], default: [] }
  },
  { timestamps: { createdAt: 'timestamp', updatedAt: false } }
);

module.exports = mongoose.model('Story', StorySchema);

