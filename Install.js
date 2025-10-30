const Service = require('node-windows').Service;
const path = require('path');
const dotenv = require('dotenv');
const packageJson = require('./package.json');

//โหลดค่าจากไฟล์ .env
dotenv.config();

const installing = async () => {
  console.log(`Installing... 
Package name: ${packageJson.name}
Script: ./dist/${packageJson.main}`);

  //อ่านค่าจาก process.env
  const envVars = [
    { name: 'PORTAL_API_TOKEN', value: process.env.PORTAL_API_TOKEN },
    { name: 'PORTAL_PORT', value: process.env.PORTAL_PORT },
    { name: 'DATABASE_URL', value: process.env.DATABASE_URL },
    { name: 'STORAGEBUCKET_URL', value: process.env.STORAGEBUCKET_URL }
  ];

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
