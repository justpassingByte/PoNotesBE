const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function main() {
    // Check if the admin user exists, or just use the first user
    const user = await prisma.user.findFirst();
    
    if (!user) {
        console.error("Vui lòng đăng ký 1 tài khoản User trên Frontend trước để có chỗ gắn Key!");
        return;
    }

    const rawKey = 'ROBINHUD-ADMIN-KEY-9999';
    const hashedKey = crypto.createHash('sha256').update(rawKey).digest('hex');

    const key = await prisma.apiKey.create({
        data: {
            user_id: user.id,
            key_hash: hashedKey,
            name: "Admin Master Key",
            plan: "pro", // Hoặc Ultimate
            expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 năm
            max_devices: 10,
        }
    });

    console.log("==================================================");
    console.log("🔥 ĐÃ TẠO ADMIN KEY THÀNH CÔNG 🔥");
    console.log(`API Key của anh là: ${rawKey}`);
    console.log(`Thuộc về user: ${user.email || user.username}`);
    console.log("==================================================");
    console.log("Copy đoạn trên dán vào ô Settings của phần mềm Desktop nha anh!");
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
