/**
 * ==============================================================================
 * Prototype de Jeu de Piste Géolocalisé (MVP)
 * Architecture : Vanilla JS + Leaflet.js
 * Compatible : GitHub Pages (HTTPS requis pour l'API Geolocation)
 * ==============================================================================
 */

// --- 1. Constantes & Configuration Métier ---
const CONFIG = {
  // Coordonnées du centre initial de la carte (Lens)
  MAP_CENTER: [50.4292, 2.8319],
  DEFAULT_ZOOM: 15,

  // Coordonnées de l'étape cible : Stade Bollaert-Delelis
  POI_COORDS: [50.4328, 2.8145],
  POI_NAME: "Stade Bollaert-Delelis",

  // Rayon de tolérance pour valider l'étape (en mètres)
  VALIDATION_RADIUS: 30,

  // Options du capteur GPS (haute précision)
  GEOLOCATION_OPTIONS: {
    enableHighAccuracy: true, // Force l'usage de la puce GPS sur mobile
    timeout: 15000,          // Temps max pour obtenir un fix (15s)
    maximumAge: 0            // Désactive le cache pour garantir du temps réel
  }
};

// --- 2. État Global de l'Application ---
const state = {
  map: null,
  watchId: null,
  isTracking: false,
  userLatLng: null,
  userAccuracy: null,
  distanceToPoi: null,
  isValidated: false,
  hasInitialCentered: false,
  // Références aux calques Leaflet
  userMarker: null,
  userAccuracyCircle: null,
  poiMarker: null,
  poiCircle: null
};

// --- 3. Sélecteurs DOM ---
const dom = {
  btnToggleGps: document.getElementById('btn-toggle-gps'),
  btnRecenter: document.getElementById('btn-recenter'),
  btnLabel: document.getElementById('btn-label'),
  headerStatus: document.getElementById('header-status'),
  statusDot: document.getElementById('status-dot'),
  pingIndicator: document.getElementById('ping-indicator'),
  metricDistance: document.getElementById('metric-distance'),
  metricDistanceUnit: document.getElementById('metric-distance-unit'),
  metricAccuracy: document.getElementById('metric-accuracy'),
  accuracyLevel: document.getElementById('accuracy-level'),
  badgeValidation: document.getElementById('badge-validation'),
  errorBanner: document.getElementById('error-banner'),
  errorTitle: document.getElementById('error-title'),
  errorMsg: document.getElementById('error-msg'),
  btnCloseError: document.getElementById('btn-close-error')
};

// --- 4. Initialisation de la Carte Leaflet ---
function initMap() {
  // Initialisation de l'instance Leaflet
  state.map = L.map('map', {
    zoomControl: true,
    attributionControl: true
  }).setView(CONFIG.MAP_CENTER, CONFIG.DEFAULT_ZOOM);

  // Couche de tuiles OpenStreetMap
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(state.map);

  // Création du Point d'Intérêt (POI) - Stade Bollaert
  setupPoiLayer();
}

/**
 * Configure et affiche le marqueur et la zone de validation (cercle de 30m) du POI
 */
function setupPoiLayer() {
  // Icône personnalisée pour le POI (balise rouge/or)
  const poiIcon = L.divIcon({
    className: 'poi-custom-icon',
    html: `
      <div class="relative flex items-center justify-center">
        <span class="absolute -top-7 px-2 py-0.5 bg-slate-900/90 text-white text-[10px] font-bold rounded shadow-md whitespace-nowrap">
          ${CONFIG.POI_NAME}
        </span>
        <svg class="w-8 h-8 text-rose-600 drop-shadow-md" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 32]
  });

  // Marqueur fixe
  state.poiMarker = L.marker(CONFIG.POI_COORDS, { icon: poiIcon })
    .addTo(state.map)
    .bindPopup(`<strong>${CONFIG.POI_NAME}</strong><br>Rayon de validation : ${CONFIG.VALIDATION_RADIUS} m`);

  // Cercle de détection / zone de validation (30 mètres)
  state.poiCircle = L.circle(CONFIG.POI_COORDS, {
    radius: CONFIG.VALIDATION_RADIUS,
    color: '#e11d48',        // Bordure rouge (Rose-600)
    fillColor: '#f43f5e',    // Remplissage rose semi-transparent
    fillOpacity: 0.18,
    weight: 2,
    dashArray: '5, 8'        // Ligne pointillée
  }).addTo(state.map);
}

// --- 5. Algorithme de Calcul de Distance (Haversine) ---
/**
 * Calcule la distance orthodromique (grand cercle) en mètres entre deux points GPS.
 * Note : Leaflet intègre également L.latLng.distanceTo(), mais cette fonction
 * explicite la formule mathématique de Haversine demandée dans le cahier des charges.
 * 
 * @param {number} lat1 Latitude point 1
 * @param {number} lon1 Longitude point 1
 * @param {number} lat2 Latitude point 2
 * @param {number} lon2 Longitude point 2
 * @returns {number} Distance en mètres
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const EARTH_RADIUS = 6371000; // Rayon moyen de la Terre en mètres
  const toRadians = degrees => (degrees * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS * c;
}

// --- 6. Gestion du Cycle de Vie de la Géolocalisation ---

/**
 * Déclenche le suivi GPS ou l'arrête
 */
function toggleGeolocation() {
  if (state.isTracking) {
    stopGeolocation();
  } else {
    startGeolocation();
  }
}

/**
 * Lance la surveillance de la position GPS via l'API Geolocation standard
 */
function startGeolocation() {
  hideError();

  // Vérification de la compatibilité du navigateur
  if (!('geolocation' in navigator)) {
    showError(
      "Appareil incompatible",
      "Votre navigateur ne supporte pas l'API Geolocation HTML5."
    );
    return;
  }

  // Avertissement de sécurité (HTTPS obligatoire en production)
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    showError(
      "Contexte non sécurisé (HTTPS)",
      "La géolocalisation mobile exige une connexion sécurisée HTTPS (ex: GitHub Pages)."
    );
  }

  // Mise à jour de l'UI en état "Recherche..."
  updateUiStarting();

  // Démarrage du suivi continu haute précision
  state.watchId = navigator.geolocation.watchPosition(
    onLocationSuccess,
    onLocationError,
    CONFIG.GEOLOCATION_OPTIONS
  );

  state.isTracking = true;
}

/**
 * Arrête le suivi GPS pour économiser la batterie
 */
function stopGeolocation() {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  state.isTracking = false;
  state.hasInitialCentered = false;

  // Mise à jour de l'UI
  dom.btnLabel.textContent = "Activer la géolocalisation";
  dom.btnToggleGps.classList.remove('bg-slate-700', 'hover:bg-slate-800');
  dom.btnToggleGps.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
  dom.btnRecenter.classList.add('hidden');
  
  dom.headerStatus.textContent = "GPS Inactif";
  dom.statusDot.className = "relative inline-flex rounded-full h-3 w-3 bg-amber-500";
  dom.pingIndicator.classList.add('hidden');
}

// --- 7. Callbacks de Géolocalisation ---

/**
 * Callback de succès appelé à chaque actualisation du signal GPS
 * @param {GeolocationPosition} position 
 */
function onLocationSuccess(position) {
  const { latitude, longitude, accuracy } = position.coords;
  state.userLatLng = [latitude, longitude];
  state.userAccuracy = Math.round(accuracy);

  // 1. Calcul mathématique de la distance avec le POI
  state.distanceToPoi = Math.round(
    calculateHaversineDistance(
      latitude,
      longitude,
      CONFIG.POI_COORDS[0],
      CONFIG.POI_COORDS[1]
    )
  );

  // 2. Mise à jour de la carte (position du joueur & cercle d'imprécision)
  updateMapUserLayer(latitude, longitude, accuracy);

  // 3. Premier centrage automatique : adapter la vue pour englober joueur et cible
  if (!state.hasInitialCentered) {
    centerMapOnUserAndTarget();
    state.hasInitialCentered = true;
  }

  // 4. Mise à jour des compteurs et de la validation
  updateUiWithMetrics();
}

/**
 * Callback d'erreur en cas de problème GPS ou refus de permission
 * @param {GeolocationPositionError} error 
 */
function onLocationError(error) {
  let message = "Une erreur inconnue est survenue.";
  
  switch (error.code) {
    case error.PERMISSION_DENIED:
      message = "Permission refusée. Veuillez autoriser l'accès à la localisation dans les réglages de votre navigateur.";
      break;
    case error.POSITION_UNAVAILABLE:
      message = "Signal GPS indisponible. Vérifiez que la localisation est active sur votre smartphone.";
      break;
    case error.TIMEOUT:
      message = "Délai d'attente dépassé pour obtenir un signal GPS précis.";
      break;
  }

  showError("Erreur GPS", message);
  stopGeolocation();
}

// --- 8. Mises à jour Graphiques Leaflet ---

/**
 * Met à jour ou instancie le point bleu dynamique et le cercle d'incertitude
 */
function updateMapUserLayer(lat, lon, accuracy) {
  const latLng = [lat, lon];

  if (!state.userMarker) {
    // Création de l'icône personnalisée avec effet de pulsation radar
    const userIcon = L.divIcon({
      className: 'user-marker-container',
      html: `
        <div class="user-location-marker">
          <div class="user-marker-pulse"></div>
          <div class="user-marker-core"></div>
        </div>
      `,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    state.userMarker = L.marker(latLng, {
      icon: userIcon,
      zIndexOffset: 1000 // Toujours au-dessus des autres éléments
    }).addTo(state.map);

    // Cercle d'imprécision GPS (bleu clair)
    state.userAccuracyCircle = L.circle(latLng, {
      radius: accuracy,
      color: '#3b82f6',
      fillColor: '#93c5fd',
      fillOpacity: 0.15,
      weight: 1
    }).addTo(state.map);

  } else {
    // Déplacement fluide des couches existantes
    state.userMarker.setLatLng(latLng);
    state.userAccuracyCircle.setLatLng(latLng);
    state.userAccuracyCircle.setRadius(accuracy);
  }
}

/**
 * Ajuste le zoom pour visualiser à la fois le joueur et le POI
 */
function centerMapOnUserAndTarget() {
  if (!state.userLatLng) return;

  const bounds = L.latLngBounds([
    state.userLatLng,
    CONFIG.POI_COORDS
  ]);

  state.map.fitBounds(bounds, {
    padding: [100, 100],
    maxZoom: 17,
    animate: true
  });
}

/**
 * Recentrage centré strictement sur le joueur
 */
function centerOnUser() {
  if (state.userLatLng) {
    state.map.flyTo(state.userLatLng, 17, { animate: true, duration: 1 });
  }
}

// --- 9. Mises à jour de l'Interface Utilisateur (UI) ---

function updateUiStarting() {
  dom.btnLabel.textContent = "Arrêter le suivi GPS";
  dom.btnToggleGps.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
  dom.btnToggleGps.classList.add('bg-slate-700', 'hover:bg-slate-800');
  dom.btnRecenter.classList.remove('hidden');

  dom.headerStatus.textContent = "Acquisition GPS...";
  dom.statusDot.className = "relative inline-flex rounded-full h-3 w-3 bg-amber-500";
  dom.pingIndicator.classList.remove('hidden');
}

function updateUiWithMetrics() {
  // Statut général dans l'en-tête
  dom.headerStatus.textContent = "GPS Actif (Haute Précision)";
  dom.statusDot.className = "relative inline-flex rounded-full h-3 w-3 bg-emerald-500";
  dom.pingIndicator.classList.remove('hidden');

  // Affichage de la précision
  dom.metricAccuracy.textContent = state.userAccuracy;
  
  if (state.userAccuracy <= 10) {
    dom.accuracyLevel.textContent = "Signal Excellent";
    dom.accuracyLevel.className = "text-[10px] font-semibold text-emerald-600 mt-0.5";
  } else if (state.userAccuracy <= 25) {
    dom.accuracyLevel.textContent = "Signal Bon";
    dom.accuracyLevel.className = "text-[10px] font-semibold text-blue-600 mt-0.5";
  } else {
    dom.accuracyLevel.textContent = "Signal Moyen / Imprécis";
    dom.accuracyLevel.className = "text-[10px] font-semibold text-amber-600 mt-0.5";
  }

  // Formatage de la distance
  if (state.distanceToPoi >= 1000) {
    dom.metricDistance.textContent = (state.distanceToPoi / 1000).toFixed(2);
    dom.metricDistanceUnit.textContent = "km";
  } else {
    dom.metricDistance.textContent = state.distanceToPoi;
    dom.metricDistanceUnit.textContent = "m";
  }

  // Évaluation de la validation de zone (seuil de 30m)
  const isInsideTarget = state.distanceToPoi <= CONFIG.VALIDATION_RADIUS;

  if (isInsideTarget) {
    triggerValidationSuccess();
  } else {
    triggerWaitingState();
  }
}

/**
 * Déclenchement de la validation quand l'utilisateur est à ≤ 30m
 */
function triggerValidationSuccess() {
  dom.badgeValidation.textContent = "Étape Validée ! 🎉";
  dom.badgeValidation.className = "px-3 py-1 rounded-full text-xs font-bold bg-emerald-500 text-white shadow-md shadow-emerald-500/30 transition-all duration-300";

  // Retouche visuelle du cercle POI pour le passer au vert
  if (state.poiCircle) {
    state.poiCircle.setStyle({
      color: '#059669',
      fillColor: '#10b981',
      fillOpacity: 0.35,
      dashArray: null
    });
  }

  // Vibration haptique sur smartphone si supportée
  if (!state.isValidated && navigator.vibrate) {
    navigator.vibrate([150, 80, 200]);
  }

  state.isValidated = true;
}

function triggerWaitingState() {
  dom.badgeValidation.textContent = "En approche";
  dom.badgeValidation.className = "px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200";

  // Réinitialisation du style du cercle POI
  if (state.poiCircle) {
    state.poiCircle.setStyle({
      color: '#e11d48',
      fillColor: '#f43f5e',
      fillOpacity: 0.18,
      dashArray: '5, 8'
    });
  }

  state.isValidated = false;
}

function showError(title, msg) {
  dom.errorTitle.textContent = title;
  dom.errorMsg.textContent = msg;
  dom.errorBanner.classList.remove('hidden');
}

function hideError() {
  dom.errorBanner.classList.add('hidden');
}

// --- 10. Attachement des Événements ---
document.addEventListener('DOMContentLoaded', () => {
  initMap();

  dom.btnToggleGps.addEventListener('click', toggleGeolocation);
  dom.btnRecenter.addEventListener('click', centerOnUser);
  dom.btnCloseError.addEventListener('click', hideError);
});

