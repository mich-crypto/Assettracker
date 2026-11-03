// Project home page: what the app is for, how to put it on the home screen
// (explained the first time), and the three entry points.
import { SLUG, api, path, registerServiceWorker, requireProject, warmPages } from './app.js';

const $ = (id) => document.getElementById(id);
const KEY = `at.install.${SLUG}`;
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installEvent = null;

const GUIDE = {
  ios: {
    device: 'You are on an iPhone or iPad. Use Safari.',
    steps: ['Tap the <b>Share</b> button (the square with an arrow) at the bottom of Safari.', 'Scroll down and tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b>. The AssetTracker icon appears on your home screen.'],
  },
  android: {
    device: 'You are on an Android phone. Use Chrome.',
    steps: ['Tap the <b>⋮ menu</b> at the top right of Chrome.', 'Tap <b>Install app</b> (or <b>Add to Home screen</b>).', 'Tap <b>Install</b>. The AssetTracker icon appears on your home screen.'],
  },
  desktop: {
    device: 'You are on a laptop or desktop. Use Chrome or Edge.',
    steps: ['Click the <b>install icon</b> at the right end of the address bar, or open the browser menu.', 'Choose <b>Install AssetTracker</b> (Edge: Apps → Install this site as an app).', 'Click <b>Install</b>. The app opens in its own window and can be pinned to the taskbar.'],
  },
};

function showGuide() {
  const g = GUIDE[isIOS ? 'ios' : isAndroid ? 'android' : 'desktop'];
  $('install-device').textContent = g.device;
  $('install-steps').innerHTML = g.steps.map((s) => `<li>${s}</li>`).join('');
  $('install-card').classList.remove('hidden');
  $('install-btn').classList.toggle('hidden', !installEvent);
}

function dismiss(done) {
  try { localStorage.setItem(KEY, done ? 'done' : 'later'); } catch { /* private mode */ }
  $('install-card').classList.add('hidden');
}

async function init() {
  registerServiceWorker();
  $('r-field').href = path('field');
  $('r-warehouse').href = path('warehouse');
  $('r-overview').href = path('overview');
  document.title = `${SLUG} · AssetTracker`;

  api('/api/info').then(({ project }) => {
    $('project-name').textContent = project.name;
    document.title = `${project.name} · AssetTracker`;
  }).catch((e) => {
    if (e.status === 404) location.replace('/');
  });

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; $('install-btn').classList.remove('hidden'); });
  $('install-btn').onclick = async () => { if (installEvent) { installEvent.prompt(); await installEvent.userChoice; dismiss(true); } };
  $('install-done').onclick = () => dismiss(true);
  $('install-later').onclick = () => dismiss(false);
  $('show-install').onclick = showGuide;

  let seen = null;
  try { seen = localStorage.getItem(KEY); } catch { /* ignore */ }
  if (!standalone && !seen) showGuide();

  // Make the other pages available offline from the first visit.
  setTimeout(warmPages, 1500);
}

if (requireProject()) init();
