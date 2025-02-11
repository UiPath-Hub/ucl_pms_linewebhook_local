const Service = require('node-windows').Service;
const package = require('./package.json');

// Create a new service object (same configuration as when it was installed)
const uninstall =async ()=>{
  console.log(`Uninstalling...\nPackage name:${package.name}`);
  const svc = new Service({
  name: package.name, // Replace with your service name
  });

  // Listen for the "uninstall" event
  svc.on('uninstall', () => {
  console.log('Service uninstalled!');
  });

  // Uninstall the service
  svc.uninstall();
}

uninstall();