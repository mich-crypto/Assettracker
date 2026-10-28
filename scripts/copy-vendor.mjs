// Copies the browser libraries into public/vendor so the PWA can cache them
// and work fully offline (no CDN dependency on the vessel or turbine).
import { cpSync, mkdirSync } from 'node:fs';

const files = [
  ['node_modules/leaflet/dist/leaflet.js', 'public/vendor/leaflet/leaflet.js'],
  ['node_modules/leaflet/dist/leaflet.css', 'public/vendor/leaflet/leaflet.css'],
  ['node_modules/leaflet/dist/images', 'public/vendor/leaflet/images'],
  ['node_modules/jsqr/dist/jsQR.js', 'public/vendor/jsQR.js'],
  ['node_modules/qrcode-generator/dist/qrcode.js', 'public/vendor/qrcode.js'],
];

mkdirSync('public/vendor/leaflet', { recursive: true });
for (const [from, to] of files) cpSync(from, to, { recursive: true });
console.log('vendor files copied');
