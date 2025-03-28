// index.js
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');
const bot = new Telegraf(config.botToken);

// Connect to MongoDB
mongoose.connect(config.mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Sukses terhubung ke MongoDB Atlas');
}).catch(err => {
    console.error('Error pas nyambung ke MongoDB:', err);
});

// dan tidak pernah null
const UserSchema = new mongoose.Schema({
    userId: { 
        type: String, 
        required: true, 
        unique: true,
        validate: {
            validator: function(v) {
                return v != null && v !== '';
            },
            message: props => `${props.value} bukan userId yang valid!`
        }
    },
    username: String,
    firstName: String,
    limit: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const OrderSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    links: [String],
    orderIds: [String],
    status: { type: String, default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});

const CodeSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    limit: { type: Number, required: true },
    used: { type: Boolean, default: false },
    createdBy: String,
    usedBy: String,
    createdAt: { type: Date, default: Date.now },
    usedAt: Date
});

const User = mongoose.model('User', UserSchema);
const Order = mongoose.model('Order', OrderSchema);
const Code = mongoose.model('Code', CodeSchema);

// Ubah fungsi getUser menjadi seperti ini:
const getUser = async (ctx) => {
    // Pastikan ctx.from dan ctx.from.id tidak null atau undefined
    if (!ctx.from || !ctx.from.id) {
        throw new Error('User ID tidak tersedia dalam context');
    }
    
    const userId = ctx.from.id.toString();
    let user = await User.findOne({ userId });
    
    if (!user) {
        try {
            user = new User({
                userId,
                username: ctx.from.username || '',
                firstName: ctx.from.first_name || ''
            });
            await user.save();
        } catch (error) {
            // Jika terjadi error duplikasi, coba ambil user yang sudah ada
            if (error.code === 11000) {
                console.log('Duplikasi ID terdeteksi, mencoba mengambil user dari database');
                user = await User.findOne({ userId });
                if (user) return user;
            }
            throw error; // Throw error lain jika bukan masalah duplikasi
        }
    }
    
    return user;
};

const isAdmin = (ctx) => {
    return config.adminId.includes(ctx.from.id.toString());
};

const generateCodeFile = (code, limit) => {
    const data = {
        code,
        limit,
        generatedAt: new Date().toISOString()
    };
    
    const fileName = `code_${code}.json`;
    fs.writeFileSync(fileName, JSON.stringify(data, null, 2));
    
    return fileName;
};

const verifyCodeFile = (filePath) => {
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!data.code || !data.limit) {
            return null;
        }
        return data;
    } catch (error) {
        console.error('Error pas verifikasi file code:', error);
        return null;
    }
};

const checkOrderStatus = async (orderId) => {
    try {
        const response = await axios.post(config.apiUrl, {
            api_key: config.apiKey,
            action: 'status',
            secret_key: config.secretKey,
            id: orderId
        });
        
        if (response.data && response.data.status === true) {
            return response.data.data;
        }
        
        return null;
    } catch (error) {
        console.error('Error pas cek status pesanan:', error);
        return null;
    }
};

const placeOrder = async (serviceId, link, quantity) => {
    try {
        const response = await axios.post(config.apiUrl, {
            api_key: config.apiKey,
            action: 'order',
            secret_key: config.secretKey,
            service: serviceId,
            data: link,
            quantity: quantity
        });
        
        if (response.data && response.data.status === true) {
            return response.data.data.id;
        }
        
        return null;
    } catch (error) {
        console.error('Error pas bikin pesanan:', error);
        return null;
    }
};

const getServices = async () => {
    try {
        const response = await axios.post(config.apiUrl, {
            api_key: config.apiKey,
            action: 'services',
            secret_key: config.secretKey
        });
        
        if (response.data && response.data.status === true) {
            return response.data.data;
        }
        
        return [];
    } catch (error) {
        console.error('Error pas ambil layanan:', error);
        return [];
    }
};

const validateServices = async () => {
    const services = await getServices();
    
    // Find the viewers service
    const viewersService = services.find(s => s.id.toString() === config.services.viewers);
    if (!viewersService || viewersService.price > 10000) {
        return false;
    }
    
    // Find the upvotes service
    const upvotesService = services.find(s => s.id.toString() === config.services.upvotes);
    if (!upvotesService || upvotesService.price > 150000) {
        return false;
    }
    
    return true;
};

// Generate a random code
const generateRandomCode = (length = 8) => {
    return crypto.randomBytes(length).toString('hex').slice(0, length).toUpperCase();
};

// Bot commands and handlers
bot.use(session());

// Start command
bot.start(async (ctx) => {
    const user = await getUser(ctx);
    
    const welcomeMessage = `🚀 *Halo, Selamat Datang di Bot Auto Order* 🚀\n\nHai ${ctx.from.first_name}!\n\nLimit kamu sekarang: *${user.limit}* link`;
    
    const keyboard = isAdmin(ctx) ? 
        Markup.inlineKeyboard([
            [Markup.button.callback('👤 Menu User', 'user_menu')],
            [Markup.button.callback('👑 Menu Admin', 'admin_menu')]
        ]) :
        Markup.inlineKeyboard([
            [Markup.button.callback('🛒 Order', 'order')],
            [Markup.button.callback('💰 Cek Limit', 'check_limit')],
            [Markup.button.callback('📜 Riwayat Order', 'order_history')],
            [Markup.button.callback('🎁 Redeem Code', 'redeem_code')]
        ]);
    
    await ctx.reply(welcomeMessage, {
        parse_mode: 'Markdown',
        ...keyboard
    });
});

// Admin menu
bot.action('admin_menu', async (ctx) => {
    if (!isAdmin(ctx)) {
        return await ctx.answerCbQuery('Lu gak punya akses ke menu ini broo!');
    }
    
    await ctx.editMessageText('👑 *Menu Admin* 👑\n\nPilih menu yang lu mau:', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('➕ Tambah Code', 'add_code')],
            [Markup.button.callback('👥 Cek Limit User', 'check_all_limits')],
            [Markup.button.callback('🏠 Balik ke Menu Utama', 'back_to_main')]
        ])
    });
});

// User menu
bot.action('user_menu', async (ctx) => {
    const user = await getUser(ctx);
    
    await ctx.editMessageText(`👤 *Menu User* 👤\n\nLimit lu sekarang: *${user.limit}* link`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🛒 Order', 'order')],
            [Markup.button.callback('💰 Cek Limit', 'check_limit')],
            [Markup.button.callback('📜 Riwayat Order', 'order_history')],
            [Markup.button.callback('🎁 Redeem Code', 'redeem_code')],
            [Markup.button.callback('🏠 Balik ke Menu Utama', 'back_to_main')]
        ])
    });
});

// Back to main menu
bot.action('back_to_main', async (ctx) => {
    const user = await getUser(ctx);
    
    const welcomeMessage = `🚀 *Bot Auto Order* 🚀\n\nHai ${ctx.from.first_name}!\n\nLimit kamu sekarang: *${user.limit}* link`;
    
    const keyboard = isAdmin(ctx) ? 
        Markup.inlineKeyboard([
            [Markup.button.callback('👤 Menu User', 'user_menu')],
            [Markup.button.callback('👑 Menu Admin', 'admin_menu')]
        ]) :
        Markup.inlineKeyboard([
            [Markup.button.callback('🛒 Order', 'order')],
            [Markup.button.callback('💰 Cek Limit', 'check_limit')],
            [Markup.button.callback('📜 Riwayat Order', 'order_history')],
            [Markup.button.callback('🎁 Redeem Code', 'redeem_code')]
        ]);
    
    await ctx.editMessageText(welcomeMessage, {
        parse_mode: 'Markdown',
        ...keyboard
    });
});

// ---- ADMIN FEATURES ----

// Add code feature
bot.action('add_code', async (ctx) => {
    if (!isAdmin(ctx)) {
        return await ctx.answerCbQuery('Lu bukan admin woyy!');
    }
    
    await ctx.editMessageText('➕ *Tambah Code* ➕\n\nMasukkan jumlah limit buat code ini dengan format:\n`/addcode <jumlah>`', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Balik ke Menu Admin', 'admin_menu')]
        ])
    });
});

bot.command('addcode', async (ctx) => {
    if (!isAdmin(ctx)) {
        return await ctx.reply('❌ Lu bukan admin woyy, gak bisa pake command ini!');
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length !== 2) {
        return await ctx.reply('❌ Format salah bro. Pake: `/addcode <jumlah>`', {
            parse_mode: 'Markdown'
        });
    }
    
    const limit = parseInt(args[1], 10);
    if (isNaN(limit) || limit <= 0) {
        return await ctx.reply('❌ Jumlah limit ga valid. Kasih angka positif ya!');
    }
    
    // Generate a random code
    const codeValue = generateRandomCode();
    
    // Save to database
    const code = new Code({
        code: codeValue,
        limit,
        createdBy: ctx.from.id.toString()
    });
    
    await code.save();
    
    // Generate a file for this code
    const fileName = generateCodeFile(codeValue, limit);
    
    // Send the file to admin
    await ctx.replyWithDocument({
        source: fileName,
        filename: `limit_code_${limit}.json`
    }, {
        caption: `✅ *Code Berhasil Dibuat*\n\nCode: \`${codeValue}\`\nLimit: ${limit}\n\nFile ini bisa dipake user buat redeem limit.`,
        parse_mode: 'Markdown'
    });
    
    // Delete the file after sending
    fs.unlinkSync(fileName);
});

// Check all user limits
bot.action('check_all_limits', async (ctx) => {
    if (!isAdmin(ctx)) {
        return await ctx.answerCbQuery('Lu bukan admin woyy!');
    }
    
    const users = await User.find().sort('-limit');
    
    if (users.length === 0) {
        return await ctx.editMessageText('❌ Belum ada user nih di database.', {
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Balik ke Menu Admin', 'admin_menu')]
            ])
        });
    }
    
    let message = '👥 *Limit Semua User* 👥\n\n';
    
    for (const user of users) {
        message += `ID: ${user.userId}\n`;
        message += `Username: ${user.username ? '@' + user.username : 'N/A'}\n`;
        message += `Nama: ${user.firstName || 'N/A'}\n`;
        message += `Limit: ${user.limit}\n\n`;
    }
    
    await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Balik ke Menu Admin', 'admin_menu')]
        ])
    });
});

// ---- USER FEATURES ----

// Check limit
bot.action('check_limit', async (ctx) => {
    try {
        // Validasi ctx.from terlebih dahulu
        if (!ctx.from) {
            return await ctx.answerCbQuery('Terjadi kesalahan. Coba mulai bot dari awal dengan /start');
        }
        
        const user = await getUser(ctx);
        
        await ctx.editMessageText(`💰 *Limit Lu* 💰\n\nLu punya *${user.limit} link* tersisa nih.`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Balik ke Menu User', 'user_menu')]
            ])
        });
    } catch (error) {
        console.error('Error pada handler check_limit:', error);
        await ctx.answerCbQuery('Terjadi kesalahan, coba lagi.');
    }
});

// Order feature
bot.action('order', async (ctx) => {
    const user = await getUser(ctx);
    
    if (user.limit <= 0) {
        await ctx.editMessageText('❌ *Limit Lu Kurang* ❌\n\nGa cukup limit buat order nih. Lu mesti kontak admin buat nambah limit.', {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('💬 Kontak Admin', 'contact_admin')],
                [Markup.button.callback('🔙 Balik ke Menu User', 'user_menu')]
            ])
        });
        return;
    }
    
    // Save user's state to session
    ctx.session = {
        ...ctx.session,
        orderState: 'awaiting_links'
    };
    
    await ctx.editMessageText(`🛒 *Buat Pesanan* 🛒\n\nLu punya *${user.limit} link* tersisa.\n\nKirim link Quora lu, satu per baris ya. Tiap link pake 1 limit.`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Batal', 'cancel_order')]
        ])
    });
});

bot.action('cancel_order', async (ctx) => {
    delete ctx.session.orderState;
    delete ctx.session.orderLinks;
    
    await ctx.editMessageText('🚫 Order dibatalin.', {
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Balik ke Menu User', 'user_menu')]
        ])
    });
});

bot.action('contact_admin', async (ctx) => {
    await ctx.editMessageText('💬 *Kontak Admin* 💬\n\nNih kontak admin kita buat nambah limit:\n\n@hiyaok', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.url('💬 Chat Admin', 't.me/hiyaok')],
            [Markup.button.callback('🔙 Balik ke Menu User', 'user_menu')]
        ])
    });
});

// Process links for order
bot.on('text', async (ctx) => {
    if (!ctx.session || !ctx.session.orderState) {
        return;
    }
    
    if (ctx.session.orderState === 'awaiting_links') {
        const user = await getUser(ctx);
        const lines = ctx.message.text.split('\n').filter(line => line.trim());
        
        // Validate links
        const validLinks = lines.filter(link => link.startsWith('http'));
        
        if (validLinks.length === 0) {
            await ctx.reply('❌ Ga ada link valid nih. Kirim link yang dimulai dengan http atau https, satu per baris.', {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Batal Order', 'cancel_order')]
                ])
            });
            return;
        }
        
        if (validLinks.length > user.limit) {
            await ctx.reply(`❌ Limit lu ga cukup nih. Lu kirim ${validLinks.length} link tapi cuma punya ${user.limit} limit.`, {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('💬 Kontak Admin', 'contact_admin')],
                    [Markup.button.callback('❌ Batal Order', 'cancel_order')]
                ])
            });
            return;
        }
        
        ctx.session.orderLinks = validLinks;
        
        // Show order confirmation
        let message = `🛒 *Konfirmasi Order* 🛒\n\nLu mau order buat ${validLinks.length} link:\n\n`;
        
        for (let i = 0; i < validLinks.length; i++) {
            message += `${i + 1}. ${validLinks[i]}\n`;
        }
        
        message += `\nIni bakal pake ${validLinks.length} dari limit lu. Lu punya ${user.limit} limit tersisa.`;
        
        // Delete user's message to keep the chat clean
        await ctx.deleteMessage(ctx.message.message_id);
        
        await ctx.reply(message, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Konfirmasi Order', 'confirm_order')],
                [Markup.button.callback('❌ Batal', 'cancel_order')]
            ])
        });
    }
});

bot.action('confirm_order', async (ctx) => {
    if (!ctx.session || !ctx.session.orderLinks) {
        return await ctx.answerCbQuery('❌ Ga ada order yang lagi jalan. Mulai lagi ya.');
    }
    
    await ctx.editMessageText('🔄 *Konfirmasi Final* 🔄\n\nKalo udah dikonfirmasi, order ini GAK BISA dibatalin. Lu yakin mau lanjut?', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Iya, gw 100% yakin', 'process_order')],
            [Markup.button.callback('❌ Ga jadi deh', 'cancel_order')]
        ])
    });
});

bot.action('process_order', async (ctx) => {
    if (!ctx.session || !ctx.session.orderLinks) {
        return await ctx.answerCbQuery('❌ Ga ada order yang lagi jalan. Mulai lagi ya.');
    }
    
    const links = ctx.session.orderLinks;
    const user = await getUser(ctx);
    
    // Check if user still has enough limit
    if (user.limit < links.length) {
        await ctx.editMessageText('❌ *Error* ❌\n\nLimit lu udah ga cukup buat order ini.', {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Balik ke Menu User', 'user_menu')]
            ])
        });
        return;
    }
    
    // Validate services first
    const servicesValid = await validateServices();
    if (!servicesValid) {
        await ctx.editMessageText('❌ *Error Layanan* ❌\n\nAda masalah sama konfigurasi layanan. Kontak admin ya.', {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('💬 Kontak Admin', 'contact_admin')],
                [Markup.button.callback('🔙 Balik ke Menu User', 'user_menu')]
            ])
        });
        return;
    }
    
    // Start processing
    const processingMsg = await ctx.editMessageText('🔄 *Lagi Proses Order Lu* 🔄\n\n0/' + links.length + ' link diproses...', {
        parse_mode: 'Markdown'
    });
    
    // Create order in database
    const order = new Order({
        userId: user.userId,
        links: links,
        orderIds: []
    });
    
    const orderIds = [];
    let successCount = 0;
    let errorCount = 0;
    
    // Process each link
    for (let i = 0; i < links.length; i++) {
        const link = links[i];
        
        // Update progress message
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            processingMsg.message_id, 
            null,
            `🔄 *Lagi Proses Order Lu* 🔄\n\n${i}/${links.length} link diproses...\n\nLagi proses: ${link}`,
            { parse_mode: 'Markdown' }
        );
        
        try {
            // Place order for viewers (24044)
            const viewersOrderId = await placeOrder(config.services.viewers, link, config.viewersQuantity);
            
            // Place order for upvotes (24047)
            const upvotesOrderId = await placeOrder(config.services.upvotes, link, config.upvotesQuantity);
            
            if (viewersOrderId && upvotesOrderId) {
                orderIds.push(viewersOrderId, upvotesOrderId);
                successCount++;
            } else {
                errorCount++;
            }
        } catch (error) {
            console.error('Error pas proses order:', error);
            errorCount++;
        }
    }
    
    // Update order with order IDs
    order.orderIds = orderIds;
    await order.save();
    
    // Update user limit
    user.limit -= links.length;
    await user.save();
    
    // Clear session data
    delete ctx.session.orderState;
    delete ctx.session.orderLinks;
    
    // Final message
    let finalMessage = `✅ *Order Selesai* ✅\n\n`;
    finalMessage += `Berhasil diproses: ${successCount}/${links.length} link\n`;
    
    if (errorCount > 0) {
        finalMessage += `Gagal: ${errorCount} link\n`;
    }
    
    finalMessage += `\nSisa limit lu: ${user.limit} link\n\n`;
    finalMessage += `ID Order: ${order._id}\n`;
    finalMessage += `Lu bisa cek status order di Riwayat Order.`;
    
    await ctx.telegram.editMessageText(
        ctx.chat.id, 
        processingMsg.message_id, 
        null,
        finalMessage,
        { 
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('📜 Lihat Riwayat Order', 'order_history')],
                [Markup.button.callback('🏠 Balik ke Menu Utama', 'back_to_main')]
            ])
        }
    );
});

// Order history
bot.action('order_history', async (ctx) => {
    const user = await getUser(ctx);
    
    const orders = await Order.find({ userId: user.userId }).sort('-createdAt').limit(10);
    
    if (orders.length === 0) {
        await ctx.editMessageText('📜 *Riwayat Order* 📜\n\nLu belum pernah order nih.', {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Balik ke Menu User', 'user_menu')]
            ])
        });
        return;
    }
    
    let message = '📜 *Riwayat Order* 📜\n\nOrder terakhir lu:\n\n';
    
    const buttons = [];
    
    for (const order of orders) {
        const date = new Date(order.createdAt).toLocaleString();
        message += `ID Order: ${order._id}\n`;
        message += `Tanggal: ${date}\n`;
        message += `Jumlah Link: ${order.links.length}\n`;
        message += `Status: ${order.status}\n\n`;
        
        buttons.push([Markup.button.callback(`📊 Cek Status: ${order._id.toString().slice(-5)}`, `check_status_${order._id}`)]);
    }
    
    buttons.push([Markup.button.callback('🔙 Balik ke Menu User', 'user_menu')]);
    
    // If there are too many orders, offer to download as a file
    if (orders.length > 5) {
        message += '\nBuat liat semua riwayat order, lu bisa download sebagai file:';
        buttons.unshift([Markup.button.callback('📥 Download Riwayat Lengkap', 'download_history')]);
    }
    
    await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
    });
});

// Download full order history
bot.action('download_history', async (ctx) => {
    const user = await getUser(ctx);
    
    const orders = await Order.find({ userId: user.userId }).sort('-createdAt');
    
    if (orders.length === 0) {
        return await ctx.answerCbQuery('Lu belum punya order buat didownload.');
    }
    
    let fileContent = 'ID Order,Tanggal,Link,Status,ID Order API\n';
    
    for (const order of orders) {
        const date = new Date(order.createdAt).toISOString();
        fileContent += `${order._id},${date},${order.links.length},${order.status},"${order.orderIds.join(', ')}"\n`;
    }
    
    // Write to a temporary file
    const fileName = `riwayat_order_${user.userId}.csv`;
    fs.writeFileSync(fileName, fileContent);
    
    // Send the file
    await ctx.replyWithDocument({
        source: fileName,
        filename: fileName
    }, {
        caption: '📊 Nih riwayat order lengkap lu'
    });
    
    // Delete the file after sending
    fs.unlinkSync(fileName);
    
    // Answer callback query
    await ctx.answerCbQuery('Riwayat order lu udah dikirim sebagai file.');
});

// Check order status
bot.action(/check_status_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    
    try {
        const order = await Order.findById(orderId);
        
        if (!order) {
            return await ctx.answerCbQuery('Order ga ketemu.');
        }
        
        // Check if this order belongs to the user
        if (order.userId !== ctx.from.id.toString()) {
            return await ctx.answerCbQuery('Lu ga punya akses buat liat order ini.');
        }
        
        let message = `📊 *Status Order* 📊\n\n`;
        message += `ID Order: ${order._id}\n`;
        message += `Tanggal: ${new Date(order.createdAt).toLocaleString()}\n`;
        message += `Jumlah Link: ${order.links.length}\n\n`;
        
        // Check status of each order ID
        let statuses = [];
        
        for (let i = 0; i < Math.min(order.orderIds.length, 5); i++) {
            const status = await checkOrderStatus(order.orderIds[i]);
            
            if (status) {
                statuses.push(`Order ${i+1}: ${status.status}\n` +
                             `Start Count: ${status.start_count}\n` +
                             `Remains: ${status.remains}\n`);
            } else {
                statuses.push(`Order ${i+1}: Status ga tersedia\n`);
            }
        }
        
        if (statuses.length > 0) {
            message += `*Status Detail:*\n\n${statuses.join('\n')}`;
        } else {
            message += `*Status:* ${order.status}\n`;
        }
        
        // If there are too many order IDs, show a note
        if (order.orderIds.length > 5) {
            message += `\nCatatan: Cuma nunjukin 5 dari ${order.orderIds.length} order pertama aja.\n`;
        }
        
        await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔄 Refresh Status', `refresh_status_${orderId}`)],
                [Markup.button.callback('🔙 Balik ke Riwayat Order', 'order_history')]
            ])
        });
    } catch (error) {
        console.error('Error pas cek status order:', error);
        await ctx.answerCbQuery('Error pas cek status order.');
    }
});

// Refresh order status
bot.action(/refresh_status_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    
    // Just call the check status action again
    await ctx.answerCbQuery('Lagi refresh status...');
    return ctx.action(`check_status_${orderId}`);
});

// Redeem code
bot.action('redeem_code', async (ctx) => {
    ctx.session = {
        ...ctx.session,
        redeemState: 'awaiting_file'
    };
    
    await ctx.editMessageText('🎁 *Redeem Code* 🎁\n\nKirim file code yang lu punya.', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Batal', 'cancel_redeem')]
        ])
    });
});

bot.action('cancel_redeem', async (ctx) => {
    delete ctx.session.redeemState;
    
    await ctx.editMessageText('🚫 Redeem dibatalin.', {
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Balik ke Menu User', 'user_menu')]
        ])
    });
});

// Handle file for redeem
bot.on('document', async (ctx) => {
    if (!ctx.session || ctx.session.redeemState !== 'awaiting_file') {
        return;
    }
    
    const user = await getUser(ctx);
    const fileId = ctx.message.document.file_id;
    
    // Download the file
    const fileInfo = await ctx.telegram.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${config.botToken}/${fileInfo.file_path}`;
    
    try {
        // Download the file content
        const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const tempFileName = `temp_${Date.now()}.json`;
        fs.writeFileSync(tempFileName, response.data);
        
        // Verify the file
        const codeData = verifyCodeFile(tempFileName);
        
        // Delete the temp file
        fs.unlinkSync(tempFileName);
        
        if (!codeData || !codeData.code || !codeData.limit) {
            await ctx.reply('❌ *File Code Ga Valid*\n\nFile yang lu kirim bukan file code yang valid.', {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🔙 Balik ke Menu User', 'user_menu')]
                ])
            });
            return;
        }
        
        // Check if the code exists in the database
        const code = await Code.findOne({ code: codeData.code });
        
        if (!code) {
            await ctx.reply('❌ *Code Ga Ditemukan*\n\nCode dalam file ga ada di database kita.', {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🔙 Balik ke Menu User', 'user_menu')]
                ])
            });
            return;
        }
        
        if (code.used) {
            await ctx.reply('❌ *Code Udah Dipakai*\n\nCode ini udah pernah dipake sebelumnya.', {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🔙 Balik ke Menu User', 'user_menu')]
                ])
            });
            return;
        }
        
        // Mark the code as used
        code.used = true;
        code.usedBy = user.userId;
        code.usedAt = new Date();
        await code.save();
        
        // Add limit to user
        user.limit += code.limit;
        await user.save();
        
        // Delete user's message to keep the chat clean
        await ctx.deleteMessage(ctx.message.message_id);
        
        await ctx.reply(`✅ *Redeem Berhasil* ✅\n\nLu berhasil redeem ${code.limit} limit!\nLimit lu sekarang: ${user.limit}`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🏠 Balik ke Menu Utama', 'back_to_main')]
            ])
        });
        
        // Clear session data
        delete ctx.session.redeemState;
    } catch (error) {
        console.error('Error redeem code:', error);
        await ctx.reply('❌ *Error Redeem Code*\n\nTerjadi error pas proses redeem code. Coba lagi nanti.', {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Balik ke Menu User', 'user_menu')]
            ])
        });
    }
});

// Help command
bot.help(async (ctx) => {
    const helpMessage = `🔍 *Bantuan Bot Auto Order* 🔍\n
*Perintah yang tersedia:*
/start - Mulai bot & liat menu utama
/help - Tampilkan bantuan ini

*Fitur User:*
• Order - Pesan viewers & upvotes untuk link Quora
• Cek Limit - Cek sisa limit lu
• Riwayat Order - Liat riwayat & status order
• Redeem Code - Tuker code jadi limit

*Fitur Admin:*
• Tambah Code - Bikin code redeem baru
• Cek Limit User - Liat limit semua user

Butuh bantuan? Kontak admin: @hiyaok`;

    await ctx.reply(helpMessage, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🏠 Ke Menu Utama', 'back_to_main')]
        ])
    });
});

// Handle unknown commands
bot.on('text', async (ctx) => {
    // Only respond if no other handler has processed the message
    // and no session state is active
    if (!ctx.session || (!ctx.session.orderState && !ctx.session.redeemState)) {
        await ctx.reply('❓ Gua ga ngerti perintah lu nih. Coba pake /start atau /help buat liat menu.', {
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🏠 Ke Menu Utama', 'back_to_main')]
            ])
        });
    }
});

// Error handling
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    ctx.reply('❌ Waduh, error nih! Coba lagi nanti atau kontak admin: @hiyaok');
});

// Start the bot
bot.launch().then(() => {
    console.log('Bot berhasil dijalankan!');
}).catch(err => {
    console.error('Error saat menjalankan bot:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
