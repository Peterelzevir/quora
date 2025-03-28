// config.js
const config = {
    botToken: "7776609805:AAHnDN-jnhl-TkG0g6FR8b3LnB9B0GeSyNc", // Ganti dengan token bot Telegram kamu
    adminId: ["5988451717"], // Ganti dengan ID Telegram admin (array of strings)
    mongoUri: "mongodb+srv://quora:quora12@vcf.kiamp.mongodb.net/?retryWrites=true&w=majority&appName=vcf", // Ganti dengan URI MongoDB Atlas kamu
    apiKey: "YOUR_API_KEY", // Ganti dengan API key Buzzer Panel
    secretKey: "YOUR_SECRET_KEY", // Ganti dengan secret key Buzzer Panel
    apiUrl: "https://buzzerpanel.id/api/json.php",
    services: {
        viewers: "24044", // Quora viewers service ID
        upvotes: "24047" // Quora upvotes service ID
    },
    viewersQuantity: 1000,
    upvotesQuantity: 100
};

module.exports = config;
