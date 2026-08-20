const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist-electron');

// 打磨轮（v1.5 / AL-V1a）：preload.ts → preload.cjs、splash-preload.ts → splash-preload.cjs
const pairs = [
  ['preload.js', 'preload.cjs'],
  ['splash-preload.js', 'splash-preload.cjs'],
];

for (const [srcName, dstName] of pairs) {
  const src = path.join(distDir, srcName);
  const dst = path.join(distDir, dstName);
  if (fs.existsSync(dst)) {
    fs.unlinkSync(dst);
  }
  if (fs.existsSync(src)) {
    fs.renameSync(src, dst);
    console.log(`Renamed ${srcName} -> ${dstName}`);
  } else {
    console.error(`${srcName} not found in dist-electron`);
    process.exit(1);
  }
}
