// QR (camera) and NFC tag reading, plus the tag-code format.
//
// A tag code is a short id like "AT-7K3QX9M2PD". QR labels and NFC tags store
// it inside a URL (https://<site>/field#t=AT-...), so scanning with the
// phone's normal camera app, or tapping an NFC tag on an iPhone, opens the
// field app straight on that asset. NFC tags without our URL record are
// identified by their hardware serial number ("NFC-04A2...").

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U

export function newTagCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return 'AT-' + Array.from(bytes, (b) => ALPHABET[b % 32]).join('');
}

export function tagUrl(code) {
  return `${location.origin}/field#t=${encodeURIComponent(code)}`;
}

/** Extracts a tag code from scanned text: our URL, or a bare code / serial. */
export function parseTagText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const fromHash = new URLSearchParams(u.hash.slice(1)).get('t');
    const fromQuery = u.searchParams.get('t');
    if (fromHash || fromQuery) return (fromHash || fromQuery).trim();
  } catch { /* not a URL */ }
  return raw.slice(0, 120);
}

export const nfcSupported = () => 'NDEFReader' in window;

function nfcSerialCode(serial) {
  return serial ? 'NFC-' + serial.replace(/:/g, '').toUpperCase() : null;
}

/** Reads one NFC tag (Android Chrome). Resolves { code, serialCode }. */
export async function readNfc(signal) {
  const reader = new NDEFReader();
  await reader.scan({ signal });
  return new Promise((resolve, reject) => {
    reader.onreadingerror = () => reject(new Error('Could not read the tag. Hold the phone still against it.'));
    reader.onreading = (event) => {
      let code = null;
      const dec = new TextDecoder();
      for (const rec of event.message.records) {
        if (rec.recordType === 'url' || rec.recordType === 'text' || rec.recordType === 'absolute-url') {
          code = parseTagText(dec.decode(rec.data));
          if (code) break;
        }
      }
      const serialCode = nfcSerialCode(event.serialNumber);
      resolve({ code: code || serialCode, serialCode });
    };
  });
}

/** Writes our tag URL to an NFC tag (Android Chrome). */
export async function writeNfc(code, signal) {
  const writer = new NDEFReader();
  await writer.write({ records: [{ recordType: 'url', data: tagUrl(code) }] }, { signal });
}

/**
 * Opens a full-screen camera scanner. Resolves with the decoded text, or null
 * if cancelled. Uses the native BarcodeDetector when available, else jsQR.
 */
export function scanQr() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'scanner';
    overlay.innerHTML = `
      <video playsinline muted></video>
      <div class="scanner-frame"></div>
      <p class="scanner-hint">Point the camera at the QR label</p>
      <button type="button" class="btn btn-light scanner-close">Cancel</button>`;
    document.body.append(overlay);
    const video = overlay.querySelector('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let stream;
    let done = false;
    let detector = null;

    const finish = (value) => {
      if (done) return;
      done = true;
      stream?.getTracks().forEach((t) => t.stop());
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector('.scanner-close').onclick = () => finish(null);

    const tick = async () => {
      if (done) return;
      if (video.readyState >= 2) {
        try {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes.length) return finish(codes[0].rawValue);
          } else if (window.jsQR) {
            const w = Math.min(video.videoWidth, 800);
            const h = Math.round((video.videoHeight / video.videoWidth) * w);
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(video, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const hit = window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
            if (hit?.data) return finish(hit.data);
          }
        } catch { /* keep scanning */ }
      }
      setTimeout(tick, detector ? 150 : 250);
    };

    (async () => {
      try {
        if ('BarcodeDetector' in window) {
          const formats = await window.BarcodeDetector.getSupportedFormats?.();
          if (!formats || formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        }
        if (!detector && !window.jsQR) await loadScript('/vendor/jsQR.js');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        video.srcObject = stream;
        await video.play();
        tick();
      } catch (e) {
        overlay.querySelector('.scanner-hint').textContent =
          'Camera not available: ' + (e.message || e.name) + '. Type the code instead.';
      }
    })();
  });
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.append(s);
  });
}
