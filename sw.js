'use strict';

// Versionner ce cache à chaque modification importante du service worker.
const CACHE_NAME = 'regie-tournage-v3';
const APP_SHELL = ['./'];
const API_HOSTS = /(^|\.)(?:firebaseio\.com|firebasedatabase\.app|open-meteo\.com)$/i;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Ne pas faire échouer l'installation entière si le serveur refuse temporairement
    // la mise en cache de la page d'accueil.
    await Promise.all(APP_SHELL.map(async url => {
      try { await cache.add(url); } catch (error) { /* nouvel essai lors d'une visite */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('regie-tournage-') && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (error) { return; }
  // Les API doivent rester réseau uniquement : ne jamais servir de fausses données
  // en cache pour les synchronisations Firebase ou les prévisions météo.
  if (API_HOSTS.test(url.hostname)) return;

  // Navigation : essayer le réseau pour obtenir la dernière version, puis la copie locale.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response && response.ok) await cache.put(request, response.clone());
        return response;
      } catch (error) {
        return (await cache.match(request, {ignoreSearch:true})) ||
          (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Ressources statiques, y compris les scripts Firebase servis par gstatic :
  // mise en cache à la première consultation réussie, puis repli hors connexion.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, {ignoreSearch:true});
    if (cached) {
      // Actualisation en arrière-plan pour les prochaines visites.
      fetch(request).then(response => {
        if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone()).catch(()=>{});
      }).catch(()=>{});
      return cached;
    }
    try {
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone()).catch(()=>{});
      return response;
    } catch (error) {
      return (await cache.match('./')) || Response.error();
    }
  })());
});
