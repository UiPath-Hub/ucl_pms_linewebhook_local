const Service = require('node-windows').Service;
const path = require('path');
const package = require('./package.json');

const installing=async ()=>{
  console.log(`Installing... \nPackage name:${package.name}\nScript: ./dist/${package.main}`);
  const svc = new Service({
    name: package.name,
    description: package.description,
    script: path.join(__dirname, 'dist', package.main),
    nodeOptions: [
      '--harmony',
      '--max_old_space_size=4096'
    ]
  });

  svc.on('install', () => {
    svc.start();
    console.log('Service installed and started!');
  });

  svc.install();
}

installing();
