// models.js
const mongoose = require('mongoose');

// User model schema
const userSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },
  username: String,
  firstName: String,
  limit: {
    type: Number,
    default: 0
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Redeem code schema
const redeemCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true
  },
  limit: {
    type: Number,
    required: true
  },
  isRedeemed: {
    type: Boolean,
    default: false
  },
  createdBy: String,
  redeemedBy: String,
  redeemedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Order schema
const orderSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  link: {
    type: String,
    required: true
  },
  service1Id: String,
  service2Id: String,
  order1Id: String,
  order2Id: String,
  status: {
    type: String,
    default: 'Pending',
    enum: ['Pending', 'Processing', 'Partial', 'In progress', 'Error', 'Success']
  },
  quantity1: Number,
  quantity2: Number,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create and export models
const User = mongoose.model('User', userSchema);
const RedeemCode = mongoose.model('RedeemCode', redeemCodeSchema);
const Order = mongoose.model('Order', orderSchema);

module.exports = {
  User,
  RedeemCode,
  Order
};
