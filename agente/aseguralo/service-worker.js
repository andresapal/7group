/* Service Worker Aseguralo ERP SIRILO
   Estrategia: network-first para HTML/JSON (frescura primero), cache-first para assets estaticos.
   Version: bump el CACHE_NAME cuando cambies el shell para forzar invalidacion. */

var CACHE_NAME = 'aseguralo-v4-2026-09-11-icon';
var STATIC_ASSETS = [
  '/agente/aseguralo/',
  '/agente/aseguralo/index.html',
  '/agente/aseguralo/manifest.json',
  '/logo-aseguralo.png',
  '/agente/aseguralo/icon-aseguralo.png'
];

self.addEventListener('install', function(event){
  // Pre-cache del shell basico para arranque offline
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(STATIC_ASSETS).catch(function(){ /* silencioso */ });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  // Purgar caches viejos
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if(k !== CACHE_NAME) return caches.delete(k);
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event){
  var req = event.request;
  // Solo interceptar GET
  if(req.method !== 'GET') return;
  var url = new URL(req.url);
  // NO interceptar peticiones a APIs y auth de Google — el SW rompe FedCM/OAuth si las toca
  if(url.host.indexOf('script.google') >= 0 ||
     url.host.indexOf('googleapis') >= 0 ||
     url.host.indexOf('accounts.google.com') >= 0 ||    // ← Google Identity Services / Sign-In
     url.host.indexOf('gstatic.com') >= 0 ||            // ← assets de Google auth
     url.host.indexOf('drive.google') >= 0 ||
     url.host.indexOf('generativelanguage.googleapis') >= 0){ // ← Gemini
    return; // sin interceptar, va a red normal (indispensable para OAuth y FedCM)
  }
  // Network-first para HTML (queremos siempre lo nuevo). Cache-first para el resto (rapido).
  var isHTML = req.headers.get('accept') && req.headers.get('accept').indexOf('text/html') >= 0;
  if(isHTML){
    event.respondWith(
      fetch(req).then(function(res){
        // Actualiza cache del index en background
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function(c){ c.put(req, copy).catch(function(){}); });
        return res;
      }).catch(function(){
        // Sin red: sirve del cache
        return caches.match(req).then(function(cached){
          return cached || caches.match('/agente/aseguralo/');
        });
      })
    );
    return;
  }
  // Assets estaticos: cache-first con actualizacion en background
  event.respondWith(
    caches.match(req).then(function(cached){
      var networkFetch = fetch(req).then(function(res){
        if(res && res.status === 200){
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function(c){ c.put(req, copy).catch(function(){}); });
        }
        return res;
      }).catch(function(){ return cached; });
      return cached || networkFetch;
    })
  );
});
