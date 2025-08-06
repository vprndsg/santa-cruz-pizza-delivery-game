// Initialize map centered on Santa Cruz, California with fixed zoom and no user zooming/panning
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
// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Custom emoji icons for helicopter, pizza shop, and house (drop-off)
// Use a custom image for the helicopter instead of the default emoji
const heliIcon = L.icon({
  iconUrl: 'IMG_3540.png',
  // scaled helicopter icon for better fit
  iconSize: [200, 200]
});
const pizzaIcon = L.divIcon({ html: "🍕", className: "pizza-icon", iconSize: [30, 30] });
const houseIcon = L.divIcon({ html: "🏠", className: "house-icon", iconSize: [30, 30] });

// Starting position for helicopter (near downtown Santa Cruz)
let heliLat = 36.974, heliLng = -122.030;
const helicopterMarker = L.marker([heliLat, heliLng], { icon: heliIcon }).addTo(map);

// Pizza shop pickup location (e.g., a pizza restaurant in Santa Cruz)
const pizzaLatLng = [36.9737, -122.0263];  // example location (downtown Santa Cruz)
const pizzaMarker = L.marker(pizzaLatLng, { icon: pizzaIcon }).addTo(map);
// (Optional: bind a popup label to the pizza shop)
// pizzaMarker.bindPopup("Pizza Shop").openPopup();

// Generate 10 random delivery locations (houses) around Santa Cruz
const houses = [];
const houseMarkers = [];
const bounds = {
  latMin: 36.96,
  latMax: 36.99,
  lngMin: -122.05,
  lngMax: -122.02
};
for (let i = 0; i < 10; i++) {
  // Random lat/lng within the defined bounds
  const randLat = bounds.latMin + Math.random() * (bounds.latMax - bounds.latMin);
  const randLng = bounds.lngMin + Math.random() * (bounds.lngMax - bounds.lngMin);
  houses.push([randLat, randLng]);
  const marker = L.marker([randLat, randLng], { icon: houseIcon });
  houseMarkers.push(marker);
  // Don't add to map yet – houses will appear after picking up pizza
}

// Game state variables
let carrying = false;            // whether helicopter is carrying a pizza
let deliveredCount = 0;          // how many deliveries made
let timeLeft = 60;               // 60 seconds total
let timerStarted = false;
let gameOver = false;

// HUD elements
const hud = document.getElementById('hud');
const gameOverScreen = document.getElementById('game-over');
const gameOverContent = document.getElementById('game-over-content');
gameOverScreen.style.display = 'none';

// Movement control variables
let upPressed = false, downPressed = false, leftPressed = false, rightPressed = false;
let latestBeta = 0, latestGamma = 0;  // last device tilt angles
let baselineBeta = null, baselineGamma = null;
const tiltThreshold = 10;            // minimum tilt (degrees) to move
const moveSpeed = 0.00005;           // movement step per frame (approx ~0.00005° per frame)

// Orientation permission (for iOS devices) - request on first touch if needed
window.addEventListener('click', function enableOrientation() {
  if (DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
    // Request permission to use device orientation for iOS
    DeviceOrientationEvent.requestPermission().catch(() => {
      console.warn('Device orientation permission denied or not requested.');
    });
  }
  window.removeEventListener('click', enableOrientation);
});

// Device orientation controls (mobile tilt)
window.addEventListener('deviceorientation', (e) => {
  // e.beta: front-back tilt (-180 to 180), e.gamma: left-right tilt (-90 to 90)
  if (e.beta !== null && e.gamma !== null) {
    // Calibrate on first reading
    if (baselineBeta === null) {
      baselineBeta = e.beta;
      baselineGamma = e.gamma;
    }
    // Adjust so controls are relative to initial orientation
    latestBeta = e.beta - baselineBeta;
    latestGamma = e.gamma - baselineGamma;
  }
});

// Keyboard controls (desktop)
window.addEventListener('keydown', (e) => {
  if (gameOver) return;
  switch (e.key) {
    case "ArrowUp":
      upPressed = true;
      e.preventDefault();
      break;
    case "ArrowDown":
      downPressed = true;
      e.preventDefault();
      break;
    case "ArrowLeft":
      leftPressed = true;
      e.preventDefault();
      break;
    case "ArrowRight":
      rightPressed = true;
      e.preventDefault();
      break;
  }
});
window.addEventListener('keyup', (e) => {
  switch (e.key) {
    case "ArrowUp":
      upPressed = false;
      e.preventDefault();
      break;
    case "ArrowDown":
      downPressed = false;
      e.preventDefault();
      break;
    case "ArrowLeft":
      leftPressed = false;
      e.preventDefault();
      break;
    case "ArrowRight":
      rightPressed = false;
      e.preventDefault();
      break;
  }
});

// Tap/click to pick up or deliver
map.on('click', () => {
  if (gameOver) return;
  const heliLatLng = helicopterMarker.getLatLng();
  // Attempt pickup (if not carrying and near pizza shop)
  if (!carrying) {
    if (heliLatLng.distanceTo(pizzaMarker.getLatLng()) < 50) {
      carrying = true;
      // Start the game timer on first pickup
      if (!timerStarted) {
        startTimer();
        timerStarted = true;
        // Add house markers to map now that delivery mission starts
        houseMarkers.forEach(marker => marker.addTo(map));
      }
      // TODO: play pickup sound effect (e.g., pizza pick-up sound)
    }
  } 
  // Attempt delivery (if carrying and near any house)
  else {
    for (let i = 0; i < houseMarkers.length; i++) {
      const houseMarker = houseMarkers[i];
      if (!houseMarker) continue;  // if already delivered (removed)
      if (heliLatLng.distanceTo(houseMarker.getLatLng()) < 50) {
        // Deliver pizza to this house
        houseMarker.remove();              // remove house marker from map
        houseMarkers[i] = null;            // mark as delivered
        deliveredCount++;
        // Update HUD score
        updateHUD();
        // TODO: play drop-off sound effect (e.g., delivery success sound)
        // Check if all deliveries done
        if (deliveredCount === 10) {
          endGame();
        }
        break;
      }
    }
  }
});

// Update HUD text
function updateHUD() {
  hud.textContent = `Deliveries: ${deliveredCount}/10 | Time: ${timeLeft}`;
}

// Start the countdown timer (1 minute)
function startTimer() {
  const timerInterval = setInterval(() => {
    timeLeft--;
    updateHUD();
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      endGame();
    }
  }, 1000);
}

// End the game and show results
function endGame() {
  if (gameOver) return;
  gameOver = true;
  // Stop movement and disable controls
  // (Game loop will exit on next iteration due to gameOver flag)
  // Show final results on screen
  let resultMessage = `Delivered ${deliveredCount} out of 10 pizzas.<br>`;
  resultMessage += `Time remaining: ${timeLeft} second${timeLeft === 1 ? "" : "s"}.`;
  if (timeLeft <= 0 && deliveredCount < 10) {
    resultMessage = `Time's up!<br>Delivered ${deliveredCount} out of 10 pizzas.<br>Time remaining: 0 seconds.`;
  }
  gameOverContent.innerHTML = resultMessage;
  gameOverScreen.style.display = "flex";
}

// Main game loop: update helicopter position based on input
function gameLoop() {
  if (gameOver) return;  // stop loop if game ended

  // Calculate movement deltas for this frame
  let moveLat = 0, moveLng = 0;
  // Keyboard input
  if (upPressed) moveLat += moveSpeed;
  if (downPressed) moveLat -= moveSpeed;
  if (rightPressed) moveLng += moveSpeed;
  if (leftPressed) moveLng -= moveSpeed;
  // Device tilt input
  if (Math.abs(latestBeta) > tiltThreshold) {
    if (latestBeta > tiltThreshold) moveLat += moveSpeed;
    else if (latestBeta < -tiltThreshold) moveLat -= moveSpeed;
  }
  if (Math.abs(latestGamma) > tiltThreshold) {
    if (latestGamma > tiltThreshold) moveLng += moveSpeed;
    else if (latestGamma < -tiltThreshold) moveLng -= moveSpeed;
  }

  // Update helicopter position if movement input is active
  if (moveLat !== 0 || moveLng !== 0) {
    // Compute new position
    heliLat += moveLat;
    // Adjust longitude movement by current latitude's cosine to maintain consistent speed
    const cosLat = Math.cos(heliLat * Math.PI / 180);
    heliLng += moveLng / (cosLat || 1);  // (avoid division by zero at poles, not an issue here)
    // Move the helicopter marker on the map
    helicopterMarker.setLatLng([heliLat, heliLng]);
    // Keep map centered on helicopter
    map.setView([heliLat, heliLng]);
  }

  // Handle helicopter sound effect toggling (placeholder hooks)
  let moving = (moveLat !== 0 || moveLng !== 0);
  if (moving && !heliSoundPlaying) {
    heliSoundPlaying = true;
    // TODO: start helicopter rotor sound (continuous while moving)
  } else if (!moving && heliSoundPlaying) {
    heliSoundPlaying = false;
    // TODO: stop/pause helicopter rotor sound
  }

  requestAnimationFrame(gameLoop);
}

// Sound effect state (for helicopter rotor)
let heliSoundPlaying = false;

// Start the game loop
requestAnimationFrame(gameLoop);
