/* Santa Cruz Pizza Delivery Game - multiple overlapping orders */

const fixedZoom = 18;
const map = L.map('map', {
  keyboard: false,
  dragging: false,
  touchZoom: false,
  scrollWheelZoom: false,
  doubleClickZoom: false,
  boxZoom: false,
  zoomControl: false,
  minZoom: fixedZoom,
  maxZoom: fixedZoom
}).setView([36.974, -122.030], fixedZoom);

// Tile layer with keepBuffer and EdgeBuffer
const tileLayer = L.tileLayer(
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  {
    maxZoom: 18,
    keepBuffer: 6,        // keep six extra tile rings in memory
    edgeBufferTiles: 3,   // prefetch three more rings ahead of view
    updateWhenIdle: false,
    reuseTiles: true,
    crossOrigin: true
  }
).addTo(map);

// Icons
const heliIcon = L.icon({
  iconUrl: 'IMG_3540.png',
  iconSize: [80, 80],
  iconAnchor: [40, 40]
});
const pizzaIcon = L.divIcon({ html: "🍕", className: "pizza-icon", iconSize: [30, 30] });
const houseIcon = L.divIcon({ html: "🏠", className: "house-icon", iconSize: [30, 30] });
const batteryIcon = L.divIcon({ html: "🔋", className: "battery-icon", iconSize: [30, 30] });
const turtleIcon  = L.divIcon({ html: "🐢", className: "turtle-icon",  iconSize: [30, 30] });

// Starting markers
let heliLat = 36.974, heliLng = -122.030;
const helicopterMarker = L.marker([heliLat, heliLng], { icon: heliIcon }).addTo(map);

const pizzaLatLng = [36.9737, -122.0263];
const pizzaMarker = L.marker(pizzaLatLng, { icon: pizzaIcon }).addTo(map);

// Orders and progress
const orders = [
  { address: "121 Waugh Ave", pizzas: 2, time: 45, location: [36.975, -122.032] },
  { address: "55 Front St",   pizzas: 1, time: 30, location: [36.971, -122.026] },
  { address: "300 Bay St",    pizzas: 3, time: 60, location: [36.972, -122.045] },
  { address: "45 Mission St", pizzas: 2, time: 50, location: [36.977, -122.039] },
  { address: "10 Ocean St",   pizzas: 4, time: 60, location: [36.970, -122.022] }
];

let nextOrderIndex = 0;          // which order will ring next
const activeOrders = [];         // running deliveries
let deliveredCount = 0;

// Per-order helper arrays
const batteryMarkers = [];
const turtleMarkers  = [];

// Tail markers for carried pizzas
const tailMarkers = [];

// Game state
let carryingCount = 0;
let gameOver = false;
let speedMultiplier = 1;
let speedTimeout = null;
let spoilInterval = null;
let lastPickupTime = 0;

// HUD and UI elements
const hud = document.getElementById('hud');
const phoneIcon = document.getElementById('phone-icon');
const gameOverScreen = document.getElementById('game-over');
const gameOverContent = document.getElementById('game-over-content');
gameOverScreen.style.display = 'none';

// Movement control variables
let upPressed = false, downPressed = false, leftPressed = false, rightPressed = false;
let latestBeta = 0, latestGamma = 0;
let smoothedBeta = 0, smoothedGamma = 0;
let baselineBeta = null, baselineGamma = null;
const tiltThreshold = 15;
const baseSpeed = 0.000046; // 8% slower

// Orientation permission (iOS)
window.addEventListener('click', function enableOrientation() {
  if (DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().catch(() => {
      console.warn('Device orientation permission denied or not requested.');
    });
  }
  window.removeEventListener('click', enableOrientation);
});

// Device orientation controls
window.addEventListener('deviceorientation', (e) => {
  if (e.beta !== null && e.gamma !== null) {
    if (baselineBeta === null) {
      baselineBeta = e.beta;
      baselineGamma = e.gamma;
    }
    latestBeta = e.beta - baselineBeta;
    latestGamma = e.gamma - baselineGamma;
    // simple smoothing to reduce jitter
    smoothedBeta = smoothedBeta * 0.8 + latestBeta * 0.2;
    smoothedGamma = smoothedGamma * 0.8 + latestGamma * 0.2;
  }
});

// Keyboard controls
window.addEventListener('keydown', (e) => {
  if (gameOver) return;
  switch (e.key) {
    case "ArrowUp":    upPressed = true; e.preventDefault(); break;
    case "ArrowDown":  downPressed = true; e.preventDefault(); break;
    case "ArrowLeft":  leftPressed = true; e.preventDefault(); break;
    case "ArrowRight": rightPressed = true; e.preventDefault(); break;
  }
});
window.addEventListener('keyup', (e) => {
  switch (e.key) {
    case "ArrowUp":    upPressed = false; e.preventDefault(); break;
    case "ArrowDown":  downPressed = false; e.preventDefault(); break;
    case "ArrowLeft":  leftPressed = false; e.preventDefault(); break;
    case "ArrowRight": rightPressed = false; e.preventDefault(); break;
  }
});

// Phone ring, vibration and overlapping call schedule
let phoneRinging = false;
let vibrateInterval = null;

function ringPhone() {
  if (nextOrderIndex >= orders.length || phoneRinging || gameOver) return;

  phoneIcon.dataset.orderIndex = nextOrderIndex;
  phoneIcon.style.display = 'block';
  phoneRinging = true;

  // Try to vibrate once every second while phone is ringing
  if (navigator.vibrate) {
    navigator.vibrate([200, 100, 200]);
    vibrateInterval = setInterval(() => navigator.vibrate([200]), 1000);
  }
}

phoneIcon.addEventListener('click', () => {
  if (!phoneRinging) return;

  // Stop vibration
  if (vibrateInterval) { clearInterval(vibrateInterval); vibrateInterval = null; navigator.vibrate(0); }
  phoneIcon.style.display = 'none';
  phoneRinging = false;

  const orderIdx = parseInt(phoneIcon.dataset.orderIndex, 10);
  startOrder(orderIdx);
  nextOrderIndex++;

  // Schedule the next ring after 15 s, even if current order still runs
  setTimeout(ringPhone, 15000);
});

// Create and track each order
function startOrder(idx) {
  const cfg = orders[idx];

  // House marker
  const house = L.marker(cfg.location, { icon: houseIcon }).addTo(map);

  // Battery and turtle placed along route
  const [shopLat, shopLng] = pizzaLatLng;
  const [destLat, destLng] = cfg.location;
  const bLat = shopLat + (destLat - shopLat) * 0.33;
  const bLng = shopLng + (destLng - shopLng) * 0.33;
  const tLat = shopLat + (destLat - shopLat) * 0.66;
  const tLng = shopLng + (destLng - shopLng) * 0.66;

  const battery = L.marker([bLat, bLng], { icon: batteryIcon }).addTo(map);
  const turtle  = L.marker([tLat, tLng], { icon: turtleIcon }).addTo(map);
  batteryMarkers.push(battery);
  turtleMarkers.push(turtle);

  // Order object with its own timer
  const order = {
    idx,
    pizzasNeeded: cfg.pizzas,
    timeLeft: cfg.time,
    house,
    timerId: null
  };
  activeOrders.push(order);

  order.timerId = setInterval(() => {
    order.timeLeft--;
    updateHUD();
    if (order.timeLeft <= 0) endGame(false);
  }, 1000);

  // Video-call popup
  const popup = document.createElement('div');
  Object.assign(popup.style, {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
    background: 'rgba(0,0,0,0.8)', color: '#fff', padding: '10px 20px', borderRadius: '8px',
    zIndex: 2000, textAlign: 'center'
  });
  const pizzaWord = cfg.pizzas === 1 ? "pizza" : "pizzas";
  popup.innerHTML = `🐶 <strong>Fido:</strong> I need ${cfg.pizzas} ${pizzaWord} at ${cfg.address} now!`;
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 3000);

  updateHUD();
}

// Pickup and delivery iterate through activeOrders
map.on('click', () => {
  if (gameOver) return;
  const here = helicopterMarker.getLatLng();

  // Pickup at shop
  if (here.distanceTo(pizzaMarker.getLatLng()) < 50) {
    if (carryingCount < 4) {
      carryingCount++;
      if (carryingCount === 1) lastPickupTime = Date.now();
      const tail = L.marker(here, { icon: pizzaIcon }).addTo(map);
      tailMarkers.push(tail);
    }
    return;
  }

  // Delivery: check each active order
  for (let i = activeOrders.length - 1; i >= 0; i--) {
    const order = activeOrders[i];
    if (here.distanceTo(order.house.getLatLng()) < 50 && carryingCount >= order.pizzasNeeded) {
      // Deliver
      carryingCount -= order.pizzasNeeded;
      for (let p = 0; p < order.pizzasNeeded; p++) tailMarkers.pop().remove();

      clearInterval(order.timerId);
      order.house.remove();
      activeOrders.splice(i, 1);
      deliveredCount++;

      updateHUD();

      if (deliveredCount === orders.length) return endGame(true);
    }
  }
});

// Movement loop with collision detection
function gameLoop() {
  if (gameOver) return;

  let moveLat = 0, moveLng = 0;
  // Keyboard input
  if (upPressed) moveLat += baseSpeed * speedMultiplier;
  if (downPressed) moveLat -= baseSpeed * speedMultiplier;
  if (rightPressed) moveLng += baseSpeed * speedMultiplier;
  if (leftPressed) moveLng -= baseSpeed * speedMultiplier;
  // Device tilt
  if (Math.abs(smoothedBeta) > tiltThreshold) {
    const betaFactor = Math.max(-1, Math.min(1, smoothedBeta / 45));
    moveLat += baseSpeed * speedMultiplier * betaFactor;
  }
  if (Math.abs(smoothedGamma) > tiltThreshold) {
    const gammaFactor = Math.max(-1, Math.min(1, smoothedGamma / 45));
    moveLng += baseSpeed * speedMultiplier * gammaFactor;
  }

  if (moveLat !== 0 || moveLng !== 0) {
    heliLat += moveLat;
    const cosLat = Math.cos(heliLat * Math.PI / 180);
    heliLng += moveLng / (cosLat || 1);
    helicopterMarker.setLatLng([heliLat, heliLng]);
    map.setView([heliLat, heliLng]);
  }

  const heliLatLng = helicopterMarker.getLatLng();
  // inside gameLoop after helicopter position update
  batteryMarkers.forEach((m, i) => {
    if (m && heliLatLng.distanceTo(m.getLatLng()) < 50) {
      m.remove(); batteryMarkers[i] = null;
      speedMultiplier = 2;            // boost
      if (speedTimeout) clearTimeout(speedTimeout);
      speedTimeout = setTimeout(() => speedMultiplier = 1, 5000);
    }
  });
  turtleMarkers.forEach((m, i) => {
    if (m && heliLatLng.distanceTo(m.getLatLng()) < 50) {
      m.remove(); turtleMarkers[i] = null;
      speedMultiplier = 0.5;          // slow
      if (speedTimeout) clearTimeout(speedTimeout);
      speedTimeout = setTimeout(() => speedMultiplier = 1, 5000);
    }
  });

  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

// HUD lists every live timer
function updateHUD() {
  const lines = [`Deliveries: ${deliveredCount}/${orders.length}`];
  activeOrders.forEach(o => {
    const cfg = orders[o.idx];
    lines.push(`${cfg.address}: ${o.timeLeft}s`);
  });
  hud.innerHTML = lines.join('<br>');
}

// End-game clears everything
function endGame(win) {
  if (gameOver) return;
  gameOver = true;

  // Stop all timers
  activeOrders.forEach(o => clearInterval(o.timerId));
  clearInterval(spoilInterval);

  // Remove all markers
  [...batteryMarkers, ...turtleMarkers].forEach(m => m && m.remove());
  activeOrders.forEach(o => o.house.remove());
  tailMarkers.forEach(m => m.remove());

  const msg = win
    ? `Delivered all ${orders.length} orders. Great job.`
    : `Time up. You delivered ${deliveredCount} of ${orders.length}.`;
  gameOverContent.innerHTML = msg;
  gameOverScreen.style.display = 'flex';
}

// Start the first ringing phone one second after game load
setTimeout(ringPhone, 1000);
