const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist-electron');
const src = path.join(distDir, 'preload.js');
const dst = path.join(distDir, 'preload.cjs');

// Remove old .cjs if it exists (from previous build)
if (fs.existsSync(dst)) {
  fs.unlinkSync(dst);
}

if (fs.existsSync(src)) {
  fs.renameSync(src, dst);
  console.log('Renamed preload.js -> preload.cjs');
} else {
  console.error('preload.js not found in dist-electron');
  process.exit(1);
}
