import fs from 'fs';
import crypto from 'crypto';

function sha256(path) {
  const data = fs.readFileSync(path);
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Copy root files to public/
fs.copyFileSync('index.html', 'public/index.html');
fs.copyFileSync('app.js', 'public/app.js');
fs.copyFileSync('style.css', 'public/style.css');
fs.copyFileSync('landing.html', 'public/landing.html');
fs.copyFileSync('simplegst-app-v2.html', 'public/simplegst-app-v2.html');

const pairs = [
  ['index.html', 'public/index.html'],
  ['app.js', 'public/app.js'],
  ['style.css', 'public/style.css'],
  ['landing.html', 'public/landing.html'],
  ['simplegst-app-v2.html', 'public/simplegst-app-v2.html']
];

console.log('Verifying SHA-256 Parity:');
let allMatch = true;
pairs.forEach(([f1, f2]) => {
  const h1 = sha256(f1);
  const h2 = sha256(f2);
  const match = h1 === h2;
  console.log(`- ${f1} <-> ${f2}: ${match ? 'MATCH ✓' : 'MISMATCH ✗'} (${h1.slice(0, 16)}...)`);
  if (!match) allMatch = false;
});

if (!allMatch) {
  console.error('Parity check failed!');
  process.exit(1);
} else {
  console.log('All public/ files are 100% byte-for-byte identical.');
}

