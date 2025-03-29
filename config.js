// config.js
const config = {
    telegramToken: "YOUR_TELEGRAM_BOT_TOKEN",
    apiKey: "YOUR_BUZZER_PANEL_API_KEY",
    secretKey: "YOUR_BUZZER_PANEL_SECRET_KEY",
    apiUrl: "https://buzzerpanel.id/api/json.php",
    adminId: ["5988451717"], // Admin Telegram IDs
    mongoUri: "mongodb+srv://dbquora:dbquora@tiktokdown.ug4ex.mongodb.net/?retryWrites=true&w=majority&appName=tiktokdown",
    serviceIds: {
        first: "24044", // First service ID (max price 10,000)
        second: "24047" // Second service ID (max price 150,000)
    },
    quantities: {
        first: 1000, // Quantity for first service
        second: 100  // Quantity for second service
    }
};

module.exports = config;
