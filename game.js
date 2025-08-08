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

// Icons (helicopter, pizza, house, battery, turtle)
const heliIcon   = L.icon({ iconUrl: 'images/helicopter.png', iconSize: [120, 120], iconAnchor: [60, 60] });
// Increase the size of the pizzeria pizza icon (5x larger)
const pizzaIcon  = L.divIcon({ html: "🍕", className: "pizza-icon", iconSize: [450, 450] });
const tailPizzaIcon = L.divIcon({ html: "🍕", className: "tail-pizza-icon", iconSize: [30, 30] });
// Make house, battery, and turtle icons significantly larger for better visibility
const houseIcon  = L.divIcon({ html: "🏠", className: "house-icon", iconSize: [450, 450] });
const batteryIcon = L.divIcon({ html: "🔋", className: "battery-icon", iconSize: [300, 300] });
const turtleIcon  = L.divIcon({ html: "🐢", className: "turtle-icon",  iconSize: [300, 300] });

// Tap detection radii for pickup/delivery (icon half-size + buffer)
const PIZZA_TAP_RADIUS = pizzaIcon.options.iconSize[0] / 2 + 10;
const HOUSE_TAP_RADIUS = houseIcon.options.iconSize[0] / 2 + 10;

// Starting markers on the map
let heliLat = startLat, heliLng = startLng;
const helicopterMarker = L.marker([heliLat, heliLng], { icon: heliIcon }).addTo(map);
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

// Per-order helper arrays
const batteryMarkers = [];
const turtleMarkers  = [];

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
const hud = document.getElementById('hud');
const phoneIcon = document.getElementById('phone-icon');
const phoneMessage = document.getElementById('phone-message');
const pizzaArrow = document.getElementById('pizza-arrow');
const houseArrow = document.getElementById('house-arrow');
const gameOverScreen = document.getElementById('game-over');
const gameOverContent = document.getElementById('game-over-content');
gameOverScreen.style.display = 'none';

// Compass direction calculation
function angleTo(lat, lng) {
  const here = helicopterMarker.getLatLng();
  const dy = lat - here.lat;
  const dx = lng - here.lng;
  return Math.atan2(dx, dy) * 180 / Math.PI;
}

function updateCompass() {
  // point pizza arrow toward pizzeria
  const [pLat, pLng] = pizzaLatLng;
  const pizzaAngle = angleTo(pLat, pLng);
  pizzaArrow.style.transform = `translateX(-50%) rotate(${pizzaAngle}deg)`;

  // point house arrow toward first active order’s house (if any)
  if (activeOrders.length > 0) {
    const hLatLng = activeOrders[0].house.getLatLng();
    const houseAngle = angleTo(hLatLng.lat, hLatLng.lng);
    houseArrow.style.transform = `translateX(-50%) rotate(${houseAngle}deg)`;
    houseArrow.style.display = 'block';
  } else {
    houseArrow.style.display = 'none';
  }
}

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
  // Show ringing phone icon
  phoneIcon.dataset.orderIndex = nextOrderIndex;
  phoneIcon.style.display = 'block';
  phoneRinging = true;
  // Device vibration feedback, if supported
  if (navigator.vibrate) {
    navigator.vibrate([200, 100, 200]);
  }
  // Auto-answer the call after a brief ring
  setTimeout(answerPhone, 1000);
}

function answerPhone() {
  if (!phoneRinging) return;
  // Stop vibration and hide ringing icon
  if (navigator.vibrate) navigator.vibrate(0);
  phoneIcon.style.display = 'none';
  phoneRinging = false;
  // Start the delivery order
  const orderIdx = parseInt(phoneIcon.dataset.orderIndex, 10);
  startOrder(orderIdx);
  nextOrderIndex++;
  // Schedule the next phone ring after 15s (calls overlap if previous not done)
  setTimeout(ringPhone, 15000);
}

// Allow clicking the phone icon to answer immediately
phoneIcon.addEventListener('click', answerPhone);

// Create and initiate a new order
function startOrder(idx) {
  const cfg = orders[idx];
  // Add a house marker for the delivery location
  const house = L.marker(cfg.location, { icon: houseIcon }).addTo(map);

  // Place battery and turtle icons along the route (for speed changes)
  const [shopLat, shopLng] = pizzaLatLng;
  const [destLat, destLng] = cfg.location;
  // two battery power-ups at 25% and 50% along the route
  [0.25, 0.5].forEach(f => {
    const lat = shopLat + (destLat - shopLat) * f;
    const lng = shopLng + (destLng - shopLng) * f;
    const battery = L.marker([lat, lng], { icon: batteryIcon }).addTo(map);
    batteryMarkers.push(battery);
  });
  // two turtle slow-downs at 70% and 90% along the route
  [0.7, 0.9].forEach(f => {
    const lat = shopLat + (destLat - shopLat) * f;
    const lng = shopLng + (destLng - shopLng) * f;
    const turtle = L.marker([lat, lng], { icon: turtleIcon }).addTo(map);
    turtleMarkers.push(turtle);
  });

  // Track the new order
  const order = {
    idx,
    pizzasNeeded: cfg.pizzas,
    timeLeft: cfg.time,
    house,
    timerId: null
  };
  activeOrders.push(order);

  // Start countdown timer for this order
  order.timerId = setInterval(() => {
    order.timeLeft--;
    updateHUD();
    if (order.timeLeft <= 0) endGame(false);  // order expired -> game over (lose)
  }, 1000);

  // Display the phone message popup with order details
  const pizzaWord = cfg.pizzas === 1 ? "pizza" : "pizzas";
  const callLine = cfg.msg.replace("{p}", `${cfg.pizzas} ${pizzaWord}`);
  phoneMessage.innerHTML = `${cfg.emoji} <strong>${cfg.caller}:</strong> ${callLine}`;
  phoneMessage.style.display = 'block';

  updateHUD();  // refresh HUD to include this new order
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

  // Check collisions with batteries (speed boost) and turtles (slowdown)
  const heliLatLng = helicopterMarker.getLatLng();
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

  updateCompass();  // update compass arrows each frame
  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

// HUD update to list deliveries and timers
function updateHUD() {
  const lines = [`Deliveries: ${deliveredCount}/${orders.length}`];
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
  // Remove all markers (battery, turtle, houses, pizza tails)
  [...batteryMarkers, ...turtleMarkers].forEach(m => m && m.remove());
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