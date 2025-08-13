/* Santa Cruz Pizza Delivery Game – restored full functionality */

const fixedZoom = 17.8;
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

// Tap detection radius for houses and shop (icon half-size + buffer)
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
  { address: "121 Waugh Ave", pizzas: 2, time: 60,
    location: [37.00371, -121.97777],
    caller: "Mister Manager", emoji: "🐶",
    msg: "Woof woof! I need {p} pizzas now!" },
  { address: "Santa Cruz Beach Boardwalk", pizzas: 1, time: 40,
    location: [36.964287, -122.018822],
    caller: "Paige", emoji: "🎢",
    msg: "Mark! I need {p} pizza at the Boardwalk!" },
  { address: "Santa Cruz Wharf", pizzas: 3, time: 80,
    location: [36.9615, -122.0219],
    caller: "Otter 841", emoji: "🦦",
    msg: "Bro, I need {p} pizzas — ASAP!" },
  { address: "UCSC", pizzas: 2, time: 67,
    location: [37.00053, -122.06692],
    caller: "Stoner college kid", emoji: "🧑‍🎓",
    msg: "Dude, I’ve got the munchies—bring me {p} pizzas." },
  { address: "Beauregard Vineyards Tasting Room", pizzas: 4, time: 80,
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
const MAX_PIZZAS = 5;        // hard cap
let carryingCount = 0;
let gameOver = false;
let gamePaused = true;
let speedMultiplier = 1;
let speedTimeout = null;   // timeout ID for speed boost/slow reset

// HUD and UI elements
const hud         = document.getElementById('hud');
const phoneIcon   = document.getElementById('phone-icon');
const phoneMessage= document.getElementById('phone-message');
const navBanner   = document.getElementById('nav-banner');
const navText     = document.getElementById('nav-text');
const navArrow    = document.getElementById('nav-arrow');
const msgLog      = document.getElementById('msg-log');
const pizzaCompass= document.getElementById('pizza-compass');
const pizzaArrow  = document.getElementById('pizza-arrow');
const pizzaLabel  = document.getElementById('pizza-label');
const destCompass = document.getElementById('dest-compass');
const destArrow   = document.getElementById('dest-arrow');
const destLabel   = document.getElementById('dest-label');
const arrowTip    = document.getElementById('arrow-tip');
const compassEl   = document.getElementById('compass');
const ringAudio   = document.getElementById('ring-audio');
const soundToggle = document.getElementById('sound-toggle');
const gameOverScreen  = document.getElementById('game-over');
const gameOverContent = document.getElementById('game-over-content');
const tutorialMsg = document.getElementById('tutorial-msg');
gameOverScreen.style.display = 'none';
if (tutorialMsg) tutorialMsg.style.display = 'block';

// Ensure HUD visible when game starts
window.addEventListener('load', () => { hud.style.display = 'block'; });

// game.js — keep dock height in sync so the log never overlaps
function updateDockHeight(){
  const h = compassEl ? compassEl.offsetHeight : 0;
  document.documentElement.style.setProperty('--dock-h', `${h + 10}px`);
}
window.addEventListener('load',  updateDockHeight);
window.addEventListener('resize',updateDockHeight);
setInterval(updateDockHeight, 500); // cheap guard

// also react when the destination bar is shown/hidden
if (destCompass){
  new MutationObserver(updateDockHeight)
    .observe(destCompass, { attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
}


// tip bubble helpers
let arrowTipTimer = null;
function showArrowTip(text, ms = 3000) {
  if (!arrowTip) return;
  arrowTip.textContent = text;
  arrowTip.style.display = 'block';
  // raise dock above all overlays while tip is visible
  if (compassEl) compassEl.classList.add('tip-active');
  if (arrowTipTimer) clearTimeout(arrowTipTimer);
  arrowTipTimer = setTimeout(hideArrowTip, ms);
}
function hideArrowTip() {
  if (!arrowTip) return;
  arrowTip.style.display = 'none';
  if (compassEl) compassEl.classList.remove('tip-active');
  if (arrowTipTimer) { clearTimeout(arrowTipTimer); arrowTipTimer = null; }
}

// Helper to refill pizzas and notify
function restockAtShop() {
  const was = carryingCount;
  carryingCount = MAX_PIZZAS;
  const gained = Math.max(0, carryingCount - was);
  for (let i = 0; i < gained; i++) {
    const tail = L.marker(helicopterMarker.getLatLng(), { icon: tailPizzaIcon }).addTo(map);
    tailMarkers.push(tail);
  }
  showArrowTip(`Loaded ${carryingCount} pizzas${gained ? ` (+${gained})` : ''}. Ready to deliver.`, 2500);
  updateHUD();
}

// audio unlock + fallback beeps
let audioUnlocked = false;
let ringBeepTimer = null;
let audioCtx = null;

function unlockAudio(){
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (ringAudio){
    ringAudio.muted = true;
    ringAudio.play().then(() => {
      ringAudio.pause(); ringAudio.currentTime = 0; ringAudio.muted = false;
    }).catch(()=>{ /* will use WebAudio beep fallback */ });
  }
}
window.addEventListener('pointerdown', () => {
  unlockAudio();
  if (soundToggle) soundToggle.style.display = 'none';
}, { once:true });

if (soundToggle){
  soundToggle.addEventListener('click', () => { unlockAudio(); soundToggle.style.display='none'; });
}

// correct bearing math: our SVG points EAST by default → rotate by (bearing - 90)
function bearingFromTo(a, b){
  const φ1=a.lat*Math.PI/180, φ2=b.lat*Math.PI/180, Δλ=(b.lng-a.lng)*Math.PI/180;
  const y=Math.sin(Δλ)*Math.cos(φ2);
  const x=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (Math.atan2(y,x)*180/Math.PI+360)%360; // 0 = North
}
function formatDistance(m){ return m>=1000?`${(m/1000).toFixed(1)} km`:`${Math.round(m)} m`; }

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
function logMessage(text){
  if (!msgLog) return;
  const el = document.createElement('div');
  el.className = 'msg';
  const t = new Date();
  const hh = String(t.getHours()).padStart(2,'0');
  const mm = String(t.getMinutes()).padStart(2,'0');
  el.textContent = `[${hh}:${mm}] ${text}`;
  msgLog.prepend(el);
  const maxLog = window.matchMedia('(max-width: 640px)').matches ? 2 : 4;
  while (msgLog.children.length > maxLog) msgLog.lastChild.remove();
}

// keep HUD, phone, and banner from overlapping; update arrows
function updateSafeLayout(){
  const h = (navBanner && navBanner.style.display !== 'none') ? navBanner.offsetHeight : 0;
  document.documentElement.style.setProperty('--nav-h', `${h}px`);
}

function updateNav(){
  if (!heliLatLng) return;
  const heli = L.latLng(heliLatLng);
  const shop = L.latLng(pizzaLatLng[0], pizzaLatLng[1]);

  // pizzeria arrow and label
  const toShop = bearingFromTo(heli, shop);
  pizzaArrow.style.transform = `rotate(${toShop - 90}deg)`;     // SVG points East
  pizzaLabel.textContent = `Pizzeria • ${formatDistance(heli.distanceTo(shop))}`;

  // destination bar
  const active = activeOrders[0];
  if (active && active.house){
    const goal = active.house.getLatLng();
    const toHouse = bearingFromTo(heli, goal);
    destArrow.style.transform = `rotate(${toHouse - 90}deg)`;
    destLabel.textContent = `${orders[active.idx].address} • ${formatDistance(heli.distanceTo(goal))}`;
    destCompass.hidden = false;
  } else {
    destCompass.hidden = true;
  }

  updateDockHeight();
}
setInterval(updateNav, 250);
window.addEventListener('resize', updateSafeLayout);

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

function startBeepLoop(){
  if (!audioUnlocked) return;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const beep = () => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square'; o.frequency.value = 900;
    g.gain.setValueAtTime(0, audioCtx.currentTime);
    g.gain.linearRampToValueAtTime(0.25, audioCtx.currentTime + 0.02);
    g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.22);
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.24);
  };
  if (ringBeepTimer) clearInterval(ringBeepTimer);
  beep(); ringBeepTimer = setInterval(beep, 650);
}
function stopBeepLoop(){ if (ringBeepTimer){ clearInterval(ringBeepTimer); ringBeepTimer=null; } }

function startRingTone(){
  if (!audioUnlocked){ startBeepLoop(); return; }
  if (ringAudio){
    ringAudio.currentTime = 0;
    const p = ringAudio.play();
    if (p && typeof p.catch === 'function') p.catch(startBeepLoop);
  } else {
    startBeepLoop();
  }
}
function stopRingTone(){
  if (ringAudio){ try{ ringAudio.pause(); ringAudio.currentTime = 0; }catch{} }
  stopBeepLoop();
}

function ringPhone() {
  if (nextOrderIndex >= orders.length || phoneRinging || gameOver) return;
  phoneIcon.dataset.orderIndex = nextOrderIndex;
  phoneIcon.style.display = 'block';
  phoneIcon.classList.add('ringing');
  phoneRinging = true;
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  startRingTone();                  // play ringtone (or start beep fallback)
  setTimeout(answerPhone, 1250);    // auto-answer after ~1.25s (click still allowed)
}

function answerPhone() {
  if (!phoneRinging) return;
  if (navigator.vibrate) navigator.vibrate(0);
  phoneIcon.classList.remove('ringing');
  phoneIcon.style.display = 'none';
  phoneRinging = false;
  stopRingTone();

  const orderIdx = parseInt(phoneIcon.dataset.orderIndex, 10);
  startOrder(orderIdx);
  nextOrderIndex++;
  setTimeout(ringPhone, 18750);
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

  const need = Math.max(0, cfg.pizzas - carryingCount);
  if (need > 0) {
    showArrowTip(`Need ${need} more pizza${need>1?'s':''}. Tap the Pizzeria to restock to ${MAX_PIZZAS}.`, 3500);
  } else {
    hideArrowTip();
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

  // follow-up reminder 12.5–16.25s later if still active
  setTimeout(() => {
    if (!gameOver && activeOrders.find(o => o.idx === idx)) {
      showPhoneMessage(cfg.caller, cfg.emoji, "Hey, I am still waiting for my pizzas!", 3500);
    }
  }, 12500 + Math.random() * 3750);

  // highlight target on map and refresh HUD
  setTargetPulse(house.getLatLng());
  updateHUD();
}

// Pickup and delivery interactions
map.on('click', (e) => {
  if (gameOver) return;
  const clickPoint = map.latLngToLayerPoint(e.latlng);
  const pizzaPoint = map.latLngToLayerPoint(pizzaMarker.getLatLng());

  // One-tap restock at the pizzeria
  if (clickPoint.distanceTo(pizzaPoint) <= HOUSE_TAP_RADIUS) {
    restockAtShop();
    if (gamePaused) {
      gamePaused = false;
      if (tutorialMsg) tutorialMsg.style.display = 'none';
      setTimeout(ringPhone, 1250);
    }
    return;
  }

  // Delivery drop-off: tap near a house icon to deliver pizzas
  for (let i = activeOrders.length - 1; i >= 0; i--) {
    const order = activeOrders[i];
    const housePoint = map.latLngToLayerPoint(order.house.getLatLng());
    if (clickPoint.distanceTo(housePoint) <= HOUSE_TAP_RADIUS){
      if (carryingCount >= order.pizzasNeeded){
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
        hideArrowTip();  // clear any previous hint
        if (deliveredCount === orders.length) {
          return endGame(true);  // all orders delivered – win the game
        }
      } else {
        const need = order.pizzasNeeded - carryingCount;
        showArrowTip(`Need ${need} more pizza${need>1?'s':''}. Tap the Pizzeria to restock to ${MAX_PIZZAS}.`);
      }
    }
  }
});

// Movement loop with collision detection and power-ups
function gameLoop() {
  if (gameOver) return;
  if (gamePaused) { requestAnimationFrame(gameLoop); return; }

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
  // Show game over message and optional boss sequence
  if (win) {
    gameOverContent.innerHTML = `Delivered all ${orders.length} orders. Great job.`;
  } else {
    gameOverContent.innerHTML = `
      <div id="game-over-inner">
        <img class="boss-img" src="images/boss.png" alt="Boss" />
        <div id="game-over-text"></div>
      </div>
      <button id="play-again-btn" class="pulse">Play again</button>
    `;
    const sentences = [
      "Damnit Mark, we didn't meet our quota.",
      "Our stock is crashing!",
      "You're Fired!"
    ];
    const textEl = document.getElementById('game-over-text');
    let idx = 0;
    function showNext() {
      if (idx < sentences.length) {
        textEl.innerHTML = '';
        const p = document.createElement('p');
        p.textContent = sentences[idx++];
        textEl.appendChild(p);
      } else {
        clearInterval(interval);
      }
    }
    showNext();
    const interval = setInterval(showNext, 2500);
    const playAgainBtn = document.getElementById('play-again-btn');
    if (playAgainBtn) {
      playAgainBtn.addEventListener('click', () => location.reload());
    }
  }
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
  // Restart intro music on failure
  if (!win) {
    try {
      const introAudioElem = document.getElementById('intro-audio');
      if (introAudioElem) {
        introAudioElem.currentTime = 0;
        introAudioElem.play().catch(() => {});
      }
    } catch (e) {
      // ignore audio errors
    }
  }
}

// Ensure ringtone stops when game ends
const _endGame = endGame;
endGame = function(win) {
  stopRingTone();
  return _endGame(win);
};

