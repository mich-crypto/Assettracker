// Project home page: three entry points. The "add to home screen" guide opens in Scan and Warehouse.
import { SLUG, api, path, registerServiceWorker, requireProject, warmPages } from './app.js';

const $ = (id) => document.getElementById(id);

function init() {
  registerServiceWorker();
  $('r-field').href = path('field');
  $('r-warehouse').href = path('warehouse');
  $('r-overview').href = path('overview');
  document.title = `${SLUG} · AssetTracker`;
  api('/api/info').then(({ project }) => {
    $('project-name').textContent = project.name;
    document.title = `${project.name} · AssetTracker`;
  }).catch((e) => { if (e.status === 404) location.replace('/'); });
  // Make the other pages available offline from the first visit.
  setTimeout(warmPages, 1500);
}

if (requireProject()) init();
