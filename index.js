// index.js
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const mongoose = require('mongoose');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');
const { User, RedeemCode, Order } = require('./models');

// Initialize bot
const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

// Connect to MongoDB
mongoose.connect(config.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Middleware to check if user exists and create if not
bot.use(async (ctx, next) => {
  try {
    if (ctx.from) {
      const userId = ctx.from.id.toString();
      const user = await User.findOne({ userId });
      
      if (!user) {
        // Use findOneAndUpdate with upsert to prevent duplicate key errors
        await User.findOneAndUpdate(
          { userId },
          {
            username: ctx.from.username || 'unknown',
            firstName: ctx.from.first_name || 'unknown',
            limit: 0,
            isAdmin: ctx.from.username === config.ADMIN_USERNAME
          },
          { upsert: true, new: true }
        );
      }
    }
  } catch (error) {
    console.error('Error in user middleware:', error);
  }
  return next();
});

// Initialize sessions object to store conversation state
const sessions = {};

// Helper to get or create a session
const getSession = (ctx) => {
  const userId = ctx.from.id.toString();
  if (!sessions[userId]) {
    sessions[userId] = {};
  }
  return sessions[userId];
};

// Start command
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = await User.findOne({ userId });
  
  const welcomeMessage = `🌟 *Welcome to Auto Order Bot* 🌟\n\nYour current limit: *${user.limit}* links\n\nSelect an option below:`;
  
  const keyboard = user.isAdmin ? getAdminKeyboard() : getUserKeyboard();
  
  await ctx.replyWithMarkdown(welcomeMessage, keyboard);
});

// Admin keyboards
const getAdminKeyboard = () => {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('👥 User Menu', 'user_menu'),
      Markup.button.callback('👑 Admin Menu', 'admin_menu')
    ]
  ]);
};

const getAdminMenuKeyboard = () => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Add Code', 'add_code')],
    [Markup.button.callback('👁️ Check User Limits', 'check_all_limits')],
    [Markup.button.callback('🔙 Back', 'back_to_main')]
  ]);
};

// User keyboards
const getUserKeyboard = () => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🛒 Order', 'order')],
    [Markup.button.callback('🔢 Check Limit', 'check_limit')],
    [Markup.button.callback('📜 Order History', 'order_history')],
    [Markup.button.callback('🎟️ Redeem Code', 'redeem_code')],
    [Markup.button.callback('👤 Contact Admin', 'contact_admin')]
  ]);
};

// Admin Menu
bot.action('admin_menu', async (ctx) => {
  await ctx.editMessageText('👑 *Admin Menu*\n\nSelect an option:', {
    parse_mode: 'Markdown',
    ...getAdminMenuKeyboard()
  });
});

// User Menu
bot.action('user_menu', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = await User.findOne({ userId });
  
  await ctx.editMessageText(`🌟 *User Menu*\n\nYour current limit: *${user.limit}* links\n\nSelect an option:`, {
    parse_mode: 'Markdown',
    ...getUserKeyboard()
  });
});

// Back to main menu
bot.action('back_to_main', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = await User.findOne({ userId });
  
  const welcomeMessage = `🌟 *Welcome to Auto Order Bot* 🌟\n\nYour current limit: *${user.limit}* links\n\nSelect an option below:`;
  
  const keyboard = user.isAdmin ? getAdminKeyboard() : getUserKeyboard();
  
  await ctx.editMessageText(welcomeMessage, {
    parse_mode: 'Markdown',
    ...keyboard
  });
});

// Add Code (Admin only)
bot.action('add_code', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = await User.findOne({ userId });
  
  if (!user.isAdmin) {
    await ctx.answerCbQuery('You are not authorized to use this feature');
    return;
  }
  
  const session = getSession(ctx);
  session.waitingForCodeAmount = true;
  
  await ctx.editMessageText('➕ *Add Redeem Code*\n\nPlease specify the limit amount for this code:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Cancel', 'back_to_main')]])
  });
});

// Contact admin
bot.action('contact_admin', async (ctx) => {
  await ctx.editMessageText('👤 *Contact Admin*\n\nYou can contact the admin for assistance or to request more limits.', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.url('📞 Chat with Admin', `https://t.me/${config.ADMIN_USERNAME}`)],
      [Markup.button.callback('🔙 Back', 'back_to_main')]
    ])
  });
});

// Redeem code
bot.action('redeem_code', async (ctx) => {
  const session = getSession(ctx);
  session.waitingForRedeemFile = true;
  
  await ctx.editMessageText('🎟️ *Redeem Code*\n\nPlease send the redeem code file you received.', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Cancel', 'back_to_main')]])
  });
});

// Handle text messages
bot.on('text', async (ctx) => {
  const userId = ctx.from.id.toString();
  const session = getSession(ctx);
  
  if (session.waitingForCodeAmount) {
    const amount = parseInt(ctx.message.text);
    
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('❌ Please enter a valid number greater than 0');
      return;
    }
    
    const codeString = crypto.randomBytes(16).toString('hex');
    
    // Create a new redeem code
    await RedeemCode.create({
      code: codeString,
      limit: amount,
      isRedeemed: false,
      createdBy: userId
    });
    
    // Generate file content (encrypted code data)
    const codeData = {
      code: codeString,
      limit: amount,
      timestamp: Date.now()
    };
    
    const codeDataStr = JSON.stringify(codeData);
    const encryptedData = crypto.createHash('sha256').update(codeDataStr).digest('hex') + '.' + Buffer.from(codeDataStr).toString('base64');
    
    // Write to file
    const fileName = `redeem_code_${amount}_links.code`;
    fs.writeFileSync(fileName, encryptedData);
    
    // Send file to admin
    await ctx.replyWithDocument({ source: fileName }, {
      caption: `✅ Redeem code created successfully!\nLimit amount: ${amount} links\n\nThis file can be shared with users for redemption.`
    });
    
    // Clean up
    fs.unlinkSync(fileName);
    delete session.waitingForCodeAmount;
    
    await ctx.reply('Select an option:', getAdminMenuKeyboard());
  } else if (session.waitingForLinks) {
    const messageText = ctx.message.text;
    const links = messageText.split('\n').filter(link => link.trim().startsWith('http'));
    
    if (links.length === 0) {
      await ctx.reply('❌ No valid links detected. Please send links starting with http or https, one per line');
      return;
    }
    
    const user = await User.findOne({ userId });
    
    if (user.limit < links.length) {
      await ctx.reply(`❌ You don't have enough limit. Your current limit: ${user.limit}, Links requested: ${links.length}`);
      return;
    }
    
    session.orderLinks = links;
    
    await ctx.reply(`📋 *Order Summary*\n\nLinks detected: ${links.length}\nYour available limit: ${user.limit}\n\nDo you want to proceed?`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Confirm Order', 'confirm_order'),
          Markup.button.callback('❌ Cancel', 'cancel_order')
        ]
      ])
    });
  }
});

// Handle document messages (for redeem codes)
bot.on('document', async (ctx) => {
  const userId = ctx.from.id.toString();
  const session = getSession(ctx);
  
  if (session.waitingForRedeemFile) {
    const fileId = ctx.message.document.file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    
    try {
      const response = await axios.get(fileLink.toString(), { responseType: 'text' });
      const fileData = response.data;
      
      // Validate and decode file
      const [hashPart, dataPart] = fileData.split('.');
      const decodedData = Buffer.from(dataPart, 'base64').toString('utf8');
      const calculatedHash = crypto.createHash('sha256').update(decodedData).digest('hex');
      
      if (hashPart !== calculatedHash) {
        await ctx.reply('❌ Invalid redeem code file. The file has been tampered with.');
        delete session.waitingForRedeemFile;
        return;
      }
      
      const codeData = JSON.parse(decodedData);
      const codeString = codeData.code;
      
      // Check if code exists and is not redeemed
      const codeDoc = await RedeemCode.findOne({ code: codeString });
      
      if (!codeDoc) {
        await ctx.reply('❌ Invalid redeem code. Code not found.');
      } else if (codeDoc.isRedeemed) {
        await ctx.reply('❌ This code has already been redeemed.');
      } else {
        // Update user limit and mark code as redeemed
        await User.findOneAndUpdate(
          { userId },
          { $inc: { limit: codeDoc.limit } }
        );
        
        await RedeemCode.findOneAndUpdate(
          { code: codeString },
          { 
            isRedeemed: true,
            redeemedBy: userId,
            redeemedAt: new Date()
          }
        );
        
        const user = await User.findOne({ userId });
        
        await ctx.reply(`✅ Code successfully redeemed!\n\nAdded limit: ${codeDoc.limit}\nYour new total limit: ${user.limit}`);
      }
    } catch (error) {
      console.error('Redeem error:', error);
      await ctx.reply('❌ Error processing the redeem code. Please try again or contact admin.');
    }
    
    delete session.waitingForRedeemFile;
  }
});

// Check limit
bot.action('check_limit', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = await User.findOne({ userId });
  
  await ctx.editMessageText(`🔢 *Your Link Limit*\n\nCurrent available limit: *${user.limit}* links\n\nUse this limit to place orders.`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'back_to_main')]])
  });
});

// Check all user limits (Admin only)
bot.action('check_all_limits', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = await User.findOne({ userId });
  
  if (!user.isAdmin) {
    await ctx.answerCbQuery('You are not authorized to use this feature');
    return;
  }
  
  const allUsers = await User.find().sort({ limit: -1 });
  
  let message = '👥 *All User Limits*\n\n';
  
  allUsers.forEach((u, index) => {
    message += `${index + 1}. ${u.username || 'Unknown'} - *${u.limit}* links\n`;
  });
  
  if (message.length > 4000) {
    // If message is too long, create a file
    fs.writeFileSync('user_limits.txt', message.replace(/\*/g, ''));
    
    await ctx.replyWithDocument({ source: 'user_limits.txt' });
    fs.unlinkSync('user_limits.txt');
    
    await ctx.editMessageText('👥 *All User Limits*\n\nUser list has been sent as a file due to its length.', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'admin_menu')]])
    });
  } else {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'admin_menu')]])
    });
  }
});

// Order process
bot.action('order', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = await User.findOne({ userId });
  
  if (user.limit <= 0) {
    await ctx.editMessageText('❌ *Insufficient Limit*\n\nYou don\'t have enough limit to place an order. Please contact the admin to get more limit.', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url('📞 Contact Admin', `https://t.me/${config.ADMIN_USERNAME}`)],
        [Markup.button.callback('🔙 Back', 'back_to_main')]
      ])
    });
    return;
  }
  
  const session = getSession(ctx);
  session.waitingForLinks = true;
  
  await ctx.editMessageText(`🛒 *New Order*\n\nYour current limit: *${user.limit}* links\n\nPlease send your links (one per line):\nExample:\nhttps://example.com/1\nhttps://example.com/2`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Cancel', 'back_to_main')]])
  });
});

// Confirm order
bot.action('confirm_order', async (ctx) => {
  const userId = ctx.from.id.toString();
  const session = getSession(ctx);
  
  if (!session.orderLinks || session.orderLinks.length === 0) {
    await ctx.editMessageText('❌ Order session expired. Please start a new order.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'back_to_main')]])
    });
    return;
  }
  
  const links = session.orderLinks;
  
  // Deduct user limit
  await User.findOneAndUpdate(
    { userId },
    { $inc: { limit: -links.length } }
  );
  
  // Final confirmation
  await ctx.editMessageText(`⚠️ *Final Confirmation*\n\nYou are about to order ${links.length} links. This action cannot be undone.\n\nAre you absolutely sure?`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Complete Order (100%)', 'process_order'),
        Markup.button.callback('❌ Cancel', 'cancel_final')
      ]
    ])
  });
});

// Process the final order
bot.action('process_order', async (ctx) => {
  const userId = ctx.from.id.toString();
  const session = getSession(ctx);
  
  if (!session.orderLinks || session.orderLinks.length === 0) {
    await ctx.editMessageText('❌ Order session expired. Please start a new order.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'back_to_main')]])
    });
    return;
  }
  
  const links = session.orderLinks;
  
  await ctx.editMessageText(`🔄 *Processing Order*\n\nWorking on ${links.length} links. Please wait, this may take some time...`, {
    parse_mode: 'Markdown'
  });
  
  // First, check available services
  try {
    const servicesResponse = await axios.post(config.API_URL, {
      api_key: config.API_KEY,
      action: 'services',
      secret_key: config.SECRET_KEY
    });
    
    if (!servicesResponse.data.status) {
      // Refund the user's limit
      await User.findOneAndUpdate(
        { userId },
        { $inc: { limit: links.length } }
      );
      
      await ctx.editMessageText('❌ *Order Failed*\n\nCould not fetch services from provider. Your limit has been refunded.', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'back_to_main')]])
      });
      return;
    }
    
    // Verify the services exist and check their max prices
    const services = servicesResponse.data.data;
    const service1 = services.find(s => s.id.toString() === config.SERVICE_ID_1);
    const service2 = services.find(s => s.id.toString() === config.SERVICE_ID_2);
    
    if (!service1 || !service2) {
      // Refund the user's limit
      await User.findOneAndUpdate(
        { userId },
        { $inc: { limit: links.length } }
      );
      
      await ctx.editMessageText('❌ *Order Failed*\n\nRequired services not found. Your limit has been refunded.', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'back_to_main')]])
      });
      return;
    }
    
    if (service1.price > 10000 || service2.price > 150000) {
      // Refund the user's limit
      await User.findOneAndUpdate(
        { userId },
        { $inc: { limit: links.length } }
      );
      
      await ctx.editMessageText('❌ *Order Failed*\n\nService price exceeds maximum allowed. Your limit has been refunded.', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'back_to_main')]])
      });
      return;
    }
    
    // Process each link
    const orderIds = [];
    let successful = 0;
    let failed = 0;
    
    for (const [index, link] of links.entries()) {
      try {
        // Update progress
        if (links.length > 3 && index % 3 === 0) {
          await ctx.editMessageText(`🔄 *Processing Order*\n\nProcessed ${index}/${links.length} links...\nSuccessful: ${successful}\nFailed: ${failed}`, {
            parse_mode: 'Markdown'
          });
        }
        
        // Process first service
        const order1Response = await axios.post(config.API_URL, {
          api_key: config.API_KEY,
          action: 'order',
          secret_key: config.SECRET_KEY,
          service: config.SERVICE_ID_1,
          data: link,
          quantity: config.QUANTITY_1
        });
        
        // Process second service
        const order2Response = await axios.post(config.API_URL, {
          api_key: config.API_KEY,
          action: 'order',
          secret_key: config.SECRET_KEY,
          service: config.SERVICE_ID_2,
          data: link,
          quantity: config.QUANTITY_2
        });
        
        if (order1Response.data.status && order2Response.data.status) {
          successful++;
          
          // Save order to database
          await Order.create({
            userId,
            link,
            service1Id: config.SERVICE_ID_1,
            service2Id: config.SERVICE_ID_2,
            order1Id: order1Response.data.data.id,
            order2Id: order2Response.data.data.id,
            status: 'Processing',
            quantity1: config.QUANTITY_1,
            quantity2: config.QUANTITY_2
          });
          
          // Add order IDs to track
          orderIds.push(order1Response.data.data.id);
          orderIds.push(order2Response.data.data.id);
        } else {
          failed++;
        }
      } catch (error) {
        failed++;
        console.error(`Error processing link ${link}:`, error.message);
      }
    }
    
    // Final summary
    const finalMessage = `✅ *Order Completed*\n\nTotal links: ${links.length}\nSuccessful: ${successful}\nFailed: ${failed}\n\nYou can check the status in Order History.`;
    
    await ctx.editMessageText(finalMessage, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📜 View Order History', 'order_history')],
        [Markup.button.callback('🔙 Back to Main', 'back_to_main')]
      ])
    });
    
    // Clean up session
    delete session.orderLinks;
    delete session.waitingForLinks;
    
  } catch (error) {
    console.error('Order processing error:', error);
    
    // Refund the user's limit
    await User.findOneAndUpdate(
      { userId },
      { $inc: { limit: links.length } }
    );
    
    await ctx.editMessageText(`❌ *Order Failed*\n\nAn error occurred while processing your order. Your limit has been refunded.\n\nError: ${error.message}`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'back_to_main')]])
    });
  }
});

// Cancel order final confirmation
bot.action('cancel_final', async (ctx) => {
  const userId = ctx.from.id.toString();
  const session = getSession(ctx);
  
  if (session.orderLinks) {
    const links = session.orderLinks;
    
    // Refund the user's limit
    await User.findOneAndUpdate(
      { userId },
      { $inc: { limit: links.length } }
    );
    
    delete session.orderLinks;
    delete session.waitingForLinks;
  }
  
  await ctx.editMessageText('🛑 *Order Cancelled*\n\nYour order has been cancelled, and your limit has been refunded.', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'back_to_main')]])
  });
});

// Cancel order
bot.action('cancel_order', async (ctx) => {
  const session = getSession(ctx);
  delete session.orderLinks;
  delete session.waitingForLinks;
  
  await ctx.editMessageText('🛑 *Order Cancelled*\n\nYour order has been cancelled.', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'back_to_main')]])
  });
});

// Order history
bot.action('order_history', async (ctx) => {
  const userId = ctx.from.id.toString();
  const orders = await Order.find({ userId }).sort({ createdAt: -1 }).limit(20);
  
  if (orders.length === 0) {
    await ctx.editMessageText('📜 *Order History*\n\nYou haven\'t placed any orders yet.', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'back_to_main')]])
    });
    return;
  }
  
  let message = '📜 *Your Order History*\n\n';
  const buttons = [];
  
  orders.forEach((order, index) => {
    // Format date in readable format
    const orderDate = new Date(order.createdAt);
    const formattedDate = `${orderDate.getDate()}/${orderDate.getMonth() + 1}/${orderDate.getFullYear()} ${orderDate.getHours()}:${String(orderDate.getMinutes()).padStart(2, '0')}`;
    
    // Truncate link if too long
    const displayLink = order.link.length > 30 ? `${order.link.substring(0, 27)}...` : order.link;
    
    message += `${index + 1}. ${formattedDate}\n   Status: ${order.status}\n   Link: ${displayLink}\n\n`;
    
    // Add button row for each order
    buttons.push([Markup.button.callback(`📊 Check Status #${index + 1}`, `check_status_${order._id}`)]);
  });
  
  // Add back button
  buttons.push([Markup.button.callback('🔙 Back', 'back_to_main')]);
  
  if (message.length > 4000) {
    // If message is too long, create a file
    fs.writeFileSync('order_history.txt', message.replace(/\*/g, ''));
    
    await ctx.replyWithDocument({ source: 'order_history.txt' }, {
      caption: '📜 Your order history has been exported to this file.',
      ...Markup.inlineKeyboard(buttons)
    });
    
    fs.unlinkSync('order_history.txt');
    
    await ctx.editMessageText('📜 *Order History*\n\nYour order history has been sent as a file due to its length.', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'back_to_main')]])
    });
  } else {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  }
});

// Check status of a specific order
bot.action(/check_status_(.+)/, async (ctx) => {
  const orderId = ctx.match[1];
  const order = await Order.findById(orderId);
  
  if (!order) {
    await ctx.answerCbQuery('Order not found');
    return;
  }
  
  await ctx.editMessageText('🔍 *Checking Order Status*\n\nPlease wait while we fetch the latest status...', {
    parse_mode: 'Markdown'
  });
  
  try {
    // Check status for first order
    const status1Response = await axios.post(config.API_URL, {
      api_key: config.API_KEY,
      action: 'status',
      secret_key: config.SECRET_KEY,
      id: order.order1Id
    });
    
    // Check status for second order
    const status2Response = await axios.post(config.API_URL, {
      api_key: config.API_KEY,
      action: 'status',
      secret_key: config.SECRET_KEY,
      id: order.order2Id
    });
    
    // Update status in database
    let overallStatus = 'Unknown';
    
    if (status1Response.data.status && status2Response.data.status) {
      const status1 = status1Response.data.data.status;
      const status2 = status2Response.data.data.status;
      
      // Determine overall status
      if (status1 === 'Success' && status2 === 'Success') {
        overallStatus = 'Success';
      } else if (status1 === 'Error' || status2 === 'Error') {
        overallStatus = 'Error';
      } else if (status1 === 'Partial' || status2 === 'Partial') {
        overallStatus = 'Partial';
      } else if (status1 === 'Processing' || status2 === 'Processing') {
        overallStatus = 'Processing';
      } else if (status1 === 'Pending' || status2 === 'Pending') {
        overallStatus = 'Pending';
      } else if (status1 === 'In progress' || status2 === 'In progress') {
        overallStatus = 'In progress';
      }
      
      // Update order status
      await Order.findByIdAndUpdate(orderId, { status: overallStatus });
      
      const formattedDate = new Date(order.createdAt).toLocaleString();
      
      const message = `📊 *Order Status*\n\nDate: ${formattedDate}\nLink: ${order.link}\n\n*Overall Status: ${overallStatus}*\n\nService 1 (${config.SERVICE_ID_1}):\nStatus: ${status1}\nStart Count: ${status1Response.data.data.start_count}\nRemains: ${status1Response.data.data.remains}\n\nService 2 (${config.SERVICE_ID_2}):\nStatus: ${status2}\nStart Count: ${status2Response.data.data.start_count}\nRemains: ${status2Response.data.data.remains}`;
      
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh Status', `check_status_${orderId}`)],
          [Markup.button.callback('🔙 Back to History', 'order_history')]
        ])
      });
    } else {
      await ctx.editMessageText('❌ *Status Check Failed*\n\nCould not retrieve status information from the service provider.', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Try Again', `check_status_${orderId}`)],
          [Markup.button.callback('🔙 Back to History', 'order_history')]
        ])
      });
    }
  } catch (error) {
    console.error('Status check error:', error);
    await ctx.editMessageText(`❌ *Status Check Error*\n\nAn error occurred while checking the order status.\n\nError: ${error.message}`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Try Again', `check_status_${orderId}`)],
        [Markup.button.callback('🔙 Back to History', 'order_history')]
      ])
    });
  }
});

// Handle callback queries that don't have specific handlers
bot.on('callback_query', async (ctx) => {
  await ctx.answerCbQuery();
});

// Error handler
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
});

// Start the bot
bot.launch()
  .then(() => console.log('Bot started successfully'))
  .catch(err => console.error('Failed to start bot:', err));

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
