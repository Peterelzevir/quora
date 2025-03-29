// config.js - Configuration file
const config = {
    botToken: '7776609805:AAHnDN-jnhl-TkG0g6FR8b3LnB9B0GeSyNc',
    adminId: ['5988451717'], // Array of admin user IDs
    contactAdmin: '@hiyaok',
    contactAdminUrl: 't.me/hiyaok',
    apiKey: 'YOUR_API_KEY',
    secretKey: 'YOUR_SECRET_KEY',
    apiUrl: 'https://buzzerpanel.id/api/json.php',
    serviceIds: {
        followers: '24044', // Instagram Followers service ID
        likes: '24047'      // Instagram Likes service ID
    },
    serviceQuantity: {
        followers: 1000,
        likes: 100
    },
    maxPrice: {
        followers: 10000,
        likes: 150000
    },
    mongoUri: 'mongodb+srv://dbquora:dbquora@tiktokdown.ug4ex.mongodb.net/?retryWrites=true&w=majority&appName=tiktokdown',
};

module.exports = config;
