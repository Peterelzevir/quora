// models.js - Database models
const mongoose = require('mongoose');

// User Schema
const userSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },
  username: {
    type: String,
    default: null
  },
  firstName: {
    type: String,
    default: null
  },
  lastName: {
    type: String,
    default: null
  },
  linkLimit: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastActive: {
    type: Date,
    default: Date.now
  }
});

// Order Schema
const orderSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  link: {
    type: String,
    required: true
  },
  followersOrderId: {
    type: String,
    default: null
  },
  likesOrderId: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['Pending', 'Processing', 'Partial', 'In progress', 'Error', 'Success'],
    default: 'Pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the 'updatedAt' field on save
orderSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Redeem Code Schema
const redeemCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true
  },
  amount: {
    type: Number,
    required: true
  },
  createdBy: {
    type: String,
    required: true
  },
  isUsed: {
    type: Boolean,
    default: false
  },
  usedBy: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  usedAt: {
    type: Date,
    default: null
  }
});

// Create models
const User = mongoose.model('User', userSchema);
const Order = mongoose.model('Order', orderSchema);
const RedeemCode = mongoose.model('RedeemCode', redeemCodeSchema);

module.exports = {
  User,
  Order,
  RedeemCode
};
