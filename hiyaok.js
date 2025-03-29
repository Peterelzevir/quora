// index.js - Main bot file
const { Telegraf, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const config = require('./config');
const { User, Order, RedeemCode } = require('./models');

// Initialize bot
const bot = new Telegraf(config.botToken);

// Connect to MongoDB
mongoose.connect(config.mongoUri)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Handle code text input
bot.on('text', async (ctx) => {
  // Skip if not in redeem mode
  if (ctx.session.redeemState !== 'waiting_for_code') {
    return;
  }
  
  await deletePrevMessage(ctx);
  
  const code = ctx.message.text.trim();
  
  // Delete user message with code
  await ctx.deleteMessage(ctx.message.message_id);
  
  // Check if code exists
  const redeemCode = await RedeemCode.findOne({ code });
  
  if (!redeemCode) {
    const message = await ctx.reply(
      `❌ *Invalid Code*\n\n` +
      `The code you entered is not valid. Please check and try again.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Try Again', callback_data: 'redeem_code' }],
            [{ text: '🔙 Back to Menu', callback_data: 'user_menu' }]
          ]
        }
      }
    );
    
    ctx.session.lastBotMessageId = message.message_id;
    return;
  }
  
  // Check if code is already used
  if (redeemCode.isUsed) {
    const message = await ctx.reply(
      `❌ *Code Already Used*\n\n` +
      `This code has already been redeemed.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Try Again', callback_data: 'redeem_code' }],
            [{ text: '🔙 Back to Menu', callback_data: 'user_menu' }]
          ]
        }
      }
    );
    
    ctx.session.lastBotMessageId = message.message_id;
    return;
  }
  
  // Add link limit to user
  const userId = ctx.from.id.toString();
  const user = await User.findOne({ userId });
  
  user.linkLimit += redeemCode.amount;
  await user.save();
  
  // Mark code as used
  redeemCode.isUsed = true;
  redeemCode.usedBy = userId;
  redeemCode.usedAt = new Date();
  await redeemCode.save();
  
  const message = await ctx.reply(
    `✅ *Code Redeemed Successfully!*\n\n` +
    `Added ${redeemCode.amount} links to your account.\n\n` +
    `Your new link limit: ${user.linkLimit} links`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🛒 Place an Order', callback_data: 'order' }],
          [{ text: '🔙 Back to Menu', callback_data: 'user_menu' }]
        ]
      }
    }
  );
  
  ctx.session.lastBotMessageId = message.message_id;
});

// Handle file (document) for redeem code
bot.on('document', async (ctx) => {
  // Skip if not in redeem mode
  if (ctx.session.redeemState !== 'waiting_for_code') {
    return;
  }
  
  await deletePrevMessage(ctx);
  
  // Get file link
  const fileId = ctx.message.document.file_id;
  const fileLink = await ctx.telegram.getFileLink(fileId);
  
  try {
    // Download file
    const response = await axios.get(fileLink.href);
    const fileContent = response.data;
    
    // Extract code from file (assuming format contains "REDEEM CODE: XXXX")
    const codeMatch = fileContent.match(/REDEEM CODE: ([a-zA-Z0-9]+)/);
    
    if (!codeMatch || !codeMatch[1]) {
      const message = await ctx.reply(
        `❌ *Invalid File Format*\n\n` +
        `Could not find a valid redeem code in the file.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Try Again', callback_data: 'redeem_code' }],
              [{ text: '🔙 Back to Menu', callback_data: 'user_menu' }]
            ]
          }
        }
      );
      
      ctx.session.lastBotMessageId = message.message_id;
      return;
    }
    
    const code = codeMatch[1];
    
    // Check if code exists
    const redeemCode = await RedeemCode.findOne({ code });
    
    if (!redeemCode) {
      const message = await ctx.reply(
        `❌ *Invalid Code*\n\n` +
        `The code in the file is not valid. Please check and try again.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Try Again', callback_data: 'redeem_code' }],
              [{ text: '🔙 Back to Menu', callback_data: 'user_menu' }]
            ]
          }
        }
      );
      
      ctx.session.lastBotMessageId = message.message_id;
      return;
    }
    
    // Check if code is already used
    if (redeemCode.isUsed) {
      const message = await ctx.reply(
        `❌ *Code Already Used*\n\n` +
        `This code has already been redeemed.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Try Again', callback_data: 'redeem_code' }],
              [{ text: '🔙 Back to Menu', callback_data: 'user_menu' }]
            ]
          }
        }
      );
      
      ctx.session.lastBotMessageId = message.message_id;
      return;
    }
    
    // Add link limit to user
    const userId = ctx.from.id.toString();
    const user = await User.findOne({ userId });
    
    user.linkLimit += redeemCode.amount;
    await user.save();
    
    // Mark code as used
    redeemCode.isUsed = true;
    redeemCode.usedBy = userId;
    redeemCode.usedAt = new Date();
    await redeemCode.save();
    
    const message = await ctx.reply(
      `✅ *Code Redeemed Successfully!*\n\n` +
      `Added ${redeemCode.amount} links to your account.\n\n` +
      `Your new link limit: ${user.linkLimit} links`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛒 Place an Order', callback_data: 'order' }],
            [{ text: '🔙 Back to Menu', callback_data: 'user_menu' }]
          ]
        }
      }
    );
    
    ctx.session.lastBotMessageId = message.message_id;
    
  } catch (error) {
    console.error('Error processing file:', error);
    
    const message = await ctx.reply(
      `❌ *Error Processing File*\n\n` +
      `Could not process the file. Please try again or enter the code manually.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Try Again', callback_data: 'redeem_code' }],
            [{ text: '🔙 Back to Menu', callback_data: 'user_menu' }]
          ]
        }
      }
    );
    
    ctx.session.lastBotMessageId = message.message_id;
  }
});

// Order History
bot.action('order_history', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePrevMessage(ctx);
  
  const userId = ctx.from.id.toString();
  const orders = await Order.find({ userId }).sort({ createdAt: -1 }).limit(10);
  
  if (orders.length === 0) {
    const message = await ctx.reply(
      `*Order History* 📚\n\n` +
      `You haven't placed any orders yet.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛒 Place an Order', callback_data: 'order' }],
            [{ text: '🔙 Back to Menu', callback_data: 'user_menu' }]
          ]
        }
      }
    );
    
    ctx.session.lastBotMessageId = message.message_id;
    return;
  }
  
  // Create history message
  let historyMessage = `*Order History* 📚\n\n`;
  historyMessage += `Your last ${orders.length} orders:\n\n`;
  
  // If too many orders, prepare a file
  if (orders.length > 5) {
    // Create a file with all orders
    let fileContent = `Order History for ${ctx.from.username || ctx.from.first_name}\n`;
    fileContent += `Generated on ${new Date().toLocaleString()}\n\n`;
    
    orders.forEach((order, index) => {
      fileContent += `Order ${index + 1}:\n`;
      fileContent += `Date: ${order.createdAt.toLocaleString()}\n`;
      fileContent += `Link: ${order.link}\n`;
      fileContent += `Status: ${order.status}\n`;
      
      if (order.followersOrderId) {
        fileContent += `Followers Order ID: ${order.followersOrderId}\n`;
      }
      
      if (order.likesOrderId) {
        fileContent += `Likes Order ID: ${order.likesOrderId}\n`;
      }
      
      fileContent += `\n`;
    });
    
    // Create file
    const fileName = `order_history_${userId}.txt`;
    fs.writeFileSync(fileName, fileContent);
    
    // Send file with inline buttons for each order
    await ctx.replyWithDocument({ source: fileName }, {
      caption: `Your complete order history is in this file.\nClick the buttons below to check specific order status:`,
      reply_markup: {
        inline_keyboard: [
          ...orders.slice(0, 5).map((order, index) => [
            { 
              text: `Order #${index + 1} (${order.status})`, 
              callback_data: `check_order_${order._id}` 
            }
          ]),
          [{ text: '🔙 Back to Menu', callback_data: 'user_menu' }]
        ]
      }
    });
    
    // Delete file
    fs.unlinkSync(fileName);
    
  } else {
    // Show orders directly in message
    orders.forEach((order, index) => {
      historyMessage += `*Order #${index + 1}*\n`;
      historyMessage += `Date: ${order.createdAt.toLocaleString()}\n`;
      historyMessage += `Link: ${order.link.substring(0, 30)}...\n`;
      historyMessage += `Status: ${order.status}\n\n`;
    });
    
    const message = await ctx.reply(
      historyMessage,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            ...orders.map((order, index) => [
              { 
                text: `Check Status #${index + 1}`, 
                callback_data: `check_order_${order._id}` 
              }
            ]),
            [{ text: '🔙 Back to Menu', callback_data: 'user_menu' }]
          ]
        }
      }
    );
    
    ctx.session.lastBotMessageId = message.message_id;
  }
});

// Check specific order status
bot.action(/check_order_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  await deletePrevMessage(ctx);
  
  const orderId = ctx.match[1];
  
  try {
    const order = await Order.findById(orderId);
    
    if (!order) {
      const message = await ctx.reply(
        `❌ Order not found.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Back to History', callback_data: 'order_history' }]
            ]
          }
        }
      );
      
      ctx.session.lastBotMessageId = message.message_id;
      return;
    }
    
    // Message with order details
    let statusMessage = `*Order Details* 📋\n\n`;
    statusMessage += `Date: ${order.createdAt.toLocaleString()}\n`;
    statusMessage += `Link: ${order.link}\n`;
    statusMessage += `Current Status: ${order.status}\n\n`;
    
    // Check status from API if we have order IDs
    if (order.followersOrderId || order.likesOrderId) {
      statusMessage += `Checking current status from server...\n\n`;
      
      const message = await ctx.reply(
        statusMessage,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Refreshing...', callback_data: 'refreshing' }]
            ]
          }
        }
      );
      
      ctx.session.lastBotMessageId = message.message_id;
      
      // Check followers status
      if (order.followersOrderId) {
        try {
          const followersResponse = await axios.post(config.apiUrl, {
            api_key: config.apiKey,
            action: 'status',
            secret_key: config.secretKey,
            id: order.followersOrderId
          });
          
          if (followersResponse.data.status) {
            statusMessage += `*Followers Status:* ${followersResponse.data.data.status}\n`;
            
            if (followersResponse.data.data.start_count) {
              statusMessage += `Start Count: ${followersResponse.data.data.start_count}\n`;
            }
            
            if (followersResponse.data.data.remains !== undefined) {
              statusMessage += `Remains: ${followersResponse.data.data.remains}\n`;
            }
            
            statusMessage += `\n`;
          }
        } catch (error) {
          statusMessage += `Could not fetch followers status.\n\n`;
        }
      }
      
      // Check likes status
      if (order.likesOrderId) {
        try {
          const likesResponse = await axios.post(config.apiUrl, {
            api_key: config.apiKey,
            action: 'status',
            secret_key: config.secretKey,
            id: order.likesOrderId
          });
          
          if (likesResponse.data.status) {
            statusMessage += `*Likes Status:* ${likesResponse.data.data.status}\n`;
            
            if (likesResponse.data.data.start_count) {
              statusMessage += `Start Count: ${likesResponse.data.data.start_count}\n`;
            }
            
            if (likesResponse.data.data.remains !== undefined) {
              statusMessage += `Remains: ${likesResponse.data.data.remains}\n`;
            }
          }
        } catch (error) {
          statusMessage += `Could not fetch likes status.\n`;
        }
      }
      
      // Update message with status
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        message.message_id,
        null,
        statusMessage,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Refresh Status', callback_data: `check_order_${orderId}` }],
              [{ text: '🔙 Back to History', callback_data: 'order_history' }]
            ]
          }
        }
      );
      
    } else {
      // No order IDs available
      statusMessage += `No external order IDs available for this order.`;
      
      const message = await ctx.reply(
        statusMessage,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Back to History', callback_data: 'order_history' }]
            ]
          }
        }
      );
      
      ctx.session.lastBotMessageId = message.message_id;
    }
    
  } catch (error) {
    console.error('Error checking order status:', error);
    
    const message = await ctx.reply(
      `❌ Error checking order status. Please try again later.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to History', callback_data: 'order_history' }]
          ]
        }
      }
    );
    
    ctx.session.lastBotMessageId = message.message_id;
  }
});

// Handle refreshing action (do nothing)
bot.action('refreshing', (ctx) => {
  ctx.answerCbQuery('Refreshing status...');
});

// Error handler
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
  
  ctx.reply(
    `❌ An error occurred while processing your request.\n\n` +
    `Please try again or contact admin: ${config.contactAdmin}`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Back to Main Menu', callback_data: 'back_to_main' }],
          [{ text: '👨‍💼 Contact Admin', url: config.contactAdminUrl }]
        ]
      }
    }
  );
});

// Start bot
bot.launch()
  .then(() => {
    console.log('Bot started successfully!');
  })
  .catch(err => {
    console.error('Error starting bot:', err);
  });

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Middleware
bot.use(session());

// Check if user exists in DB, if not create new user
bot.use(async (ctx, next) => {
  if (ctx.from) {
    const userId = ctx.from.id.toString();
    let user = await User.findOne({ userId });
    
    if (!user) {
      user = new User({
        userId,
        username: ctx.from.username || 'NoUsername',
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        linkLimit: 0,
        createdAt: new Date()
      });
      await user.save();
    }
  }
  return next();
});

// Helper function to check if user is admin
const isAdmin = (userId) => {
  return config.adminId.includes(userId.toString());
};

// Delete previous message
const deletePrevMessage = async (ctx) => {
  if (ctx.session && ctx.session.lastBotMessageId) {
    try {
      await ctx.deleteMessage(ctx.session.lastBotMessageId);
    } catch (error) {
      console.log('Error deleting message:', error);
    }
  }
};

// Start command
bot.start(async (ctx) => {
  await deletePrevMessage(ctx);
  
  const userId = ctx.from.id.toString();
  const user = await User.findOne({ userId });
  const isUserAdmin = isAdmin(userId);
  
  let keyboard;
  
  if (isUserAdmin) {
    keyboard = {
      inline_keyboard: [
        [{ text: '👥 User Menu', callback_data: 'user_menu' }],
        [{ text: '👑 Admin Menu', callback_data: 'admin_menu' }]
      ]
    };
  } else {
    keyboard = {
      inline_keyboard: [
        [{ text: '🛒 Order', callback_data: 'order' }, { text: '💰 Check Limit', callback_data: 'check_limit' }],
        [{ text: '📚 Order History', callback_data: 'order_history' }, { text: '🎟️ Redeem Code', callback_data: 'redeem_code' }],
        [{ text: '👨‍💼 Contact Admin', url: config.contactAdminUrl }]
      ]
    };
  }
  
  const message = await ctx.reply(
    `*Welcome to Auto Order Bot* 🤖\n\n` +
    `Hello ${ctx.from.first_name}! ${isUserAdmin ? '(Admin)' : ''}\n` +
    `Your current link limit: *${user.linkLimit}*\n\n` +
    `Choose an option below:`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }
  );
  
  ctx.session.lastBotMessageId = message.message_id;
});

// Admin Menu
bot.action('admin_menu', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return await ctx.answerCbQuery('You are not authorized to access admin menu.');
  }
  
  await ctx.answerCbQuery();
  await deletePrevMessage(ctx);
  
  const keyboard = {
    inline_keyboard: [
      [{ text: '➕ Add Code', callback_data: 'add_code' }],
      [{ text: '👥 Check User Limits', callback_data: 'check_user_limits' }],
      [{ text: '🔙 Back to Main Menu', callback_data: 'back_to_main' }]
    ]
  };
  
  const message = await ctx.reply(
    `*Admin Menu* 👑\n\n` +
    `Select an admin action:`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }
  );
  
  ctx.session.lastBotMessageId = message.message_id;
});

// User Menu
bot.action('user_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePrevMessage(ctx);
  
  const userId = ctx.from.id.toString();
  const user = await User.findOne({ userId });
  
  const keyboard = {
    inline_keyboard: [
      [{ text: '🛒 Order', callback_data: 'order' }, { text: '💰 Check Limit', callback_data: 'check_limit' }],
      [{ text: '📚 Order History', callback_data: 'order_history' }, { text: '🎟️ Redeem Code', callback_data: 'redeem_code' }],
      [{ text: '👨‍💼 Contact Admin', url: config.contactAdminUrl }],
      [{ text: '🔙 Back to Main Menu', callback_data: 'back_to_main' }]
    ]
  };
  
  const message = await ctx.reply(
    `*User Menu* 👤\n\n` +
    `Your current link limit: *${user.linkLimit}*\n\n` +
    `Choose an option:`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }
  );
  
  ctx.session.lastBotMessageId = message.message_id;
});

// Back to main menu
bot.action('back_to_main', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session = {};
  await ctx.deleteMessage();
  await ctx.command('start');
});

// Add Code (Admin)
bot.action('add_code', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return await ctx.answerCbQuery('You are not authorized.');
  }
  
  await ctx.answerCbQuery();
  await deletePrevMessage(ctx);
  
  ctx.session.adminAction = 'add_code';
  
  const message = await ctx.reply(
    `*Add Code* 🎟️\n\n` +
    `Please enter the code amount in this format:\n` +
    `\`add_code <amount>\`\n\n` +
    `Example: \`add_code 10\``,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Admin Menu', callback_data: 'admin_menu' }]
        ]
      }
    }
  );
  
  ctx.session.lastBotMessageId = message.message_id;
});

// Handle add_code text input
bot.hears(/^add_code (\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id) || ctx.session.adminAction !== 'add_code') {
    return;
  }
  
  await deletePrevMessage(ctx);
  await ctx.deleteMessage();
  
  const amount = parseInt(ctx.match[1]);
  
  if (isNaN(amount) || amount <= 0) {
    const message = await ctx.reply(
      `❌ Invalid amount. Please enter a valid positive number.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Admin Menu', callback_data: 'admin_menu' }]
          ]
        }
      }
    );
    ctx.session.lastBotMessageId = message.message_id;
    return;
  }
  
  // Generate unique code
  const code = crypto.randomBytes(16).toString('hex');
  
  // Create redeem code in database
  const redeemCode = new RedeemCode({
    code,
    amount,
    createdBy: ctx.from.id.toString(),
    isUsed: false,
    createdAt: new Date()
  });
  
  await redeemCode.save();
  
  // Create file with code
  const fileName = `code_${code}.txt`;
  const fileContent = `REDEEM CODE: ${code}\nAmount: ${amount} links\nGenerated by: ${ctx.from.username || ctx.from.first_name}\nDate: ${new Date().toLocaleString()}\n\nTo redeem this code, send it to the bot using the "Redeem Code" option.`;
  
  fs.writeFileSync(fileName, fileContent);
  
  // Send file to admin
  await ctx.replyWithDocument({ source: fileName }, {
    caption: `✅ Code generated successfully!\n\nAmount: ${amount} links\nCode: ||${code}||\n\nThis file can be shared with users.`,
    parse_mode: 'MarkdownV2'
  });
  
  // Delete temporary file
  fs.unlinkSync(fileName);
  
  const message = await ctx.reply(
    `✅ Code added successfully!`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Admin Menu', callback_data: 'admin_menu' }]
        ]
      }
    }
  );
  
  ctx.session.lastBotMessageId = message.message_id;
});

// Check User Limits (Admin)
bot.action('check_user_limits', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return await ctx.answerCbQuery('You are not authorized.');
  }
  
  await ctx.answerCbQuery();
  await deletePrevMessage(ctx);
  
  const users = await User.find().sort({ linkLimit: -1 });
  
  let message = `*User Limits* 📊\n\n`;
  
  if (users.length === 0) {
    message += `No users found.`;
  } else {
    users.forEach((user, index) => {
      message += `${index + 1}. ${user.username || user.firstName} - ${user.linkLimit} links\n`;
    });
  }
  
  const sentMessage = await ctx.reply(
    message,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Admin Menu', callback_data: 'admin_menu' }]
        ]
      }
    }
  );
  
  ctx.session.lastBotMessageId = sentMessage.message_id;
});

// Check Limit (User)
bot.action('check_limit', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePrevMessage(ctx);
  
  const userId = ctx.from.id.toString();
  const user = await User.findOne({ userId });
  
  const message = await ctx.reply(
    `*Your Link Limit* 💰\n\n` +
    `Current limit: *${user.linkLimit} links*\n\n` +
    `Each link order requires 1 limit.\n` +
    `Need more limits? Redeem a code or contact admin: ${config.contactAdmin}`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎟️ Redeem Code', callback_data: 'redeem_code' }],
          [{ text: '👨‍💼 Contact Admin', url: config.contactAdminUrl }],
          [{ text: '🔙 Back', callback_data: 'user_menu' }]
        ]
      }
    }
  );
  
  ctx.session.lastBotMessageId = message.message_id;
});

// Order
bot.action('order', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePrevMessage(ctx);
  
  const userId = ctx.from.id.toString();
  const user = await User.findOne({ userId });
  
  if (user.linkLimit <= 0) {
    const message = await ctx.reply(
      `❌ *Insufficient Link Limit*\n\n` +
      `You don't have enough link limit to place an order.\n` +
      `Current limit: *0 links*\n\n` +
      `Please redeem a code or contact admin: ${config.contactAdmin}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎟️ Redeem Code', callback_data: 'redeem_code' }],
            [{ text: '👨‍💼 Contact Admin', url: config.contactAdminUrl }],
            [{ text: '🔙 Back', callback_data: 'user_menu' }]
          ]
        }
      }
    );
    
    ctx.session.lastBotMessageId = message.message_id;
    return;
  }
  
  // Verify service IDs are available
  try {
    const response = await axios.post(config.apiUrl, {
      api_key: config.apiKey,
      action: 'services',
      secret_key: config.secretKey
    });
    
    if (!response.data.status) {
      throw new Error('API returned error');
    }
    
    const services = response.data.data;
    
    // Check if service IDs exist and prices are within limits
    const followersService = services.find(s => s.id.toString() === config.serviceIds.followers);
    const likesService = services.find(s => s.id.toString() === config.serviceIds.likes);
    
    if (!followersService) {
      throw new Error(`Service ID ${config.serviceIds.followers} not found`);
    }
    
    if (!likesService) {
      throw new Error(`Service ID ${config.serviceIds.likes} not found`);
    }
    
    if (followersService.price > config.maxPrice.followers) {
      throw new Error(`Service ${config.serviceIds.followers} price exceeds limit`);
    }
    
    if (likesService.price > config.maxPrice.likes) {
      throw new Error(`Service ${config.serviceIds.likes} price exceeds limit`);
    }
  } catch (error) {
    console.error('Error verifying services:', error);
    
    const message = await ctx.reply(
      `❌ *Service Error*\n\n` +
      `Unable to verify services at the moment. Please try again later or contact admin.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Try Again', callback_data: 'order' }],
            [{ text: '👨‍💼 Contact Admin', url: config.contactAdminUrl }],
            [{ text: '🔙 Back', callback_data: 'user_menu' }]
          ]
        }
      }
    );
    
    ctx.session.lastBotMessageId = message.message_id;
    return;
  }
  
  ctx.session.orderState = 'waiting_for_links';
  
  const message = await ctx.reply(
    `*New Order* 🛒\n\n` +
    `Your current limit: *${user.linkLimit} links*\n\n` +
    `Please send your Instagram links.\n` +
    `Each link will require 1 limit.\n\n` +
    `You can send multiple links - one per line, like this:\n` +
    `https://instagram.com/...\n` +
    `https://instagram.com/...\n\n` +
    `*Note:* Maximum ${user.linkLimit} links allowed.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '❌ Cancel', callback_data: 'cancel_order' }]
        ]
      }
    }
  );
  
  ctx.session.lastBotMessageId = message.message_id;
});

// Cancel Order
bot.action('cancel_order', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePrevMessage(ctx);
  
  delete ctx.session.orderState;
  delete ctx.session.orderLinks;
  
  const message = await ctx.reply(
    `✅ Order canceled.`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Menu', callback_data: 'user_menu' }]
        ]
      }
    }
  );
  
  ctx.session.lastBotMessageId = message.message_id;
});

// Handle links input
bot.on('text', async (ctx) => {
  if (ctx.session.orderState !== 'waiting_for_links') {
    return;
  }
  
  await deletePrevMessage(ctx);
  
  const text = ctx.message.text.trim();
  const links = text.split('\n').map(link => link.trim()).filter(link => link.startsWith('http'));
  
  if (links.length === 0) {
    const message = await ctx.reply(
      `❌ *No valid links found*\n\n` +
      `Please send valid Instagram links, each starting with http or https.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Cancel', callback_data: 'cancel_order' }]
          ]
        }
      }
    );
    
    ctx.session.lastBotMessageId = message.message_id;
    return;
  }
  
  const userId = ctx.from.id.toString();
  const user = await User.findOne({ userId });
  
  if (links.length > user.linkLimit) {
    const message = await ctx.reply(
      `❌ *Too many links*\n\n` +
      `You sent ${links.length} links but your current limit is only ${user.linkLimit} links.\n\n` +
      `Please send fewer links or contact admin to increase your limit.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Try Again', callback_data: 'order' }],
            [{ text: '👨‍💼 Contact Admin', url: config.contactAdminUrl }],
            [{ text: '❌ Cancel', callback_data: 'cancel_order' }]
          ]
        }
      }
    );
    
    ctx.session.lastBotMessageId = message.message_id;
    return;
  }
  
  // Store links in session
  ctx.session.orderLinks = links;
  ctx.session.orderState = 'confirm_order';
  
  // Delete user message with links
  await ctx.deleteMessage(ctx.message.message_id);
  
  let linksText = '';
  links.forEach((link, index) => {
    linksText += `${index + 1}. ${link}\n`;
  });
  
  const message = await ctx.reply(
    `*Order Confirmation* 🛒\n\n` +
    `You are about to order services for ${links.length} links:\n\n` +
    `${linksText}\n` +
    `This will use ${links.length} of your link limits.\n` +
    `Current limit: ${user.linkLimit} links\n` +
    `After order: ${user.linkLimit - links.length} links\n\n` +
    `Services that will be ordered for each link:\n` +
    `- Followers: ${config.serviceQuantity.followers}\n` +
    `- Likes: ${config.serviceQuantity.likes}\n\n` +
    `Would you like to proceed?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Confirm Order', callback_data: 'confirm_order' }],
          [{ text: '❌ Cancel', callback_data: 'cancel_order' }]
        ]
      }
    }
  );
  
  ctx.session.lastBotMessageId = message.message_id;
});

// Confirm Order
bot.action('confirm_order', async (ctx) => {
  await ctx.answerCbQuery();
  
  if (ctx.session.orderState !== 'confirm_order' || !ctx.session.orderLinks) {
    return await ctx.reply('Order session expired. Please start a new order.');
  }
  
  await deletePrevMessage(ctx);
  
  const userId = ctx.from.id.toString();
  const user = await User.findOne({ userId });
  const links = ctx.session.orderLinks;
  
  // Final confirmation
  ctx.session.orderState = 'final_confirm';
  
  const message = await ctx.reply(
    `*Final Confirmation* ⚠️\n\n` +
    `You're about to place an order for ${links.length} links.\n\n` +
    `❗ *IMPORTANT* ❗\n` +
    `This action cannot be undone once confirmed.\n\n` +
    `Are you 100% sure you want to proceed?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Yes, I\'m 100% sure', callback_data: 'final_confirm' }],
          [{ text: '❌ No, cancel', callback_data: 'cancel_order' }]
        ]
      }
    }
  );
  
  ctx.session.lastBotMessageId = message.message_id;
});

// Final Confirmation and Process Order
bot.action('final_confirm', async (ctx) => {
  await ctx.answerCbQuery();
  
  if (ctx.session.orderState !== 'final_confirm' || !ctx.session.orderLinks) {
    return await ctx.reply('Order session expired. Please start a new order.');
  }
  
  await deletePrevMessage(ctx);
  
  const userId = ctx.from.id.toString();
  const user = await User.findOne({ userId });
  const links = ctx.session.orderLinks;
  
  // Check limit one more time
  if (links.length > user.linkLimit) {
    const message = await ctx.reply(
      `❌ *Insufficient link limit*\n\n` +
      `Your link limit has changed during the order process.\n` +
      `Required: ${links.length}\n` +
      `Available: ${user.linkLimit}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Menu', callback_data: 'user_menu' }]
          ]
        }
      }
    );
    
    ctx.session.lastBotMessageId = message.message_id;
    return;
  }
  
  // Processing message
  const processingMsg = await ctx.reply(
    `🔄 *Processing Order*\n\n` +
    `Please wait while we process your ${links.length} links...`,
    { parse_mode: 'Markdown' }
  );
  
  // Array to store order results
  const orderResults = [];
  let successCount = 0;
  let failedCount = 0;
  
  // Process each link
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    
    try {
      // Create order in our database first
      const newOrder = new Order({
        userId,
        link,
        status: 'Pending',
        createdAt: new Date()
      });
      
      await newOrder.save();
      
      // Order followers
      const followersResponse = await axios.post(config.apiUrl, {
        api_key: config.apiKey,
        action: 'order',
        secret_key: config.secretKey,
        service: config.serviceIds.followers,
        data: link,
        quantity: config.serviceQuantity.followers
      });
      
      // Order likes
      const likesResponse = await axios.post(config.apiUrl, {
        api_key: config.apiKey,
        action: 'order',
        secret_key: config.secretKey,
        service: config.serviceIds.likes,
        data: link,
        quantity: config.serviceQuantity.likes
      });
      
      // Check responses
      if (followersResponse.data.status && likesResponse.data.status) {
        // Update order in database
        newOrder.followersOrderId = followersResponse.data.data.id;
        newOrder.likesOrderId = likesResponse.data.data.id;
        newOrder.status = 'Processing';
        await newOrder.save();
        
        orderResults.push({
          link,
          followers: {
            orderId: followersResponse.data.data.id,
            status: 'Success'
          },
          likes: {
            orderId: likesResponse.data.data.id,
            status: 'Success'
          },
          status: 'Success'
        });
        
        successCount++;
      } else {
        // Something failed
        newOrder.status = 'Error';
        if (followersResponse.data.status) {
          newOrder.followersOrderId = followersResponse.data.data.id;
        }
        if (likesResponse.data.status) {
          newOrder.likesOrderId = likesResponse.data.data.id;
        }
        await newOrder.save();
        
        orderResults.push({
          link,
          status: 'Failed',
          error: 'API returned error'
        });
        
        failedCount++;
      }
      
      // Update processing message to show progress
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        processingMsg.message_id,
        null,
        `🔄 *Processing Order*\n\n` +
        `Progress: ${i + 1}/${links.length} links\n` +
        `✅ Success: ${successCount}\n` +
        `❌ Failed: ${failedCount}`,
        { parse_mode: 'Markdown' }
      );
      
    } catch (error) {
      console.error(`Error processing link ${link}:`, error);
      
      orderResults.push({
        link,
        status: 'Failed',
        error: error.message
      });
      
      failedCount++;
      
      // Update processing message
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        processingMsg.message_id,
        null,
        `🔄 *Processing Order*\n\n` +
        `Progress: ${i + 1}/${links.length} links\n` +
        `✅ Success: ${successCount}\n` +
        `❌ Failed: ${failedCount}`,
        { parse_mode: 'Markdown' }
      );
    }
  }
  
  // Deduct link limit
  user.linkLimit -= successCount;
  await user.save();
  
  // Clear order session
  delete ctx.session.orderState;
  delete ctx.session.orderLinks;
  
  // Delete processing message
  await ctx.deleteMessage(processingMsg.message_id);
  
  // Prepare result message
  let resultMessage = `*Order Completed* ✅\n\n`;
  resultMessage += `Summary:\n`;
  resultMessage += `✅ Successful orders: ${successCount}\n`;
  resultMessage += `❌ Failed orders: ${failedCount}\n\n`;
  
  if (successCount > 0) {
    resultMessage += `Your new link limit: ${user.linkLimit} links\n\n`;
    resultMessage += `You can check order status in Order History.`;
  }
  
  if (failedCount > 0) {
    resultMessage += `\n\nSome orders failed. Please contact admin for assistance.`;
  }
  
  const message = await ctx.reply(
    resultMessage,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📚 View Order History', callback_data: 'order_history' }],
          [{ text: '🔙 Back to Menu', callback_data: 'user_menu' }]
        ]
      }
    }
  );
  
  ctx.session.lastBotMessageId = message.message_id;
});

// Redeem Code
bot.action('redeem_code', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePrevMessage(ctx);
  
  ctx.session.redeemState = 'waiting_for_code';
  
  const message = await ctx.reply(
    `*Redeem Code* 🎟️\n\n` +
    `Please send the code file or enter the code directly.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '❌ Cancel', callback_data: 'cancel_redeem' }]
        ]
      }
    }
  );
  
  ctx.session.lastBotMessageId = message.message_id;
});

// Cancel Redeem
bot.action('cancel_redeem', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePrevMessage(ctx);
  
  delete ctx.session.redeemState;
  
  const message = await ctx.reply(
    `✅ Redeem process canceled.`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Menu', callback_data: 'user_menu' }]
        ]
      }
    }
  );
  
  ctx.session.lastBotMessageId = message.message_id;
});
