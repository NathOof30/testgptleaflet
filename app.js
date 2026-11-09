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
  btnTrackHeading: document.getElementById('btn-track-heading'),
  compassBtnIcon: document.getElementById('compass-btn-icon'),
  btnLabel: document.getElementById('btn-label'),
  headerStatus: document.getElementById('header-status'),
  statusDot: document.getElementById('status-dot'),
  stageTitle: document.getElementById('stage-title'),
  metricDistance: document.getElementById('metric-distance'),
  metricDistanceUnit: document.getElementById('metric-distance-unit'),
  metricAccuracy: document.getElementById('metric-accuracy'),
  badgeValidation: document.getElementById('badge-validation'),
  btnSimulatePoi: document.getElementById('btn-simulate-poi'),
  errorBanner: document.getElementById('error-banner'),
  errorMsg: document.getElementById('error-msg'),
  btnCloseError: document.getElementById('btn-close-error')
};

// --- 4. Initialisation de la Carte Leaflet (avec Plugin Leaflet-Rotate) ---
function initMap() {
  // Initialisation de l'instance Leaflet avec rotation tactile & logicielle
  state.map = L.map('map', {
    zoomControl: true,
    attributionControl: true,
    // Options Leaflet-Rotate
    rotate: true,             // Active le moteur de rotation de carte
    touchRotate: true,        // Permet la rotation manuelle à deux doigts (pinch/rotate)
    rotateControl: false,     // Masque le contrôle par défaut au profit de notre bouton custom
    bearing: 0                // Cap initial à 0° (Nord en haut)
  }).setView(CONFIG.MAP_CENTER, CONFIG.DEFAULT_ZOOM);

  // Couche de tuiles OpenStreetMap
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(state.map);

  // Interruption automatique du suivi de cap si l'utilisateur manipule manuellement la carte
  state.map.on('dragstart zoomstart rotatestart', () => {
    if (headingState.isTracking) {
      console.log("Interaction manuelle détectée : arrêt du mode suivi de cap.");
      stopHeadingTracking();
    }
  });

  // Création du Point d'Intérêt (POI) - Stade Bollaert
  setupPoiLayer();

  // Recalcul de la géométrie de la carte après application de la perspective 3D
  setTimeout(() => {
    state.map.invalidateSize();
  }, 250);
}

// --- 4.1. Configuration Graphique du Pion Joueur (Asset pion.webp 2D) ---
// Utilisation directe du fichier pion.webp fourni à la racine (ratio natif 170x303)
// Affichage en 2D pur, sans déformation trapézoïdale de perspective
const boardPawnIcon = L.icon({
  iconUrl: 'pion.webp',
  iconSize: [40, 71],        // Dimensions adaptées au ratio d'origine
  iconAnchor: [20, 71],      // Ancrage au sol : base inférieure centrée
  popupAnchor: [0, -68],
  className: 'board-pion'    // Style 2D net avec ombre portée et rebond
});

/**
 * Configure et affiche le marqueur et la zone de validation (cercle de 30m) du POI
 */
function setupPoiLayer() {
  // Icône personnalisée pour le POI (balise / fanion redressé sur le plateau)
  const poiIcon = L.divIcon({
    className: 'poi-custom-icon',
    html: `
      <div class="relative flex flex-col items-center justify-end">
        <span class="px-2.5 py-0.5 mb-1 bg-slate-900/90 text-white text-[10px] font-bold rounded-lg shadow-md whitespace-nowrap border border-white/20">
          ${CONFIG.POI_NAME}
        </span>
        <svg class="w-10 h-10 text-rose-600 drop-shadow-lg" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      </div>
    `,
    iconSize: [36, 48],
    iconAnchor: [18, 48]
  });

  // Marqueur fixe
  state.poiMarker = L.marker(CONFIG.POI_COORDS, { 
    icon: poiIcon,
    zIndexOffset: 500
  })
    .addTo(state.map)
    .bindPopup(`<strong>${CONFIG.POI_NAME}</strong><br>Rayon de validation : ${CONFIG.VALIDATION_RADIUS} m`);

  // Cercle de détection / zone de validation (30 mètres)
  state.poiCircle = L.circle(CONFIG.POI_COORDS, {
    radius: CONFIG.VALIDATION_RADIUS,
    color: '#e11d48',        // Bordure rouge (Rose-600)
    fillColor: '#f43f5e',    // Remplissage rose semi-transparent
    fillOpacity: 0.22,
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

/**
 * Calcule l'azimut (cap en degrés de 0 à 360°) entre deux coordonnées
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const toDeg = rad => (rad * 180) / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Convertit un angle en direction cardinale textuelle (ex: Nord, Nord-Est...)
 */
function getCardinalDirection(bearing) {
  const cardinals = ["Nord", "Nord-Est", "Est", "Sud-Est", "Sud", "Sud-Ouest", "Ouest", "Nord-Ouest"];
  const index = Math.round(bearing / 45) % 8;
  return cardinals[index];
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
  requestWakeLock();

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
  releaseWakeLock();

  // Mise à jour de l'UI
  if (dom.btnLabel) dom.btnLabel.textContent = "Activer la géolocalisation";
  if (dom.btnToggleGps) {
    dom.btnToggleGps.classList.remove('bg-slate-800', 'active:bg-slate-900');
    dom.btnToggleGps.classList.add('bg-indigo-600', 'active:bg-indigo-700');
  }
  if (dom.btnRecenter) dom.btnRecenter.classList.add('hidden');
  
  if (dom.headerStatus) dom.headerStatus.textContent = "GPS Inactif";
  if (dom.statusDot) dom.statusDot.className = "w-2 h-2 rounded-full bg-amber-400";
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
 * Déclenche l'animation de rebond vertical du pion lors d'un déplacement
 * @param {L.Marker} marker - Instance du marqueur Leaflet représentant le pion
 */
function animatePion(marker) {
  if (!marker) return;

  const element = marker.getElement();
  if (!element) return;

  // 1. Retrait de la classe d'animation si elle était déjà active
  element.classList.remove('pion-bounce');

  // 2. Astuce Senior : Forcer un recalcul synchrone du layout (Forced Reflow)
  // L'accès à une propriété géométrique comme offsetWidth force le moteur de rendu
  // du navigateur à vider sa file, ce qui réinitialise la timeline CSS à 0%.
  void element.offsetWidth;

  // 3. Réapplication de la classe pour relancer immédiatement le rebond
  element.classList.add('pion-bounce');
}

// Alias pour compatibilité interne
const animatePawnHop = animatePion;

/**
 * Met à jour ou instancie le pion 3D du joueur et le cercle de précision
 */
function updateMapUserLayer(lat, lon, accuracy) {
  const latLng = [lat, lon];

  if (!state.userMarker) {
    // Instanciation initiale du pion de jeu de plateau
    state.userMarker = L.marker(latLng, {
      icon: boardPawnIcon,
      zIndexOffset: 1000 // Toujours au-dessus des autres éléments
    }).addTo(state.map);

    // Cercle d'imprécision GPS (projeté à plat sur le plateau)
    state.userAccuracyCircle = L.circle(latLng, {
      radius: accuracy,
      color: '#3b82f6',
      fillColor: '#93c5fd',
      fillOpacity: 0.15,
      weight: 1
    }).addTo(state.map);

    animatePawnHop(state.userMarker);
  } else {
    // Déplacement avec animation de saut de case
    state.userMarker.setLatLng(latLng);
    state.userAccuracyCircle.setLatLng(latLng);
    state.userAccuracyCircle.setRadius(accuracy);
    animatePawnHop(state.userMarker);
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
  if (dom.btnLabel) dom.btnLabel.textContent = "Arrêter le GPS";
  if (dom.btnToggleGps) {
    dom.btnToggleGps.classList.remove('bg-indigo-600', 'active:bg-indigo-700');
    dom.btnToggleGps.classList.add('bg-slate-800', 'active:bg-slate-900');
  }
  if (dom.btnRecenter) dom.btnRecenter.classList.remove('hidden');

  if (dom.headerStatus) dom.headerStatus.textContent = "Recherche...";
  if (dom.statusDot) dom.statusDot.className = "w-2 h-2 rounded-full bg-amber-400 animate-pulse";
}

function updateUiWithMetrics() {
  if (dom.headerStatus) dom.headerStatus.textContent = "GPS Actif";
  if (dom.statusDot) dom.statusDot.className = "w-2 h-2 rounded-full bg-emerald-400";

  // Précision
  if (dom.metricAccuracy) dom.metricAccuracy.textContent = state.userAccuracy;

  // Formatage de la distance
  if (dom.metricDistance) {
    if (state.distanceToPoi >= 1000) {
      dom.metricDistance.textContent = (state.distanceToPoi / 1000).toFixed(2);
      if (dom.metricDistanceUnit) dom.metricDistanceUnit.textContent = "km";
    } else {
      dom.metricDistance.textContent = state.distanceToPoi;
      if (dom.metricDistanceUnit) dom.metricDistanceUnit.textContent = "m";
    }
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
  if (dom.badgeValidation) {
    dom.badgeValidation.textContent = "Validé ! 🎉";
    dom.badgeValidation.className = "font-bold text-emerald-600";
  }

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
  if (dom.badgeValidation) {
    dom.badgeValidation.textContent = "En approche";
    dom.badgeValidation.className = "font-bold text-slate-500";
  }

  // Réinitialisation du style du cercle POI
  if (state.poiCircle) {
    state.poiCircle.setStyle({
      color: '#e11d48',
      fillColor: '#f43f5e',
      fillOpacity: 0.22,
      dashArray: '5, 8'
    });
  }

  state.isValidated = false;
}

function showError(title, msg) {
  if (dom.errorMsg) dom.errorMsg.textContent = msg;
  if (dom.errorBanner) dom.errorBanner.classList.remove('hidden');
}

function hideError() {
  if (dom.errorBanner) dom.errorBanner.classList.add('hidden');
}

// --- 10. Gestion du Maintien de l'Écran (Wake Lock API) ---
let wakeLock = null;

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.warn("WakeLock non disponible :", err.message);
    }
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().then(() => { wakeLock = null; });
  }
}

// --- 11. Mode Simulation / Débogage (pour tester en amphi ou chez soi) ---
let isSimulatedAtPoi = false;

function toggleSimulation() {
  // Désactive le GPS réel si actif
  if (state.isTracking) {
    stopGeolocation();
  }

  isSimulatedAtPoi = !isSimulatedAtPoi;

  // Si activé : coordonnées à ~18m de Bollaert. Sinon : Centre-ville de Lens (~1.4km)
  const simulatedCoords = isSimulatedAtPoi
    ? {
        latitude: CONFIG.POI_COORDS[0] + 0.00015,
        longitude: CONFIG.POI_COORDS[1],
        accuracy: 8
      }
    : {
        latitude: CONFIG.MAP_CENTER[0],
        longitude: CONFIG.MAP_CENTER[1],
        accuracy: 15
      };

  onLocationSuccess({ coords: simulatedCoords });

  if (dom.simulateLabel) {
    dom.simulateLabel.textContent = isSimulatedAtPoi
      ? "Réinitialiser (Lens Centre)"
      : "Simuler arrivée (20m)";
  }
}

// --- 12. Gestion de l'Orientation et du Suivi de Cap (DeviceOrientation & Bearing) ---

const headingState = {
  isTracking: false,
  currentHeading: 0,
  orientationHandler: null
};

/**
 * Demande de permission pour accéder à la boussole mobile (Requis pour iOS 13+)
 */
async function requestOrientationPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permissionState = await DeviceOrientationEvent.requestPermission();
      return permissionState === 'granted';
    } catch (err) {
      console.warn("Erreur permission DeviceOrientation :", err);
      return false;
    }
  }
  // Android et autres navigateurs : permission implicite
  return true;
}

/**
 * Extrait le cap magnétique (0-360°) selon la plateforme (iOS vs Android)
 */
function getCompassHeading(event) {
  // iOS Safari : fournit directement le cap boussole magnétique
  if (typeof event.webkitCompassHeading !== 'undefined') {
    return event.webkitCompassHeading;
  }
  // Android : calcul à partir de la valeur alpha
  if (event.alpha !== null) {
    return (360 - event.alpha) % 360;
  }
  return null;
}

/**
 * Callback de mise à jour de l'orientation : oriente la carte en mode "Heading Up"
 */
function onDeviceOrientation(event) {
  if (!headingState.isTracking) return;

  const heading = getCompassHeading(event);
  if (heading === null) return;

  // Filtrage du jitter (seuil minimal de 1.5° de changement)
  const diff = Math.abs(heading - headingState.currentHeading);
  if (diff > 1.5) {
    headingState.currentHeading = heading;

    // Tourne la carte Leaflet pour que le cap regardé pointe vers le haut de l'écran
    state.map.setBearing(heading);

    // Maintien du centrage sur l'utilisateur s'il est localisé
    if (state.userLatLng) {
      state.map.panTo(state.userLatLng, { animate: false });
    }

    // Animation de l'icône de boussole sur le bouton
    if (dom.compassBtnIcon) {
      dom.compassBtnIcon.style.transform = `rotate(${-heading}deg)`;
    }
  }
}

/**
 * Bascule l'activation du mode "Recentrer et Suivre le cap"
 */
async function toggleHeadingTracking() {
  if (headingState.isTracking) {
    stopHeadingTracking();
  } else {
    await startHeadingTracking();
  }
}

async function startHeadingTracking() {
  const allowed = await requestOrientationPermission();
  if (!allowed) {
    showError("Boussole désactivée", "L'accès aux capteurs d'orientation du smartphone est nécessaire pour suivre le cap.");
    return;
  }

  headingState.isTracking = true;

  // Choix de l'événement le plus précis (boussole absolue Android si disponible)
  const eventName = ('ondeviceorientationabsolute' in window)
    ? 'deviceorientationabsolute'
    : 'deviceorientation';

  headingState.orientationHandler = onDeviceOrientation;
  window.addEventListener(eventName, headingState.orientationHandler, true);

  // Recentrage initial sur la position utilisateur
  if (state.userLatLng) {
    state.map.setView(state.userLatLng, 17, { animate: true });
  }

  updateHeadingButtonUi(true);
}

function stopHeadingTracking() {
  if (!headingState.isTracking) return;

  headingState.isTracking = false;

  const eventName = ('ondeviceorientationabsolute' in window)
    ? 'deviceorientationabsolute'
    : 'deviceorientation';

  if (headingState.orientationHandler) {
    window.removeEventListener(eventName, headingState.orientationHandler, true);
    headingState.orientationHandler = null;
  }

  updateHeadingButtonUi(false);
}

function updateHeadingButtonUi(isActive) {
  if (!dom.btnTrackHeading) return;

  if (isActive) {
    dom.btnTrackHeading.className = "w-11 h-11 bg-indigo-600 text-white rounded-full shadow-lg shadow-indigo-500/30 border border-indigo-400 flex items-center justify-center active:scale-90 transition-all";
    if (dom.compassBtnIcon) {
      dom.compassBtnIcon.className = "w-5 h-5 text-amber-300 transition-transform duration-150";
    }
  } else {
    dom.btnTrackHeading.className = "w-11 h-11 bg-white/95 backdrop-blur-md text-slate-700 rounded-full shadow-lg border border-white/60 flex items-center justify-center active:scale-90 transition-all hover:bg-white";
    if (dom.compassBtnIcon) {
      dom.compassBtnIcon.className = "w-5 h-5 text-indigo-600 transition-transform duration-300";
      dom.compassBtnIcon.style.transform = "rotate(0deg)";
    }
  }
}

// --- 13. Attachement des Événements ---
document.addEventListener('DOMContentLoaded', () => {
  initMap();

  dom.btnToggleGps.addEventListener('click', toggleGeolocation);
  dom.btnRecenter.addEventListener('click', centerOnUser);
  dom.btnCloseError.addEventListener('click', hideError);

  if (dom.btnTrackHeading) {
    dom.btnTrackHeading.addEventListener('click', toggleHeadingTracking);
  }

  if (dom.btnSimulatePoi) {
    dom.btnSimulatePoi.addEventListener('click', toggleSimulation);
  }
});

