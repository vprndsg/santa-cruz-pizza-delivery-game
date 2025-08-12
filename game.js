/* Santa Cruz Pizza Delivery Game – restored full functionality */

const fixedZoom = 18;
// Start right next to the pizzeria
const startLat = 36.9737;
const startLng = -122.0265;
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
}).setView([startLat, startLng], fixedZoom);

// Tile layer for the map background
const tileLayer = L.tileLayer(
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  {
    maxZoom: 18,
    keepBuffer: 6,        // keep six extra tile rings in memory
    edgeBufferTiles: 3,   // prefetch three rings ahead of view
    updateWhenIdle: false,
    reuseTiles: true,
    crossOrigin: true
  }
).addTo(map);

// Icons (helicopter, pizza, house, battery, turtle, coin)
const heliIcon   = L.icon({ iconUrl: 'images/helicopter.png', iconSize: [120, 120], iconAnchor: [60, 60] });
// Increase the size of the pizzeria pizza icon (larger than original, but scaled down from previous increase)
const pizzaIcon  = L.divIcon({ html: "🍕", className: "pizza-icon", iconSize: [315, 315] });
const tailPizzaIcon = L.divIcon({ html: "🍕", className: "tail-pizza-icon", iconSize: [30, 30] });
// Make house, battery, turtle, and coin icons larger (scaled down slightly from previous)
const houseIcon  = L.divIcon({ html: "🏠", className: "house-icon", iconSize: [315, 315] });
const batteryIcon = L.divIcon({ html: "🔋", className: "battery-icon", iconSize: [210, 210] });
const turtleIcon  = L.divIcon({ html: "🐢", className: "turtle-icon",  iconSize: [210, 210] });
const coinIcon    = L.divIcon({ html: "💰", className: "coin-icon",   iconSize: [210, 210] });

// Tap detection radii for pickup/delivery (icon half-size + buffer)
const PIZZA_TAP_RADIUS = pizzaIcon.options.iconSize[0] / 2 + 10;
const HOUSE_TAP_RADIUS = houseIcon.options.iconSize[0] / 2 + 10;

// Starting markers on the map
let heliLat = startLat, heliLng = startLng;
const helicopterMarker = L.marker([heliLat, heliLng], { icon: heliIcon }).addTo(map);
let heliLatLng = L.latLng(heliLat, heliLng);
const pizzaLatLng = [36.9737, -122.0263];
const pizzaMarker = L.marker(pizzaLatLng, { icon: pizzaIcon }).addTo(map);

// **Important**: fix map display if it was hidden during init
map.invalidateSize();

// Orders and progress data
const orders = [
  { address: "121 Waugh Ave", pizzas: 2, time: 45,
    location: [37.00371, -121.97777],
    caller: "Mister Manager", emoji: "🐶",
    msg: "Woof woof! I need {p} pizzas now!" },
  { address: "Santa Cruz Beach Boardwalk", pizzas: 1, time: 30,
    location: [36.964287, -122.018822],
    caller: "Paige", emoji: "🎢",
    msg: "Mark! I need {p} pizza at the Boardwalk!" },
  { address: "Santa Cruz Wharf", pizzas: 3, time: 60,
    location: [36.9615, -122.0219],
    caller: "Otter 841", emoji: "🦦",
    msg: "Bro, I need {p} pizzas — ASAP!" },
  { address: "UCSC", pizzas: 2, time: 50,
    location: [37.00053, -122.06692],
    caller: "Stoner college kid", emoji: "🧑‍🎓",
    msg: "Dude, I’ve got the munchies—bring me {p} pizzas." },
  { address: "Beauregard Vineyards Tasting Room", pizzas: 4, time: 60,
    location: [37.062073, -122.149203],
    caller: "JoBen", emoji: "🍷",
    msg: "Mark, get {p} pizzas here or you might not have a job tomorrow." }
];

let nextOrderIndex = 0;        // which order will ring next
const activeOrders = [];       // currently active delivery orders
let deliveredCount = 0;        // count of delivered orders
let tipScore = 0;              // accumulated tips from coins and bonuses

// Per-order helper arrays
const batteryMarkers = [];
const turtleMarkers  = [];
const coinMarkers    = [];

// Tail markers for carried pizzas (one per pizza in helicopter)
const tailMarkers = [];
const heliTrail = [];
const TAIL_SPACING = 10;  // spacing of tail markers behind heli

// Game state tracking
let carryingCount = 0;
let gameOver = false;
let speedMultiplier = 1;
let speedTimeout = null;   // timeout ID for speed boost/slow reset

// HUD and UI elements
const hud         = document.getElementById('hud');
const phoneIcon   = document.getElementById('phone-icon');
const phoneMessage= document.getElementById('phone-message');
const navBanner   = document.getElementById('nav-banner');
const msgLog      = document.getElementById('msg-log');
const compass     = document.getElementById('compass');
const pizzaArrow  = document.getElementById('pizza-arrow');
const houseArrow  = document.getElementById('house-arrow');
const gameOverScreen  = document.getElementById('game-over');
const gameOverContent = document.getElementById('game-over-content');
gameOverScreen.style.display = 'none';

// Ensure HUD visible when game starts
window.addEventListener('load', () => { hud.style.display = 'block'; });

// Helpers: bearing and distance formatting
function bearingFromTo(a, b) {
  const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180;
  const Δλ = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function formatDistance(m) {
  return m >= 1000 ? `${(m/1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

// Pulsing target marker near active house
let targetPulseMarker = null;
function setTargetPulse(latlng) {
  if (!latlng) {
    if (targetPulseMarker) { targetPulseMarker.remove(); targetPulseMarker = null; }
    return;
  }
  const pulse = L.divIcon({ className: 'target-pulse' });
  if (!targetPulseMarker) {
    targetPulseMarker = L.marker(latlng, { icon: pulse, interactive: false }).addTo(map);
  } else {
    targetPulseMarker.setLatLng(latlng);
  }
}

// Message helpers
let phoneHideTimer = null;
function showPhoneMessage(caller, emoji, text, showMs = 3500) {
  if (phoneHideTimer) { clearTimeout(phoneHideTimer); phoneHideTimer = null; }
  phoneMessage.innerHTML = `${emoji} <strong>${caller}:</strong> ${text}`;
  phoneMessage.classList.remove('slide-in');
  void phoneMessage.offsetWidth;           // restart animation
  phoneMessage.classList.add('slide-in');
  phoneMessage.style.display = 'block';
  logMessage(`${emoji} ${caller}: ${text}`);
  phoneHideTimer = setTimeout(() => { phoneMessage.style.display = 'none'; }, showMs);
}
function logMessage(text) {
  if (!msgLog) return;
  const el = document.createElement('div');
  el.className = 'msg';
  const t = new Date();
  const hh = String(t.getHours()).padStart(2,'0');
  const mm = String(t.getMinutes()).padStart(2,'0');
  el.textContent = `[${hh}:${mm}] ${text}`;
  msgLog.prepend(el);
  while (msgLog.children.length > 3) msgLog.lastChild.remove();
}

// Live navigation: rotate arrows and banner
function updateNav() {
  if (!heliLatLng) return; // relies on existing heliLatLng updates
  const heli = L.latLng(heliLatLng);
  const pizzaLL = Array.isArray(pizzaLatLng) ? L.latLng(pizzaLatLng[0], pizzaLatLng[1]) : L.latLng(pizzaLatLng);
  const pizzaBrg = bearingFromTo(heli, pizzaLL);
  pizzaArrow.style.transform = `rotate(${pizzaBrg}deg)`;

  const active = activeOrders[0];
  if (active && active.house) {
    const houseLL = active.house.getLatLng();
    const houseBrg = bearingFromTo(heli, houseLL);
    const dist = heli.distanceTo(houseLL);
    houseArrow.style.opacity = '1';
    houseArrow.style.transform = `rotate(${houseBrg}deg)`;
    navBanner.style.display = 'block';
    navBanner.textContent = `→ ${orders[active.idx].address} • ${formatDistance(dist)}`;
    setTargetPulse(houseLL);
  } else {
    houseArrow.style.opacity = '0.25';
    navBanner.style.display = 'none';
    setTargetPulse(null);
  }
}
// start lightweight nav updater
setInterval(updateNav, 250);

// Movement control variables
let upPressed = false, downPressed = false, leftPressed = false, rightPressed = false;
let touchStartX = null, touchStartY = null;
let touchDeltaX = 0, touchDeltaY = 0;
let touchActive = false;
const touchThreshold = 20;
const baseSpeed = 0.000046; // base movement speed

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

// Touch controls for mobile (drag to move)
const mapContainer = map.getContainer();
mapContainer.addEventListener('pointerdown', (e) => {
  if (gameOver) return;
  touchActive = true;
  touchStartX = e.clientX;
  touchStartY = e.clientY;
  touchDeltaX = 0;
  touchDeltaY = 0;
  e.preventDefault();
});
mapContainer.addEventListener('pointermove', (e) => {
  if (!touchActive) return;
  touchDeltaX = e.clientX - touchStartX;
  touchDeltaY = e.clientY - touchStartY;
  e.preventDefault();
});
function endTouch() {
  touchActive = false;
  touchDeltaX = 0;
  touchDeltaY = 0;
}
mapContainer.addEventListener('pointerup', endTouch);
mapContainer.addEventListener('pointercancel', endTouch);

// Phone ringing and order scheduling
let phoneRinging = false;

function ringPhone() {
  if (nextOrderIndex >= orders.length || phoneRinging || gameOver) return;
  phoneIcon.dataset.orderIndex = nextOrderIndex;
  phoneIcon.style.display = 'block';
  phoneIcon.classList.add('ringing');
  phoneRinging = true;
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  setTimeout(answerPhone, 1000);
}

function answerPhone() {
  if (!phoneRinging) return;
  if (navigator.vibrate) navigator.vibrate(0);
  phoneIcon.classList.remove('ringing');
  phoneIcon.style.display = 'none';
  phoneRinging = false;

  const orderIdx = parseInt(phoneIcon.dataset.orderIndex, 10);
  startOrder(orderIdx);
  nextOrderIndex++;
  setTimeout(ringPhone, 15000);
}

// Allow clicking the phone icon to answer immediately
phoneIcon.addEventListener('click', answerPhone);

// Create and initiate a new order
function startOrder(idx) {
  const cfg = orders[idx];

  // house marker
  const house = L.marker(cfg.location, { icon: houseIcon }).addTo(map);

  // ensure activeOrders entry tracks the house marker and timer
  let entry = activeOrders.find(o => o.idx === idx);
  if (!entry) {
    entry = { idx, pizzasNeeded: cfg.pizzas, timeLeft: cfg.time, house, timerId: null };
    activeOrders.push(entry);
  } else {
    entry.house = house;
    entry.timeLeft = cfg.time;
  }

  // place batteries, turtles, coins as you already do
  const [shopLat, shopLng] = pizzaLatLng;
  const [destLat, destLng] = cfg.location;
  [0.25, 0.5, 0.75].forEach(f => {
    const lat = shopLat + (destLat - shopLat) * f;
    const lng = shopLng + (destLng - shopLng) * f;
    const battery = L.marker([lat, lng], { icon: batteryIcon }).addTo(map);
    batteryMarkers.push(battery);
  });
  [0.6, 0.8, 0.95].forEach(f => {
    const lat = shopLat + (destLat - shopLat) * f;
    const lng = shopLng + (destLng - shopLng) * f;
    const turtle = L.marker([lat, lng], { icon: turtleIcon }).addTo(map);
    turtleMarkers.push(turtle);
  });
  [0.2, 0.35, 0.5, 0.65, 0.8].forEach(f => {
    const lat = shopLat + (destLat - shopLat) * f + (Math.random() * 0.0004 - 0.0002);
    const lng = shopLng + (destLng - shopLng) * f + (Math.random() * 0.0004 - 0.0002);
    const coin = L.marker([lat, lng], { icon: coinIcon }).addTo(map);
    coinMarkers.push(coin);
  });

  // start countdown timer for this order
  entry.timerId = setInterval(() => {
    entry.timeLeft--;
    updateHUD();
    if (entry.timeLeft <= 0) endGame(false);  // order expired -> game over (lose)
  }, 1000);

  // phone message popup using helper
  const pizzaWord = cfg.pizzas === 1 ? "pizza" : "pizzas";
  const callLine = cfg.msg.replace("{p}", `${cfg.pizzas} ${pizzaWord}`);
  showPhoneMessage(cfg.caller, cfg.emoji, callLine, 4500);

  // follow-up reminder 10–13s later if still active
  setTimeout(() => {
    if (!gameOver && activeOrders.find(o => o.idx === idx)) {
      showPhoneMessage(cfg.caller, cfg.emoji, "Hey, I am still waiting for my pizzas!", 3500);
    }
  }, 10000 + Math.random() * 3000);

  // highlight target on map and refresh HUD
  setTargetPulse(house.getLatLng());
  updateHUD();
}

// Pickup and delivery interactions
map.on('click', (e) => {
  if (gameOver) return;
  const here = helicopterMarker.getLatLng();
  const clickPoint = map.latLngToLayerPoint(e.latlng);

  // Pizza pickup: tap near the pizzeria icon to load pizzas
  const pizzaPoint = map.latLngToLayerPoint(pizzaMarker.getLatLng());
  if (clickPoint.distanceTo(pizzaPoint) <= PIZZA_TAP_RADIUS) {
    if (carryingCount < 5) {
      carryingCount++;
      const tail = L.marker(here, { icon: tailPizzaIcon }).addTo(map);
      tailMarkers.push(tail);
    }
    return;
  }

  // Delivery drop-off: tap near a house icon to deliver pizzas
  for (let i = activeOrders.length - 1; i >= 0; i--) {
    const order = activeOrders[i];
    const housePoint = map.latLngToLayerPoint(order.house.getLatLng());
    if (clickPoint.distanceTo(housePoint) <= HOUSE_TAP_RADIUS && carryingCount >= order.pizzasNeeded) {
      // Deliver the order
      carryingCount -= order.pizzasNeeded;
      for (let p = 0; p < order.pizzasNeeded; p++) {
        tailMarkers.pop().remove();
      }
      clearInterval(order.timerId);
      order.house.remove();
      activeOrders.splice(i, 1);
      tipScore += order.timeLeft; // bonus tips for remaining time
      showPhoneMessage(orders[order.idx].caller, orders[order.idx].emoji, "Thanks. That hit the spot!", 3000);
      deliveredCount++;
      updateHUD();
      if (deliveredCount === orders.length) {
        return endGame(true);  // all orders delivered – win the game
      }
    }
  }
});

// Movement loop with collision detection and power-ups
function gameLoop() {
  if (gameOver) return;

  // Determine movement delta for this frame
  let moveLat = 0, moveLng = 0;
  // Keyboard input
  if (upPressed)    moveLat += baseSpeed * speedMultiplier;
  if (downPressed)  moveLat -= baseSpeed * speedMultiplier;
  if (rightPressed) moveLng += baseSpeed * speedMultiplier;
  if (leftPressed)  moveLng -= baseSpeed * speedMultiplier;
  // Touch drag input
  if (touchActive) {
    if (Math.abs(touchDeltaY) > touchThreshold) {
      const dyFactor = Math.max(-1, Math.min(1, -touchDeltaY / 100));
      moveLat += baseSpeed * speedMultiplier * dyFactor;
    }
    if (Math.abs(touchDeltaX) > touchThreshold) {
      const dxFactor = Math.max(-1, Math.min(1, touchDeltaX / 100));
      moveLng += baseSpeed * speedMultiplier * dxFactor;
    }
  }

  // Move helicopter and map if there's any input
  if (moveLat !== 0 || moveLng !== 0) {
    heliLat += moveLat;
    const cosLat = Math.cos(heliLat * Math.PI / 180);
    heliLng += moveLng / (cosLat || 1);
    helicopterMarker.setLatLng([heliLat, heliLng]);
    map.setView([heliLat, heliLng]);
  }
  heliLatLng = helicopterMarker.getLatLng();

  // Update helicopter trail (for carried pizzas)
  heliTrail.push([heliLat, heliLng]);
  const maxTrail = tailMarkers.length * TAIL_SPACING + 1;
  if (heliTrail.length > maxTrail) {
    heliTrail.splice(0, heliTrail.length - maxTrail);
  }
  tailMarkers.forEach((m, i) => {
    const idx = heliTrail.length - (i + 1) * TAIL_SPACING - 1;
    const pos = heliTrail[idx] || [heliLat, heliLng];
    m.setLatLng(pos);
  });

  // Check collisions with batteries (speed boost), turtles (slowdown) and coins (tips)
  batteryMarkers.forEach((m, i) => {
    if (m && heliLatLng.distanceTo(m.getLatLng()) < 50) {
      m.remove();
      batteryMarkers[i] = null;
      speedMultiplier = 2;  // boost speed
      if (speedTimeout) clearTimeout(speedTimeout);
      speedTimeout = setTimeout(() => { speedMultiplier = 1; }, 5000);
    }
  });
  turtleMarkers.forEach((m, i) => {
    if (m && heliLatLng.distanceTo(m.getLatLng()) < 50) {
      m.remove();
      turtleMarkers[i] = null;
      speedMultiplier = 0.5;  // slow down
      if (speedTimeout) clearTimeout(speedTimeout);
      speedTimeout = setTimeout(() => { speedMultiplier = 1; }, 5000);
    }
  });
  coinMarkers.forEach((m, i) => {
    if (m && heliLatLng.distanceTo(m.getLatLng()) < 50) {
      m.remove();
      coinMarkers[i] = null;
      tipScore += 1;
      updateHUD();
    }
  });

  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

// HUD update to list deliveries and timers
function updateHUD() {
  const lines = [
    `Deliveries: ${deliveredCount}/${orders.length}`,
    `Tips: ${tipScore}`
  ];
  activeOrders.forEach(o => {
    const cfg = orders[o.idx];
    lines.push(`${cfg.address}: ${o.timeLeft}s`);
  });
  hud.innerHTML = lines.join('<br>');
}

// End-game routine (win or lose)
function endGame(win) {
  if (gameOver) return;
  gameOver = true;
  // Stop all active order timers
  activeOrders.forEach(o => clearInterval(o.timerId));
  // Remove all markers (battery, turtle, coin, houses, pizza tails)
  [...batteryMarkers, ...turtleMarkers, ...coinMarkers].forEach(m => m && m.remove());
  activeOrders.forEach(o => o.house.remove());
  tailMarkers.forEach(m => m.remove());
  // Show game over message
  const msg = win
    ? `Delivered all ${orders.length} orders. Great job.`
    : `Time up. You delivered ${deliveredCount} of ${orders.length}.`;
  gameOverContent.innerHTML = msg;
  gameOverScreen.style.display = 'flex';
  // Stop game background music
  try {
    const gameAudioElem = document.getElementById('game-audio');
    if (gameAudioElem && !gameAudioElem.paused) {
      gameAudioElem.pause();
      gameAudioElem.currentTime = 0;
    }
  } catch (e) {
    // Ignore errors if audio element isn't available
  }
}

// Start the first phone ring 1 second after game start
setTimeout(ringPhone, 1000);