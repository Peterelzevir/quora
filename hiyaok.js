// index.js
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const { MongoClient } = require('mongodb');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');

// Initialize bot
const bot = new Telegraf(config.telegramToken);

// Global error handler to prevent bot crashes
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    
    // Notify admins about error
    for (const adminId of config.adminId) {
        try {
            bot.telegram.sendMessage(adminId, 
                `⚠️ *Bot Error Alert*\n\nUncaught exception: ${error.message}\n\nBot is still running.`, 
                { parse_mode: 'Markdown' }
            );
        } catch (e) {
            console.error(`Failed to notify admin about error:`, e);
        }
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    
    // Notify admins about rejection
    for (const adminId of config.adminId) {
        try {
            bot.telegram.sendMessage(adminId, 
                `⚠️ *Bot Error Alert*\n\nUnhandled promise rejection: ${reason}\n\nBot is still running.`, 
                { parse_mode: 'Markdown' }
            );
        } catch (e) {
            console.error(`Failed to notify admin about rejection:`, e);
        }
    }
});

// Connect to MongoDB
let db;
let usersCollection;
let codesCollection;
let ordersCollection;

async function connectToMongoDB() {
    try {
        const client = new MongoClient(config.mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
        await client.connect();
        console.log('Connected to MongoDB');
        
        db = client.db('orderBot');
        usersCollection = db.collection('users');
        codesCollection = db.collection('codes');
        ordersCollection = db.collection('orders');
        
        // Create indexes
        await usersCollection.createIndex({ userId: 1 }, { unique: true });
        await codesCollection.createIndex({ code: 1 }, { unique: true });
        await ordersCollection.createIndex({ orderId: 1 }, { unique: true });
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        process.exit(1);
    }
}

// Function for safe DB operations
async function safeDBOperation(operation, fallback = null) {
    try {
        return await operation();
    } catch (error) {
        console.error('Database operation error:', error);
        return fallback;
    }
}

// Scene for adding codes
const addCodeScene = new Scenes.BaseScene('addCode');

addCodeScene.enter(async (ctx) => {
    await ctx.reply('🔑 Masukkan jumlah limit yang ingin dibuat:', {
        reply_markup: { remove_keyboard: true }
    });
});

addCodeScene.on('text', async (ctx) => {
    const amount = parseInt(ctx.message.text.trim());
    
    if (isNaN(amount) || amount <= 0) {
        await ctx.reply('❌ Jumlah tidak valid. Silakan masukkan angka positif.');
        return;
    }
    
    try {
        // Generate unique code
        const code = crypto.randomBytes(8).toString('hex');
        
        // Create the redemption code in database
        await codesCollection.insertOne({
            code,
            amount,
            createdBy: ctx.from.id,
            createdAt: new Date(),
            isRedeemed: false
        });
        
        // Create code file
        const codeData = {
            code,
            amount,
            createdAt: new Date().toISOString()
        };
        
        const fileName = `code_${code}.json`;
        fs.writeFileSync(fileName, JSON.stringify(codeData, null, 2));
        
        // Send the file to admin
        await ctx.replyWithDocument({ source: fileName }, {
            caption: `✅ Code berhasil dibuat!\n\n🔑 Code: ${code}\n🔢 Jumlah Limit: ${amount}`
        });
        
        // Delete the file after sending
        fs.unlinkSync(fileName);
        
        // Exit the scene
        await ctx.scene.leave();
        await showAdminMenu(ctx);
    } catch (error) {
        console.error('Error generating code:', error);
        await ctx.reply('❌ Terjadi kesalahan saat membuat code.');
        await ctx.scene.leave();
        await showAdminMenu(ctx);
    }
});

// Scene for processing orders
const orderScene = new Scenes.BaseScene('order');

orderScene.enter(async (ctx) => {
    await ctx.reply('📋 Silakan kirimkan link yang ingin diproses (satu atau lebih, tiap link di baris baru):', {
        reply_markup: { remove_keyboard: true }
    });
});

orderScene.on('text', async (ctx) => {
    const links = ctx.message.text.trim().split('\n').filter(link => link.trim().startsWith('http'));
    
    if (links.length === 0) {
        await ctx.reply('❌ Tidak ada link valid yang ditemukan. Link harus dimulai dengan http atau https.');
        return;
    }
    
    const userId = ctx.from.id;
    const user = await usersCollection.findOne({ userId });
    
    if (!user || user.limit < links.length) {
        await ctx.reply(`❌ Limit tidak mencukupi. Anda membutuhkan ${links.length} limit, tetapi hanya memiliki ${user ? user.limit : 0} limit.`, {
            reply_markup: Markup.inlineKeyboard([
                Markup.button.url('💬 Hubungi Admin', 't.me/hiyaok')
            ])
        });
        await ctx.scene.leave();
        return;
    }
    
    ctx.session.links = links;
    ctx.session.totalLinks = links.length;
    
    await ctx.reply(`📝 Ditemukan ${links.length} link. Anda memiliki ${user.limit} limit.`, {
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('✅ Order', 'confirm_order')],
            [Markup.button.callback('❌ Batalkan', 'cancel_order')]
        ])
    });
});

orderScene.action('confirm_order', async (ctx) => {
    await ctx.editMessageText('🔄 Apakah Anda yakin ingin melanjutkan order? Setelah dikonfirmasi, order tidak dapat dibatalkan.', {
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('✅ 100% Yakin', 'process_order')],
            [Markup.button.callback('❌ Batalkan', 'cancel_order')]
        ])
    });
});

orderScene.action('process_order', async (ctx) => {
    try {
        await ctx.editMessageText('🔄 Memproses order...');
        
        const userId = ctx.from.id;
        const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
        const { links } = ctx.session;
        
        // Notify admin about new order
        for (const adminId of config.adminId) {
            try {
                await bot.telegram.sendMessage(adminId, 
                    `🛒 *Order Baru!*\n\n👤 User: ${username}\n🆔 ID: \`${userId}\`\n🔢 Jumlah Link: ${links.length}`, 
                    { parse_mode: 'Markdown' }
                );
            } catch (e) {
                console.error(`Failed to notify admin ${adminId}:`, e);
            }
        }
        
        // Get services first
        const servicesResponse = await axios.post(config.apiUrl, {
            api_key: config.apiKey,
            action: 'services',
            secret_key: config.secretKey
        });
        
        if (!servicesResponse.data.status) {
            throw new Error('Gagal mendapatkan layanan dari API');
        }
        
        // Validate service IDs exist and check prices
        const services = servicesResponse.data.data;
        const firstService = services.find(s => s.id.toString() === config.serviceIds.first);
        const secondService = services.find(s => s.id.toString() === config.serviceIds.second);
        
        if (!firstService || !secondService) {
            throw new Error('Service ID tidak ditemukan');
        }
        
        if (firstService.price > 10000) {
            throw new Error(`Service ID ${config.serviceIds.first} melebihi harga maksimal 10.000`);
        }
        
        if (secondService.price > 150000) {
            throw new Error(`Service ID ${config.serviceIds.second} melebihi harga maksimal 150.000`);
        }
        
        // Process each link
        const orderResults = [];
        for (const [index, link] of links.entries()) {
            await ctx.editMessageText(`🔄 Memproses link ${index + 1} dari ${links.length}...`);
            
            // First API order
            const firstOrderResponse = await axios.post(config.apiUrl, {
                api_key: config.apiKey,
                action: 'order',
                secret_key: config.secretKey,
                service: config.serviceIds.first,
                data: link,
                quantity: config.quantities.first
            });
            
            if (!firstOrderResponse.data.status) {
                throw new Error(`Gagal order API pertama untuk link ${index + 1}: ${firstOrderResponse.data.message || 'Unknown error'}`);
            }
            
            // Second API order
            const secondOrderResponse = await axios.post(config.apiUrl, {
                api_key: config.apiKey,
                action: 'order',
                secret_key: config.secretKey,
                service: config.serviceIds.second,
                data: link,
                quantity: config.quantities.second
            });
            
            if (!secondOrderResponse.data.status) {
                throw new Error(`Gagal order API kedua untuk link ${index + 1}: ${secondOrderResponse.data.message || 'Unknown error'}`);
            }
            
            // Save order info
            const orderInfo = {
                userId,
                link,
                firstOrderId: firstOrderResponse.data.data.id,
                secondOrderId: secondOrderResponse.data.data.id,
                status: 'Pending',
                createdAt: new Date()
            };
            
            const result = await ordersCollection.insertOne(orderInfo);
            orderResults.push({
                orderId: result.insertedId,
                firstOrderId: firstOrderResponse.data.data.id,
                secondOrderId: secondOrderResponse.data.data.id
            });
        }
        
        // Update user's limit
        await usersCollection.updateOne(
            { userId },
            { $inc: { limit: -links.length } }
        );
        
        // Generate success message
        let successMessage = `✅ Order berhasil diproses!\n\n`;
        successMessage += `📊 Detail Order:\n`;
        successMessage += `📌 Jumlah Link: ${links.length}\n`;
        successMessage += `🔢 Limit Terpakai: ${links.length}\n\n`;
        
        const user = await usersCollection.findOne({ userId });
        successMessage += `🔄 Sisa Limit: ${user.limit}`;
        
        await ctx.editMessageText(successMessage, {
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('📊 Riwayat Order', 'view_history')]
            ])
        });
        
        // Notify admin about successful order completion
        for (const adminId of config.adminId) {
            try {
                const orderSummary = `✅ *Order Selesai Diproses!*\n\n👤 User: ${ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name}\n🆔 ID: \`${userId}\`\n🔢 Jumlah Link: ${links.length}\n🔗 Order IDs: ${orderResults.map(o => o.orderId).join(', ')}`;
                
                await bot.telegram.sendMessage(adminId, orderSummary, {
                    parse_mode: 'Markdown'
                });
            } catch (e) {
                console.error(`Failed to notify admin ${adminId} about completion:`, e);
            }
        }
        
        await ctx.scene.leave();
    } catch (error) {
        console.error('Error processing order:', error);
        await ctx.editMessageText(`❌ Terjadi kesalahan: ${error.message}`, {
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu')]
            ])
        });
        await ctx.scene.leave();
    }
});

orderScene.action('cancel_order', async (ctx) => {
    await ctx.editMessageText('❌ Order dibatalkan.');
    await ctx.scene.leave();
    await showMainMenu(ctx);
});

// Scene for code redemption
const redeemCodeScene = new Scenes.BaseScene('redeemCode');

redeemCodeScene.enter(async (ctx) => {
    await ctx.reply('📤 Silakan kirim file code yang ingin di-redeem:', {
        reply_markup: { remove_keyboard: true }
    });
});

redeemCodeScene.on('document', async (ctx) => {
    try {
        const fileId = ctx.message.document.file_id;
        const fileInfo = await ctx.telegram.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${config.telegramToken}/${fileInfo.file_path}`;
        
        const response = await axios.get(fileUrl);
        const codeData = response.data;
        
        if (!codeData || !codeData.code || !codeData.amount) {
            await ctx.reply('❌ Format file tidak valid.');
            await ctx.scene.leave();
            await showMainMenu(ctx);
            return;
        }
        
        const code = codeData.code;
        const codeDoc = await codesCollection.findOne({ code });
        
        if (!codeDoc) {
            await ctx.reply('❌ Code tidak ditemukan.');
            await ctx.scene.leave();
            await showMainMenu(ctx);
            return;
        }
        
        if (codeDoc.isRedeemed) {
            await ctx.reply('❌ Code sudah digunakan.');
            await ctx.scene.leave();
            await showMainMenu(ctx);
            return;
        }
        
        // Update code status
        await codesCollection.updateOne(
            { code },
            { $set: { isRedeemed: true, redeemedBy: ctx.from.id, redeemedAt: new Date() } }
        );
        
        // Update user's limit
        const userId = ctx.from.id;
        const user = await usersCollection.findOne({ userId });
        
        if (user) {
            await usersCollection.updateOne(
                { userId },
                { $inc: { limit: codeDoc.amount } }
            );
        } else {
            await usersCollection.insertOne({
                userId,
                username: ctx.from.username || null,
                firstName: ctx.from.first_name,
                lastName: ctx.from.last_name || null,
                limit: codeDoc.amount,
                createdAt: new Date()
            });
        }
        
        const updatedUser = await usersCollection.findOne({ userId });
        
        await ctx.reply(`✅ Code berhasil di-redeem!\n\n🔢 Limit Ditambahkan: ${codeDoc.amount}\n🔄 Total Limit Sekarang: ${updatedUser.limit}`);
        await ctx.scene.leave();
        await showMainMenu(ctx);
    } catch (error) {
        console.error('Error redeeming code:', error);
        await ctx.reply('❌ Terjadi kesalahan saat meredeem code.');
        await ctx.scene.leave();
        await showMainMenu(ctx);
    }
});

// Create scene manager
const stage = new Scenes.Stage([addCodeScene, orderScene, redeemCodeScene]);

// Add middleware for handling concurrent processing
bot.use(async (ctx, next) => {
    try {
        // Set a timeout for operations
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Operation timed out')), 30000); // 30 seconds timeout
        });
        
        // Race the next middleware against the timeout
        await Promise.race([next(), timeoutPromise]);
    } catch (error) {
        console.error('Error in middleware:', error);
        
        // Only notify user if the context is still valid
        try {
            if (ctx.callbackQuery) {
                await ctx.answerCbQuery('Terjadi kesalahan, silakan coba lagi').catch(() => {});
            }
            
            // Don't interrupt user flow if they're in a scene
            if (!ctx.session?.currentScene) {
                await ctx.reply('❌ Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi.').catch(() => {});
            }
        } catch (replyError) {
            console.error('Error replying to user:', replyError);
        }
    }
});

// Middleware
bot.use(session());
bot.use(stage.middleware());

// Check if user exists and create if not
bot.use(async (ctx, next) => {
    if (ctx.from) {
        const userId = ctx.from.id;
        const user = await safeDBOperation(async () => {
            const existingUser = await usersCollection.findOne({ userId });
            
            if (!existingUser) {
                await usersCollection.insertOne({
                    userId,
                    username: ctx.from.username || null,
                    firstName: ctx.from.first_name,
                    lastName: ctx.from.last_name || null,
                    limit: 0,
                    createdAt: new Date()
                });
            }
            
            return existingUser || await usersCollection.findOne({ userId });
        }, { limit: 0 });
    }
    return next();
});

// Command handlers
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    
    if (config.adminId.includes(userId.toString())) {
        await showAdminMenu(ctx);
    } else {
        await showMainMenu(ctx);
    }
});

bot.command('admin', async (ctx) => {
    const userId = ctx.from.id;
    
    if (config.adminId.includes(userId.toString())) {
        await showAdminMenu(ctx);
    } else {
        await ctx.reply('❌ Anda tidak memiliki akses admin.');
    }
});

// Helper functions
async function showMainMenu(ctx) {
    const userId = ctx.from.id;
    const user = await safeDBOperation(async () => await usersCollection.findOne({ userId }), { limit: 0 });
    const limit = user ? user.limit : 0;
    
    await ctx.reply(`🤖 *Selamat Datang di Auto Order Bot*\n\n💼 Link Limit: *${limit}*`, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🛒 Order', 'order')],
            [Markup.button.callback('🔍 Cek Limit', 'check_limit')],
            [Markup.button.callback('📊 Riwayat Order', 'view_history')],
            [Markup.button.callback('🔑 Redeem Code', 'redeem_code')],
            [Markup.button.url('💬 Hubungi Admin', 't.me/hiyaok')]
        ])
    });
}

async function showAdminMenu(ctx) {
    await ctx.reply('👑 *Admin Panel*', {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('➕ Add Code', 'add_code')],
            [Markup.button.callback('📊 Cek Limit Users', 'check_all_limits')],
            [Markup.button.callback('🔙 Menu User', 'back_to_user')]
        ])
    });
}

// Action handlers
bot.action('add_code', async (ctx) => {
    if (!config.adminId.includes(ctx.from.id.toString())) {
        await ctx.answerCbQuery('❌ Anda tidak memiliki akses admin.');
        return;
    }
    
    await ctx.scene.enter('addCode');
    await ctx.answerCbQuery();
});

bot.action('check_all_limits', async (ctx) => {
    if (!config.adminId.includes(ctx.from.id.toString())) {
        await ctx.answerCbQuery('❌ Anda tidak memiliki akses admin.');
        return;
    }
    
    try {
        const users = await usersCollection.find().toArray();
        
        if (users.length === 0) {
            await ctx.editMessageText('❌ Belum ada user terdaftar.', {
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback('🔙 Kembali', 'back_to_admin')]
                ])
            });
            return;
        }
        
        let message = '👥 *Daftar Limit User*\n\n';
        
        for (const user of users) {
            const username = user.username ? `@${user.username}` : `${user.firstName} ${user.lastName || ''}`;
            message += `👤 ${username}\n`;
            message += `🆔 ${user.userId}\n`;
            message += `🔢 Limit: ${user.limit}\n\n`;
        }
        
        await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Kembali', 'back_to_admin')]
            ])
        });
    } catch (error) {
        console.error('Error checking all limits:', error);
        await ctx.editMessageText('❌ Terjadi kesalahan saat mengambil data limit.', {
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Kembali', 'back_to_admin')]
            ])
        });
    }
    
    await ctx.answerCbQuery();
});

bot.action('back_to_admin', async (ctx) => {
    await ctx.editMessageText('👑 *Admin Panel*', {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('➕ Add Code', 'add_code')],
            [Markup.button.callback('📊 Cek Limit Users', 'check_all_limits')],
            [Markup.button.callback('🔙 Menu User', 'back_to_user')]
        ])
    });
    await ctx.answerCbQuery();
});

bot.action('back_to_user', async (ctx) => {
    await showMainMenu(ctx);
    await ctx.answerCbQuery();
});

bot.action('order', async (ctx) => {
    const userId = ctx.from.id;
    const user = await safeDBOperation(async () => await usersCollection.findOne({ userId }), { limit: 0 });
    
    if (!user || user.limit <= 0) {
        await ctx.answerCbQuery('❌ Limit tidak mencukupi');
        await ctx.editMessageText('❌ Limit tidak mencukupi untuk melakukan order.', {
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.url('💬 Hubungi Admin', 't.me/hiyaok')],
                [Markup.button.callback('🔙 Kembali', 'back_to_menu')]
            ])
        });
        return;
    }
    
    await ctx.scene.enter('order');
    await ctx.answerCbQuery();
});

bot.action('check_limit', async (ctx) => {
    const userId = ctx.from.id;
    const user = await safeDBOperation(async () => await usersCollection.findOne({ userId }), { limit: 0 });
    const limit = user ? user.limit : 0;
    
    await ctx.editMessageText(`💼 *Info Limit*\n\n🔢 Link Limit Anda: *${limit}*`, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Kembali', 'back_to_menu')]
        ])
    });
    await ctx.answerCbQuery();
});

bot.action('view_history', async (ctx) => {
    const userId = ctx.from.id;
    const orders = await safeDBOperation(async () => {
        return await ordersCollection.find({ userId }).sort({ createdAt: -1 }).limit(20).toArray();
    }, []);
    
    if (orders.length === 0) {
        await ctx.editMessageText('❌ Belum ada riwayat order.', {
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Kembali', 'back_to_menu')]
            ])
        });
        await ctx.answerCbQuery();
        return;
    }
    
    if (orders.length > 10) {
        // Generate file for many orders
        let fileContent = '📊 RIWAYAT ORDER\n\n';
        
        for (const order of orders) {
            const date = new Date(order.createdAt).toLocaleString();
            fileContent += `🆔 Order ID: ${order._id}\n`;
            fileContent += `📅 Tanggal: ${date}\n`;
            fileContent += `🔗 Link: ${order.link}\n`;
            fileContent += `📊 Status: ${order.status}\n\n`;
        }
        
        const fileName = `history_${userId}.txt`;
        fs.writeFileSync(fileName, fileContent);
        
        await ctx.deleteMessage();
        await ctx.replyWithDocument({ source: fileName }, {
            caption: '📊 Riwayat order Anda',
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu')]
            ])
        });
        
        fs.unlinkSync(fileName);
    } else {
        // Show inline buttons for each order
        let message = '📊 *Riwayat Order*\n\n';
        const buttons = [];
        
        for (const order of orders) {
            const date = new Date(order.createdAt).toLocaleString();
            message += `🆔 Order ID: \`${order._id}\`\n`;
            message += `📅 Tanggal: ${date}\n`;
            message += `📊 Status: ${order.status}\n\n`;
            
            buttons.push([Markup.button.callback(`🔍 Cek Order ${order._id}`, `check_order_${order._id}`)]);
        }
        
        buttons.push([Markup.button.callback('🔙 Kembali', 'back_to_menu')]);
        
        await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard(buttons)
        });
    }
    
    await ctx.answerCbQuery();
});

// Handle check_order callbacks
bot.action(/check_order_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    
    try {
        const order = await ordersCollection.findOne({ _id: orderId });
        
        if (!order) {
            await ctx.answerCbQuery('❌ Order tidak ditemukan');
            return;
        }
        
        // Check status for first order
        const firstStatusResponse = await axios.post(config.apiUrl, {
            api_key: config.apiKey,
            action: 'status',
            secret_key: config.secretKey,
            id: order.firstOrderId
        });
        
        // Check status for second order
        const secondStatusResponse = await axios.post(config.apiUrl, {
            api_key: config.apiKey,
            action: 'status',
            secret_key: config.secretKey,
            id: order.secondOrderId
        });
        
        if (!firstStatusResponse.data.status || !secondStatusResponse.data.status) {
            throw new Error('Gagal mendapatkan status order');
        }
        
        const firstStatus = firstStatusResponse.data.data.status;
        const secondStatus = secondStatusResponse.data.data.status;
        
        // Update order status in database
        await ordersCollection.updateOne(
            { _id: orderId },
            { $set: { 
                status: firstStatus,
                firstStatus,
                secondStatus,
                lastChecked: new Date()
            }}
        );
        
        let message = `📊 *Detail Order ${orderId}*\n\n`;
        message += `🔗 Link: ${order.link}\n\n`;
        message += `📊 Status API 1: ${firstStatus}\n`;
        message += `🔢 Start Count API 1: ${firstStatusResponse.data.data.start_count}\n`;
        message += `📉 Remains API 1: ${firstStatusResponse.data.data.remains}\n\n`;
        message += `📊 Status API 2: ${secondStatus}\n`;
        message += `🔢 Start Count API 2: ${secondStatusResponse.data.data.start_count}\n`;
        message += `📉 Remains API 2: ${secondStatusResponse.data.data.remains}\n\n`;
        message += `📅 Last Updated: ${new Date().toLocaleString()}`;
        
        await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('🔄 Refresh', `check_order_${orderId}`)],
                [Markup.button.callback('🔙 Kembali ke Riwayat', 'view_history')]
            ])
        });
    } catch (error) {
        console.error('Error checking order status:', error);
        await ctx.editMessageText(`❌ Terjadi kesalahan saat mengecek status order: ${error.message}`, {
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Kembali ke Riwayat', 'view_history')]
            ])
        });
    }
    
    await ctx.answerCbQuery();
});

bot.action('redeem_code', async (ctx) => {
    await ctx.scene.enter('redeemCode');
    await ctx.answerCbQuery();
});

bot.action('back_to_menu', async (ctx) => {
    await showMainMenu(ctx);
    await ctx.answerCbQuery();
});

// Start the bot
async function startBot() {
    await connectToMongoDB();
    
    // Configure session middleware for concurrent user support
    bot.use((ctx, next) => {
        // Ensure each user has their own session context
        ctx.session = ctx.session || {};
        return next();
    });
    
    await bot.launch({
        // Enable concurrent processing of updates
        dropPendingUpdates: false,
        allowedUpdates: ['message', 'callback_query', 'inline_query']
    });
    
    console.log('Bot started with concurrent user support');
    
    // Notify admins that bot is online
    for (const adminId of config.adminId) {
        try {
            await bot.telegram.sendMessage(adminId, 
                '🤖 *Bot is now online!*\n\nReady to process orders from multiple users concurrently.', 
                { parse_mode: 'Markdown' }
            );
        } catch (e) {
            console.error(`Failed to notify admin ${adminId} about startup:`, e);
        }
    }
}

startBot().catch(console.error);

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
