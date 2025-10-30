const Service = require('node-windows').Service;
const path = require('path');
const dotenv = require('dotenv');
const packageJson = require('./package.json');

// โหลดค่าจากไฟล์ .env
dotenv.config();

const installing = async () => {
  console.log(`Installing... 
Package name: ${packageJson.name}
Script: ./dist/${packageJson.main}`);

  // รายการ env variables ที่ต้องมี
  const requiredEnvVars = ['PORTAL_API_TOKEN', 'PORTAL_PORT', 'DATABASE_URL', 'STORAGEBUCKET_URL','LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'UIPATH_APP_ID', 'UIPATH_APP_SECRET', 'UIPATH_CLOUD_TENANT_ADDRESS', 'UIPATH_SCOPE' ];

  // ตรวจสอบว่าค่า env ถูกตั้งครบหรือไม่
  const missingVars = requiredEnvVars.filter(key => !process.env[key]);
  if (missingVars.length > 0) {
    console.error('Cannot install service. Missing environment variables:', missingVars.join(', '));
    process.exit(1); // หยุด script ถ้า env ไม่ครบ
  }

  // สร้าง array ของ env variables สำหรับ node-windows
  const envVars = requiredEnvVars.map(key => ({
    name: key,
    value: process.env[key]
  }));

  const svc = new Service({
    name: packageJson.name,
    description: packageJson.description,
    script: path.join(__dirname, 'dist', packageJson.main),
    nodeOptions: [
      '--harmony',
      '--max_old_space_size=4096'
    ],
    env: envVars
  });

  svc.on('install', () => {
    console.log('Service installed successfully!');
    svc.start();
  });

  svc.on('error', (err) => {
    console.error('Installation error:', err);
  });

  svc.install();
};

installing();
