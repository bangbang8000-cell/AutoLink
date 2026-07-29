const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist-electron');

if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
  console.log('Cleaned dist-electron');
}
