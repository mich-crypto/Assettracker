// Printing and QR helpers shared by the admin and warehouse pages.

/** Prints just one element: the print stylesheet shows only `.print-area`. */
export function printOnly(el) {
  const others = [...document.querySelectorAll('.print-area')].filter((x) => x !== el);
  others.forEach((x) => x.classList.remove('print-area'));
  if (el.tagName === 'DETAILS') el.open = true;
  const had = el.classList.contains('print-area');
  el.classList.add('print-area');
  const restore = () => {
    if (!had) el.classList.remove('print-area');
    others.forEach((x) => x.classList.add('print-area'));
  };
  window.addEventListener('afterprint', restore, { once: true });
  window.print();
}

/** A scalable QR code as SVG markup (needs /vendor/qrcode.js on the page). */
export function qrSvg(text, { cell = 4, margin = 2, level = 'M' } = {}) {
  const qr = window.qrcode(0, level);
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: cell, margin, scalable: true });
}

/** QR code as a PNG blob, for attaching to an e-mail. */
export async function qrPng(text, px = 600) {
  const svg = qrSvg(text);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, px, px);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, px, px);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
