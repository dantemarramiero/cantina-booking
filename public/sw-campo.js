// Service worker della pagina da campo: tiene in memoria solo la pagina e i suoi file, così si apre anche
// senza rete. Le API non passano da qui: i dati (parcelle, prodotti, persone) e le bozze da inviare li
// salva la pagina sul dispositivo.
const CACHE = 'campo-v2';
const FILES = ['/campo.html', '/js/campo.js', '/js/prd-i18n.js', '/campo.webmanifest', '/img/campo-icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Prima la rete (per avere sempre l'ultima versione), la copia in memoria se la rete non c'è.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (!FILES.includes(url.pathname)) return;
  // Una risposta d'errore (es. 502 durante un aggiornamento del server) non sostituisce la copia buona.
  e.respondWith(fetch(e.request).then(res => {
    if (!res.ok) return caches.match(e.request).then(hit => hit || res);
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request)));
});
