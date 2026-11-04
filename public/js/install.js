// "Put the app on your home screen": a short animated guide in a pop-up. Shown when someone
// opens the scan or warehouse app in a browser (not once it is installed), once per visit
// until they say it is done.
import { SLUG } from './app.js';

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const KEY = `at.install.${SLUG}`;
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });

const GUIDES = {
  ios: { ring: [100, 188], sheet: 'Add to Home Screen', steps: ['Tap <b>Share</b> at the bottom of Safari', 'Tap <b>Add to Home Screen</b>', 'Tap <b>Add</b>. Done!'], note: 'Use Safari.' },
  android: { ring: [136, 14], sheet: 'Install app', steps: ['Tap <b>⋮</b> at the top right of Chrome', 'Tap <b>Install app</b>', 'Tap <b>Install</b>. Done!'], note: 'Use Chrome.' },
  desktop: { ring: [136, 14], sheet: 'Install AssetTracker', steps: ['Click the <b>install icon</b> in the address bar', 'Choose <b>Install AssetTracker</b>', 'Click <b>Install</b>. Done!'], note: 'Use Chrome or Edge.' },
};

const CSS = `
.ig { border: 0; border-radius: 16px; padding: 20px; width: min(400px, calc(100% - 24px)); background: var(--surface, #fff); color: var(--text, #1b2733); box-shadow: 0 10px 40px rgb(0 0 0 / 40%); }
.ig::backdrop { background: rgb(0 0 0 / 55%); }
.ig h2 { margin: 0 0 4px; font-size: 1.25rem; }
.ig .ig-note { margin: 0 0 10px; color: var(--muted, #5b6b7a); }
.ig-stage { display: grid; place-items: center; margin: 6px 0 10px; }
.ig-phone { width: 150px; height: 250px; }
.ig-l1, .ig-l2, .ig-l3 { opacity: 0; animation: ig-cycle 9s infinite; }
.ig-l2 { animation-name: ig-cycle2; } .ig-l3 { animation-name: ig-cycle3; }
@keyframes ig-cycle  { 0%,4% { opacity: 0 } 8%,30% { opacity: 1 } 34%,100% { opacity: 0 } }
@keyframes ig-cycle2 { 0%,33% { opacity: 0; transform: translateY(14px) } 38%,63% { opacity: 1; transform: none } 67%,100% { opacity: 0 } }
@keyframes ig-cycle3 { 0%,66% { opacity: 0; transform: scale(.7) } 72%,95% { opacity: 1; transform: none } 100% { opacity: 0 } }
.ig-ring { transform-box: fill-box; transform-origin: center; animation: ig-pulse 1.1s ease-out infinite; }
@keyframes ig-pulse { 0% { transform: scale(.6); opacity: 1 } 100% { transform: scale(1.7); opacity: 0 } }
.ig-steps { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 6px; counter-reset: s; }
.ig-steps li { counter-increment: s; display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 10px; background: var(--bg, #f3f5f7); opacity: .55; animation: ig-li 9s infinite; }
.ig-steps li::before { content: counter(s); flex: none; width: 24px; height: 24px; border-radius: 50%; background: var(--primary, #0b5cad); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: .85rem; }
.ig-steps li:nth-child(2) { animation-delay: 3s; } .ig-steps li:nth-child(3) { animation-delay: 6s; }
@keyframes ig-li { 0%,30% { opacity: 1; outline: 2px solid var(--primary, #0b5cad) } 34%,100% { opacity: .55; outline: 2px solid transparent } }
.ig .ig-actions { display: grid; gap: 8px; }
@media (prefers-reduced-motion: reduce) { .ig-l1, .ig-l2, .ig-l3, .ig-steps li { animation: none; opacity: 1; } .ig-l2, .ig-l3 { display: none; } .ig-ring { animation: none; } }
`;

function phoneSvg(g, desktop) {
  const [rx, ry] = g.ring;
  return `<svg class="ig-phone" viewBox="0 0 150 250" aria-hidden="true">
    <rect x="4" y="4" width="142" height="242" rx="22" fill="#1b2733"/><rect x="10" y="10" width="130" height="230" rx="16" fill="#f3f5f7"/>
    <rect x="10" y="10" width="130" height="26" rx="14" fill="#dfe5ea"/><rect x="18" y="16" width="100" height="14" rx="7" fill="#fff"/>
    <g fill="#0b5cad"><rect x="30" y="60" width="90" height="12" rx="4"/><rect x="30" y="82" width="64" height="8" rx="4" opacity=".4"/><rect x="30" y="100" width="90" height="46" rx="8" opacity=".15"/></g>
    ${isIOS ? '<rect x="10" y="212" width="130" height="28" rx="12" fill="#dfe5ea"/><path d="M100 226v-8m0 0l-4 4m4-4l4 4M95 222h-2v9h14v-9h-2" stroke="#0b5cad" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' : '<g fill="#5b6b7a"><circle cx="132" cy="20" r="1.8"/><circle cx="132" cy="25" r="1.8"/><circle cx="132" cy="30" r="1.8"/></g>'}
    <g class="ig-l1"><circle class="ig-ring" cx="${isIOS ? 100 : 132}" cy="${isIOS ? 226 : 25}" r="12" fill="none" stroke="#e8590c" stroke-width="3"/></g>
    <g class="ig-l2"><rect x="18" y="${isIOS ? 120 : 40}" width="114" height="${isIOS ? 108 : 52}" rx="12" fill="#fff" stroke="#c9d2da"/>
      <rect x="24" y="${isIOS ? 190 : 48}" width="102" height="30" rx="8" fill="#0b5cad" opacity=".14" stroke="#e8590c" stroke-width="2"/>
      <text x="75" y="${isIOS ? 209 : 67}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#1b2733" font-family="system-ui,sans-serif">${g.sheet}</text></g>
    <g class="ig-l3"><rect x="10" y="10" width="130" height="230" rx="16" fill="#e7edf3"/>
      <rect x="55" y="92" width="40" height="40" rx="10" fill="#0b5cad"/><g fill="#fff"><rect x="62" y="99" width="11" height="11" rx="1.5"/><rect x="77" y="99" width="11" height="11" rx="1.5"/><rect x="62" y="114" width="11" height="11" rx="1.5"/></g><path d="M85 117l-5 8h4l-1.5 6 6-8.5h-4z" fill="#ffd24a"/>
      <text x="75" y="148" text-anchor="middle" font-size="9" fill="#1b2733" font-family="system-ui,sans-serif">AssetTracker</text></g>
  </svg>`;
}

/** Opens the guide. Resolves when it is closed. */
export function showInstallGuide({ auto = false } = {}) {
  if (auto) {
    if (standalone()) return Promise.resolve();
    try { if (localStorage.getItem(KEY) === 'done' || sessionStorage.getItem(`${KEY}.shown`)) return Promise.resolve(); sessionStorage.setItem(`${KEY}.shown`, '1'); } catch { /* ignore */ }
  }
  const g = GUIDES[isIOS ? 'ios' : isAndroid ? 'android' : 'desktop'];
  if (!document.getElementById('ig-css')) { const st = document.createElement('style'); st.id = 'ig-css'; st.textContent = CSS; document.head.append(st); }
  const dlg = document.createElement('dialog');
  dlg.className = 'ig';
  dlg.innerHTML = `<h2>Add the app to your home screen</h2><p class="ig-note">${g.note} Then it opens like a normal app, also without signal.</p>
    <div class="ig-stage">${phoneSvg(g)}</div>
    <ol class="ig-steps">${g.steps.map((s) => `<li><span>${s}</span></li>`).join("")}</ol>
    <div class="ig-actions">
      ${installEvent ? '<button type="button" class="btn btn-primary btn-big" data-act="install">Add it now</button>' : ''}
      <button type="button" class="btn ${installEvent ? '' : 'btn-primary'} btn-big" data-act="done">I have added it</button>
      <button type="button" class="link-btn" data-act="later">Not now</button>
    </div>`;
  document.body.append(dlg);
  return new Promise((resolve) => {
    const close = (done) => {
      if (done) { try { localStorage.setItem(KEY, 'done'); } catch { /* ignore */ } }
      dlg.close(); dlg.remove(); resolve();
    };
    dlg.querySelector('[data-act=done]').onclick = () => close(true);
    dlg.querySelector('[data-act=later]').onclick = () => close(false);
    const inst = dlg.querySelector('[data-act=install]');
    if (inst) inst.onclick = async () => { installEvent.prompt(); const r = await installEvent.userChoice.catch(() => ({})); if (r.outcome === 'accepted') close(true); };
    dlg.addEventListener('cancel', () => close(false));
    dlg.showModal();
  });
}
