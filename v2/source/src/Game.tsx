"use client";

import type { Circle, Map as LeafletMap, Marker, TileLayer } from "leaflet";
import { useCallback, useEffect, useRef, useState } from "react";

type Point = { lat: number; lng: number };
type Phase = "need_load" | "need_reload" | "cake" | "outbound";
type Screen = "intro" | "title" | "briefing" | "playing" | "won" | "lost";
type Modifier = "clear" | "gulls" | "fog" | "signal" | "night";
type LeafletApi = typeof import("leaflet");

const PIZZA_HQ = { lat: 36.9737, lng: -122.0263 };
const BOARDWALK = { lat: 36.964287, lng: -122.018822 };
const CAKE_PICKUP = { lat: 36.96455, lng: -122.01945 };
const CRUISE_SPEED = 240;
const BOOST_SPEED = 380;
const FLIGHT_ACCELERATION = 390;
const LANDING_SPEED = 32;

const MISSIONS = [
  {
    place: "Santa Cruz Boardwalk", short: "Boardwalk", caller: "Paige", emoji: "🎢", pizzas: 2,
    seconds: 45, position: BOARDWALK, modifier: "clear" as Modifier,
    portrait: "assets/paige-radio.webp", episode: "THE GIANT HUNGER", headline: "Feed the machine that screams",
    message: "Mark, the Giant Dipper crew skipped lunch and has started testing the brakes emotionally. Two pepperoni. Service gate. Move.",
    banter: ["I can see you over downtown. That aircraft is louder than the coaster.", "Bring it in clean. If you scratch the Dipper, it becomes historic twice."],
    thanks: "Crew fed. Brakes tested. Only one of those facts comforts me.",
  },
  {
    place: "Santa Cruz Wharf", short: "Wharf", caller: "Otter 841", emoji: "🦦", pizzas: 1,
    seconds: 48, position: { lat: 36.9615, lng: -122.0219 }, modifier: "gulls" as Modifier,
    portrait: "assets/otter-841-radio.webp", episode: "OPERATION: EXTRA CHEESE", headline: "The gulls know. They always know.",
    message: "Courier 841 reporting. One extra-cheese to the Wharf. Maintain radio silence. The gulls have compromised the lunch perimeter.",
    banter: ["Three gulls on your six. They look unionized.", "Package integrity is national security. Or lunch. The distinction is classified."],
    thanks: "Package secure. Otters 842 through 900 deny involvement.",
  },
  {
    place: "Santa Cruz Gardens", short: "S.C. Gardens", caller: "Mister Manager", emoji: "🐶", pizzas: 2,
    seconds: 80, position: { lat: 37.00371, lng: -121.97777 }, modifier: "fog" as Modifier,
    portrait: "assets/mister-manager-radio.webp", episode: "THE PERFORMANCE REVIEW", headline: "Your manager has concerns",
    message: "Mister Manager here. Two cheese to Santa Cruz Gardens. Fog is not an excuse. I checked the handbook. Woof.",
    banter: ["Your route efficiency is adequate. Do not make me upgrade that to concerning.", "I smell cheese through the radio. This call is being recorded for quality assurance."],
    thanks: "Delivery accepted. Tail-wag authorization granted for twelve seconds.",
  },
  {
    place: "UCSC East Field", short: "UCSC", caller: "Slug Kid", emoji: "🐌", pizzas: 1,
    seconds: 75, position: { lat: 37.00053, lng: -122.06692 }, modifier: "signal" as Modifier,
    portrait: "assets/slug-radio.webp", episode: "PIZZA IS A CONSTRUCT", headline: "The redwoods are bending time",
    message: "Hey, Mark? One mushroom to East Field. The redwoods ate my signal. Or my phone. Is a delivery late if clocks are colonial?",
    banter: ["I can hear propellers, but spiritually. You are, like, extremely nearby in the universe.", "Turn left at the redwood that looks like every other redwood. You cannot miss it."],
    thanks: "The pizza arrived before the concept of pizza. Five stars forever.",
  },
  {
    place: "Bonny Doon Birthday Base", short: "Bonny Doon", caller: "JoBen", emoji: "🎂", pizzas: 3,
    seconds: 135, position: { lat: 37.062073, lng: -122.149203 }, modifier: "night" as Modifier,
    portrait: "assets/job-en-boss.webp", episode: "THE BIRTHDAY PROTOCOL", headline: "JoBen has lied about the cargo",
    message: "Small correction: this was never a normal shift. Load three pies, steal your own pizza-cake from the Boardwalk, then climb to Bonny Doon.",
    banter: ["Surprise parties require secrecy, altitude and several labor violations.", "Everybody is waiting. Mister Manager has eaten one decorative balloon."],
    thanks: "Quota met. Cake intact. Mark may now attend his own birthday.",
  },
] as const;

const RADIO_VOICE_PROFILES = {
  Paige: { label: "BOARDWALK FM" },
  "Otter 841": { label: "CLASSIFIED BAND" },
  "Mister Manager": { label: "EXECUTIVE BARK" },
  "Slug Kid": { label: "REDWOOD WAVES" },
  JoBen: { label: "DISPATCH PRIME" },
} as const;

const DEFAULT_RADIO_VOICE = {
  label: "JOBY COMMS",
};

function radioVoiceProfile(speaker: string) {
  return RADIO_VOICE_PROFILES[speaker as keyof typeof RADIO_VOICE_PROFILES] ?? DEFAULT_RADIO_VOICE;
}

const RELOAD_RADIO_LINE = "I saw that. We will call it a tactical pizza exchange.";
const CAKE_RADIO_LINE = "That cake is technically evidence. Get it to Bonny Doon before the candles become a wildfire permit.";
const HAZARD_RADIO_LINES = {
  drone: "Mark, a rival delivery drone just tried to annex your cargo.",
  flock: "That was not a flock. That was an organized lunch crime.",
  gull: "Mark, a bird just committed a felony against that pizza.",
} as const;

const radioAudioKey = (speaker: string, text: string) => `${speaker}::${text}`;
type RadioClip = { src: string; start: number; duration: number };
const VOICE_DURATIONS = [
  [9.168, 6.96, 6.36, 4.8, 4.752, 5.016, 5.352, 4.2],
  [10.704, 3.456, 5.808, 4.848, 3.6, 4.656, 4.248, 5.448],
  [7.848, 4.92, 6.264, 4.848, 3.72, 4.368, 5.064, 3.816],
  [9, 7.152, 6.168, 5.568, 4.32, 5.952, 4.416, 4.512],
  [8.448, 5.208, 5.016, 4.608, 3.768, 4.416, 4.512, 3.864, 6.6],
] as const;
const RADIO_AUDIO = new Map<string, RadioClip>();
MISSIONS.forEach((mission, missionIndex) => {
  const lines = [mission.message, ...mission.banter, mission.thanks, RELOAD_RADIO_LINE, ...Object.values(HAZARD_RADIO_LINES)];
  let start = 0;
  lines.forEach((line, lineIndex) => {
    const duration = VOICE_DURATIONS[missionIndex][lineIndex];
    RADIO_AUDIO.set(radioAudioKey(mission.caller, line), { src: `assets/voices-sprite/m${missionIndex}.mp3`, start, duration });
    start += duration;
  });
});
RADIO_AUDIO.set(radioAudioKey("JoBen", CAKE_RADIO_LINE), { src: "assets/voices-sprite/m4.mp3", start: VOICE_DURATIONS[4].slice(0, 8).reduce((sum, duration) => sum + duration, 0), duration: VOICE_DURATIONS[4][8] });

function radioAudioPath(speaker: string, text: string) {
  return RADIO_AUDIO.get(radioAudioKey(speaker, text));
}

type Pickup = { lat: number; lng: number; kind: "tip" | "boost"; active: boolean };
type HazardKind = "gull" | "flock" | "drone";
type Hazard = {
  center: Point;
  lat: number;
  lng: number;
  radius: number;
  angle: number;
  angularSpeed: number;
  kind: HazardKind;
  missions: readonly number[];
  hitRadius: number;
};

type GameState = {
  position: Point;
  eastVelocity: number;
  northVelocity: number;
  heading: number;
  mission: number;
  phase: Phase;
  resumePhase: "cake" | "outbound";
  missionActive: boolean;
  pizzas: number;
  time: number;
  shiftElapsed: number;
  tips: number;
  integrity: number;
  combo: number;
  boostCharges: number;
  boostTime: number;
  landingProgress: number;
  hitCooldown: number;
  note: string;
  noteUntil: number;
  callUntil: number;
  radioText: string;
  radioSpeaker: string;
  radioAvatar: string;
  banterStage: number;
  legDistance: number;
  chapterUntil: number;
  pickups: Pickup[];
  gulls: Hazard[];
  last: number;
  lastMap: number;
};

type Hud = {
  mission: number;
  phase: Phase;
  missionActive: boolean;
  time: number;
  shiftElapsed: number;
  pizzas: number;
  tips: number;
  integrity: number;
  combo: number;
  boostCharges: number;
  boostActive: boolean;
  speed: number;
  heading: number;
  distance: number;
  bearing: number;
  targetLabel: string;
  actionLabel: string;
  readyToLand: boolean;
  landingProgress: number;
  note: string;
  noteVisible: boolean;
  callVisible: boolean;
  radioText: string;
  radioSpeaker: string;
  radioAvatar: string;
  chapterVisible: boolean;
  signalLost: boolean;
  impact: boolean;
};

const initialHud: Hud = {
  mission: 0, phase: "need_load", missionActive: false, time: MISSIONS[0].seconds, shiftElapsed: 0,
  pizzas: 0, tips: 0, integrity: 3, combo: 0, boostCharges: 1,
  boostActive: false, speed: 0, heading: 45, distance: 0, bearing: 0, targetLabel: "Pizza HQ · Front Street",
  actionLabel: "Hold to load", readyToLand: true, landingProgress: 0,
  note: "", noteVisible: false, callVisible: false,
  radioText: MISSIONS[0].message, radioSpeaker: MISSIONS[0].caller, radioAvatar: MISSIONS[0].portrait,
  chapterVisible: false, signalLost: false, impact: false,
};

const freshState = (): GameState => ({
  position: { ...PIZZA_HQ }, eastVelocity: 0, northVelocity: 0, heading: 45,
  mission: 0, phase: "need_load", resumePhase: "outbound", missionActive: false,
  pizzas: 0, time: MISSIONS[0].seconds, shiftElapsed: 0, tips: 0, integrity: 3,
  combo: 0, boostCharges: 1, boostTime: 0, landingProgress: 0,
  hitCooldown: 0, note: "Hold LAND at Pizza HQ to load Paige’s order.",
  noteUntil: performance.now() + 5000, callUntil: performance.now() + 6500,
  radioText: MISSIONS[0].message, radioSpeaker: MISSIONS[0].caller, radioAvatar: MISSIONS[0].portrait,
  banterStage: 0, legDistance: 1, chapterUntil: 0,
  pickups: [],
  gulls: [
    { center: { lat: 36.9701, lng: -122.0242 }, lat: 36.9701, lng: -122.0242, radius: 105, angle: 0, angularSpeed: .62, kind: "gull", missions: [0, 1, 4], hitRadius: 62 },
    { center: { lat: 36.9672, lng: -122.0210 }, lat: 36.9672, lng: -122.0210, radius: 135, angle: 2.2, angularSpeed: -.55, kind: "flock", missions: [0, 1, 4], hitRadius: 82 },
    { center: { lat: 36.9648, lng: -122.0194 }, lat: 36.9648, lng: -122.0194, radius: 92, angle: 4.1, angularSpeed: .78, kind: "drone", missions: [0, 1, 4], hitRadius: 66 },
    { center: { lat: 36.9619, lng: -122.0220 }, lat: 36.9619, lng: -122.0220, radius: 155, angle: 1.4, angularSpeed: -.72, kind: "flock", missions: [1], hitRadius: 84 },
    { center: { lat: 36.9631, lng: -122.0197 }, lat: 36.9631, lng: -122.0197, radius: 80, angle: 3.5, angularSpeed: 1.05, kind: "gull", missions: [1], hitRadius: 60 },
    { center: { lat: 36.9820, lng: -122.0105 }, lat: 36.9820, lng: -122.0105, radius: 150, angle: .8, angularSpeed: -.48, kind: "drone", missions: [2], hitRadius: 68 },
    { center: { lat: 36.9918, lng: -121.9950 }, lat: 36.9918, lng: -121.9950, radius: 185, angle: 2.8, angularSpeed: .46, kind: "flock", missions: [2], hitRadius: 84 },
    { center: { lat: 37.0002, lng: -121.9798 }, lat: 37.0002, lng: -121.9798, radius: 115, angle: 5.1, angularSpeed: -.66, kind: "gull", missions: [2], hitRadius: 62 },
    { center: { lat: 36.9838, lng: -122.0410 }, lat: 36.9838, lng: -122.0410, radius: 170, angle: .3, angularSpeed: .53, kind: "drone", missions: [3], hitRadius: 68 },
    { center: { lat: 36.9924, lng: -122.0554 }, lat: 36.9924, lng: -122.0554, radius: 130, angle: 2.1, angularSpeed: -.74, kind: "flock", missions: [3], hitRadius: 84 },
    { center: { lat: 36.9992, lng: -122.0654 }, lat: 36.9992, lng: -122.0654, radius: 92, angle: 4.6, angularSpeed: .92, kind: "gull", missions: [3], hitRadius: 62 },
    { center: { lat: 36.9900, lng: -122.0520 }, lat: 36.9900, lng: -122.0520, radius: 210, angle: 1.7, angularSpeed: -.42, kind: "flock", missions: [4], hitRadius: 84 },
    { center: { lat: 37.0170, lng: -122.0860 }, lat: 37.0170, lng: -122.0860, radius: 185, angle: 3.2, angularSpeed: .51, kind: "drone", missions: [4], hitRadius: 68 },
    { center: { lat: 37.0410, lng: -122.1220 }, lat: 37.0410, lng: -122.1220, radius: 170, angle: 5.4, angularSpeed: -.58, kind: "flock", missions: [4], hitRadius: 86 },
    { center: { lat: 37.0570, lng: -122.1450 }, lat: 37.0570, lng: -122.1450, radius: 105, angle: 2.5, angularSpeed: .82, kind: "gull", missions: [4], hitRadius: 62 },
  ],
  last: performance.now(), lastMap: 0,
});

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function distanceMeters(a: Point, b: Point) {
  const radius = 6371000;
  const p1 = a.lat * Math.PI / 180; const p2 = b.lat * Math.PI / 180;
  const dLat = (b.lat - a.lat) * Math.PI / 180; const dLng = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearingDegrees(a: Point, b: Point) {
  const p1 = a.lat * Math.PI / 180; const p2 = b.lat * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function offsetPoint(origin: Point, eastMeters: number, northMeters: number): Point {
  return {
    lat: origin.lat + northMeters / 111320,
    lng: origin.lng + eastMeters / (111320 * Math.cos(origin.lat * Math.PI / 180)),
  };
}

function interpolateRoute(a: Point, b: Point, fraction: number, lateralMeters: number): Point {
  const lat = a.lat + (b.lat - a.lat) * fraction;
  const lng = a.lng + (b.lng - a.lng) * fraction;
  const brng = bearingDegrees(a, b) * Math.PI / 180;
  return offsetPoint({ lat, lng }, Math.cos(brng) * lateralMeters, -Math.sin(brng) * lateralMeters);
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatTime(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function currentTarget(g: GameState): { point: Point; label: string; emoji: string } {
  if (g.phase === "need_load" || g.phase === "need_reload") return { point: PIZZA_HQ, label: g.phase === "need_reload" ? "Pizza HQ · Reload" : "Pizza HQ · Load order", emoji: "🍕" };
  if (g.phase === "cake") return { point: CAKE_PICKUP, label: "Boardwalk · Pizza-cake pickup", emoji: "🎂" };
  const m = MISSIONS[g.mission];
  return { point: m.position, label: m.place, emoji: m.emoji };
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("intro");
  const [introStarted, setIntroStarted] = useState(false);
  const [introError, setIntroError] = useState("");
  const [introStalled, setIntroStalled] = useState(false);
  const [briefingStalled, setBriefingStalled] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [tileStatus, setTileStatus] = useState<"loading" | "ready" | "error">("loading");
  const [hud, setHud] = useState<Hud>(initialHud);
  const [finalScore, setFinalScore] = useState(0);
  const [bestScore, setBestScore] = useState(() => {
    if (typeof window === "undefined") return 0;
    const stored = Number(localStorage.getItem("sc-pizza-2-best") || 0);
    return Number.isFinite(stored) ? stored : 0;
  });
  const [stickVisual, setStickVisual] = useState({ x: 0, y: 0 });

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const introVideoRef = useRef<HTMLVideoElement>(null);
  const briefingVideoRef = useRef<HTMLVideoElement>(null);
  const introStallTimerRef = useRef<number | null>(null);
  const briefingStallTimerRef = useRef<number | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const tileLayerRef = useRef<TileLayer | null>(null);
  const leafletRef = useRef<LeafletApi | null>(null);
  const targetMarkerRef = useRef<Marker | null>(null);
  const targetCircleRef = useRef<Circle | null>(null);
  const gullMarkerRefs = useRef<Marker[]>([]);
  const pickupMarkerRefs = useRef<Marker[]>([]);
  const gameRef = useRef<GameState | null>(null);
  const keysRef = useRef(new Set<string>());
  const stickRef = useRef({ active: false, id: -1, x: 0, y: 0, startX: 0, startY: 0 });
  const landHeldRef = useRef(false);
  const devAutopilotRef = useRef(false);
  const mutedRef = useRef(false);
  const speechActiveRef = useRef(false);
  const speechTokenRef = useRef(0);
  const lastSpokenRef = useRef("");
  const radioAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioRef = useRef<{ ctx: AudioContext | null; timer: ReturnType<typeof setInterval> | null; step: number; engine: OscillatorNode | null; engineGain: GainNode | null }>({ ctx: null, timer: null, step: 0, engine: null, engineGain: null });
  const lastHudRef = useRef(0);

  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const stopSpeech = useCallback(() => {
    speechTokenRef.current++; speechActiveRef.current = false;
    if (radioAudioRef.current) {
      radioAudioRef.current.pause();
      radioAudioRef.current.removeAttribute("src");
      radioAudioRef.current = null;
    }
  }, []);

  const speakRadio = useCallback((speaker: string, text: string) => {
    if (mutedRef.current) return;
    const clip = radioAudioPath(speaker, text); if (!clip) return;
    if (radioAudioRef.current) radioAudioRef.current.pause();
    const audio = new Audio(clip.src);
    const token = ++speechTokenRef.current;
    radioAudioRef.current = audio; audio.volume = .96; audio.preload = "auto";
    audio.onloadedmetadata = () => {
      audio.currentTime = clip.start;
      const game = gameRef.current;
      if (game && game.radioSpeaker === speaker && game.radioText === text) {
        game.callUntil = Math.max(game.callUntil, performance.now() + clip.duration * 1000 + 550);
      }
    };
    audio.onplaying = () => { if (speechTokenRef.current === token) speechActiveRef.current = true; };
    const finish = () => { if (speechTokenRef.current === token) speechActiveRef.current = false; };
    audio.ontimeupdate = () => { if (audio.currentTime >= clip.start + clip.duration) { audio.pause(); finish(); } };
    audio.onended = finish; audio.onerror = finish;
    void audio.play().catch(finish);
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto"; audio.src = `assets/voices-sprite/m${Math.min(hud.mission, MISSIONS.length - 1)}.mp3`; audio.load();
    return () => { audio.pause(); audio.removeAttribute("src"); };
  }, [hud.mission]);

  const tone = useCallback((frequency: number, duration = .09, type: OscillatorType = "square", volume = .035) => {
    if (mutedRef.current) return;
    const ctx = audioRef.current.ctx; if (!ctx) return;
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = type; osc.frequency.value = frequency;
    const mixedVolume = speechActiveRef.current ? volume * .2 : volume;
    gain.gain.setValueAtTime(mixedVolume, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + duration);
  }, []);

  const startMusic = useCallback(() => {
    if (!audioRef.current.ctx) audioRef.current.ctx = new AudioContext();
    if (audioRef.current.ctx.state === "suspended") void audioRef.current.ctx.resume();
    if (audioRef.current.timer) clearInterval(audioRef.current.timer);
    if (audioRef.current.engine) { try { audioRef.current.engine.stop(); } catch {} }
    const engine = audioRef.current.ctx.createOscillator(); const engineGain = audioRef.current.ctx.createGain();
    engine.type = "sawtooth"; engine.frequency.value = 78; engineGain.gain.value = .0001;
    engine.connect(engineGain).connect(audioRef.current.ctx.destination); engine.start();
    audioRef.current.engine = engine; audioRef.current.engineGain = engineGain;
    const notes = [130.8, 0, 164.8, 196, 0, 164.8, 220, 196, 146.8, 0, 196, 220, 261.6, 220, 196, 164.8];
    audioRef.current.step = 0;
    audioRef.current.timer = setInterval(() => {
      const note = notes[audioRef.current.step++ % notes.length];
      if (note) tone(note, .12, "square", .014);
    }, 175);
  }, [tone]);

  const stopMusic = useCallback(() => {
    if (audioRef.current.timer) clearInterval(audioRef.current.timer);
    audioRef.current.timer = null;
    if (audioRef.current.engine) { try { audioRef.current.engine.stop(); } catch {} }
    audioRef.current.engine = null; audioRef.current.engineGain = null;
  }, []);

  useEffect(() => () => { stopMusic(); stopSpeech(); }, [stopMusic, stopSpeech]);

  const clearPickups = useCallback(() => {
    pickupMarkerRefs.current.forEach((marker) => marker.remove());
    pickupMarkerRefs.current = [];
  }, []);

  const refreshTarget = useCallback((g: GameState) => {
    const L = leafletRef.current; const map = mapRef.current; if (!L || !map) return;
    const target = currentTarget(g);
    const html = `<div class="target-pin"><span>${target.emoji}</span><b>${g.phase === "need_load" || g.phase === "need_reload" ? "HQ" : g.phase === "cake" ? "CAKE" : "DROP"}</b></div>`;
    const icon = L.divIcon({ className: "target-icon-shell", html, iconSize: [74, 74], iconAnchor: [37, 37] });
    if (!targetMarkerRef.current) targetMarkerRef.current = L.marker(target.point, { icon, interactive: false, zIndexOffset: 400 }).addTo(map);
    else { targetMarkerRef.current.setLatLng(target.point); targetMarkerRef.current.setIcon(icon); }
    if (!targetCircleRef.current) targetCircleRef.current = L.circle(target.point, { radius: 90, color: "#ffd43b", weight: 3, opacity: .9, fillColor: "#ffd43b", fillOpacity: .08, interactive: false }).addTo(map);
    else targetCircleRef.current.setLatLng(target.point);
  }, []);

  const spawnPickups = useCallback((g: GameState, from: Point, to: Point) => {
    const L = leafletRef.current; const map = mapRef.current; if (!L || !map) return;
    clearPickups();
    const specs: { fraction: number; lateral: number; kind: "tip" | "boost" }[] = [
      { fraction: .18, lateral: -70, kind: "tip" }, { fraction: .32, lateral: 95, kind: "tip" },
      { fraction: .46, lateral: -105, kind: "boost" }, { fraction: .6, lateral: 75, kind: "tip" },
      { fraction: .74, lateral: -80, kind: "tip" }, { fraction: .86, lateral: 55, kind: "boost" },
    ];
    g.pickups = specs.map((spec) => ({ ...interpolateRoute(from, to, spec.fraction, spec.lateral), kind: spec.kind, active: true }));
    pickupMarkerRefs.current = g.pickups.map((pickup) => {
      const html = pickup.kind === "tip" ? `<div class="map-pickup tip-pickup">$</div>` : `<div class="map-pickup boost-pickup">⚡</div>`;
      const icon = L.divIcon({ className: "pickup-icon-shell", html, iconSize: [34, 34], iconAnchor: [17, 17] });
      return L.marker(pickup, { icon, interactive: false, zIndexOffset: 220 }).addTo(map);
    });
  }, [clearPickups]);

  useEffect(() => {
    if (screen !== "playing" || !mapContainerRef.current) return;
    let disposed = false;
    setTileStatus("loading"); setMapReady(false);
    void import("leaflet").then((module) => {
      if (disposed || !mapContainerRef.current) return;
      const L = module.default;
      leafletRef.current = L;
      const map = L.map(mapContainerRef.current, {
        center: PIZZA_HQ, zoom: 16.75, minZoom: 14, maxZoom: 17,
        zoomSnap: .25, zoomControl: false, dragging: false, touchZoom: false,
        scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
        keyboard: false, preferCanvas: true,
        maxBounds: [[36.925, -122.19], [37.09, -121.94]], maxBoundsViscosity: 1,
      });
      mapRef.current = map;
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, keepBuffer: 6, updateWhenIdle: false, crossOrigin: true,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);
      tileLayerRef.current = tiles;
      tiles.once("load", () => !disposed && setTileStatus("ready"));
      tiles.on("tileerror", () => !disposed && setTileStatus("error"));

      const hqIcon = L.divIcon({ className: "hq-icon-shell", html: `<div class="hq-pin"><img src="assets/joby-wing-mark.webp" alt="" /><b>JOBY PIZZA HQ</b></div>`, iconSize: [98, 72], iconAnchor: [49, 36] });
      L.marker(PIZZA_HQ, { icon: hqIcon, interactive: false, zIndexOffset: 200 }).addTo(map);

      const g = gameRef.current;
      if (g) {
        gullMarkerRefs.current = g.gulls.map((hazard) => {
          const asset = hazard.kind === "flock" ? "assets/seagull-flock-v2.webp" : hazard.kind === "drone" ? "assets/rival-drone-obstacle.webp" : "assets/seagull-enemy.webp";
          const size = hazard.kind === "flock" ? 84 : hazard.kind === "drone" ? 72 : 62;
          const icon = L.divIcon({ className: `gull-icon-shell hazard-${hazard.kind}`, html: `<img src="${asset}" alt="" />`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
          return L.marker(hazard, { icon, interactive: false, zIndexOffset: 300 }).addTo(map);
        });
        refreshTarget(g);
      }
      setMapReady(true);
      requestAnimationFrame(() => map.invalidateSize());
    });
    return () => {
      disposed = true; setMapReady(false);
      clearPickups(); gullMarkerRefs.current = [];
      targetMarkerRef.current = null; targetCircleRef.current = null;
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = null; tileLayerRef.current = null; leafletRef.current = null;
    };
  }, [screen, clearPickups, refreshTarget]);

  const startGame = useCallback(() => {
    const g = freshState(); gameRef.current = g;
    devAutopilotRef.current = window.location.hostname === "terminal.local" && new URLSearchParams(window.location.search).has("autoplay");
    setHud({ ...initialHud, callVisible: true, note: g.note, noteVisible: true });
    setPaused(false); setScreen("playing"); startMusic();
    lastSpokenRef.current = `${MISSIONS[0].caller}::${MISSIONS[0].message}`;
    speakRadio(MISSIONS[0].caller, MISSIONS[0].message);
    tone(392, .1, "square", .05); setTimeout(() => tone(523.25, .16, "square", .05), 110);
  }, [speakRadio, startMusic, tone]);

  const activateBoost = useCallback(() => {
    const g = gameRef.current;
    if (!g || paused || g.boostCharges <= 0 || g.boostTime > 0) return;
    const speed = Math.hypot(g.eastVelocity, g.northVelocity);
    const launchSpeed = Math.min(BOOST_SPEED, Math.max(speed, CRUISE_SPEED * 1.15));
    const heading = g.heading * Math.PI / 180;
    const eastDirection = speed > 1 ? g.eastVelocity / speed : Math.sin(heading);
    const northDirection = speed > 1 ? g.northVelocity / speed : Math.cos(heading);
    g.eastVelocity = eastDirection * launchSpeed;
    g.northVelocity = northDirection * launchSpeed;
    g.boostCharges--; g.boostTime = 4; g.note = "AFTERBURN ENGAGED · 850 MPH"; g.noteUntil = performance.now() + 1600;
    tone(659.25, .18, "sawtooth", .05);
  }, [paused, tone]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) event.preventDefault();
      if (key === " ") activateBoost();
      if (key === "e" || key === "enter") landHeldRef.current = true;
      if (key === "p" && screen === "playing") setPaused((value) => !value);
      if (key === "t" && window.location.hostname === "terminal.local") devAutopilotRef.current = !devAutopilotRef.current;
      keysRef.current.add(key);
    };
    const up = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase(); keysRef.current.delete(key);
      if (key === "e" || key === "enter") landHeldRef.current = false;
    };
    const blur = () => { keysRef.current.clear(); landHeldRef.current = false; stickRef.current.x = 0; stickRef.current.y = 0; };
    window.addEventListener("keydown", down, { passive: false }); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, [activateBoost, screen]);

  useEffect(() => {
    if (screen !== "playing" || paused || muted) {
      if (paused || muted || screen !== "playing") { lastSpokenRef.current = ""; stopSpeech(); }
      return;
    }
    if (!hud.callVisible || !hud.radioText) return;
    const speechKey = `${hud.radioSpeaker}::${hud.radioText}`;
    if (lastSpokenRef.current === speechKey) return;
    lastSpokenRef.current = speechKey;
    const delay = window.setTimeout(() => speakRadio(hud.radioSpeaker, hud.radioText), 90);
    return () => window.clearTimeout(delay);
  }, [screen, paused, muted, hud.callVisible, hud.radioSpeaker, hud.radioText, speakRadio, stopSpeech]);

  useEffect(() => {
    if (screen !== "playing" || !mapReady || paused) return;
    const g = gameRef.current; const map = mapRef.current; if (!g || !map) return;
    let frame = 0; g.last = performance.now();

    const finishWithLoss = (score: number, message: string) => {
      g.note = message; stopMusic(); tone(92, .45, "sawtooth", .07); setFinalScore(score); setScreen("lost");
    };

    const finishLandingAction = (now: number) => {
      const mission = MISSIONS[g.mission];
      g.landingProgress = 0;
      if (g.phase === "need_load") {
        g.pizzas = mission.pizzas; g.missionActive = true; g.time = mission.seconds;
        g.phase = g.mission === MISSIONS.length - 1 ? "cake" : "outbound";
        g.note = `CARGO LOCKED · ${mission.pizzas} PIZZA${mission.pizzas > 1 ? "S" : ""} · GO GO GO`;
        g.noteUntil = now + 2600; g.callUntil = now + 5800; g.chapterUntil = now + 2500;
        g.radioText = mission.message; g.radioSpeaker = mission.caller; g.radioAvatar = mission.portrait;
        g.banterStage = 0; g.legDistance = distanceMeters(g.position, currentTarget(g).point);
        spawnPickups(g, PIZZA_HQ, g.phase === "cake" ? CAKE_PICKUP : mission.position);
      } else if (g.phase === "need_reload") {
        g.pizzas = mission.pizzas; g.phase = g.resumePhase;
        g.note = "REPLACEMENT PIZZA LOCKED · THE CLOCK IS STILL RUDE"; g.noteUntil = now + 2600;
        g.radioText = RELOAD_RADIO_LINE; g.radioSpeaker = mission.caller; g.radioAvatar = mission.portrait; g.callUntil = now + 4400;
        g.banterStage = 0; g.legDistance = distanceMeters(g.position, currentTarget(g).point);
        spawnPickups(g, PIZZA_HQ, g.phase === "cake" ? CAKE_PICKUP : mission.position);
      } else if (g.phase === "cake") {
        g.phase = "outbound"; g.note = "PIZZA-CAKE SECURED · MOUNTAIN RUN AUTHORIZED"; g.noteUntil = now + 4200;
        g.radioText = CAKE_RADIO_LINE; g.radioSpeaker = "JoBen"; g.radioAvatar = mission.portrait; g.callUntil = now + 5600;
        g.banterStage = 0; g.legDistance = distanceMeters(g.position, mission.position);
        spawnPickups(g, CAKE_PICKUP, mission.position);
        tone(523.25, .08); setTimeout(() => tone(659.25, .08), 80); setTimeout(() => tone(783.99, .15), 160);
      } else {
        const deliveryTip = Math.round(g.time * 2.5) + g.combo * 75 + g.integrity * 40;
        g.tips += deliveryTip; g.combo++; g.missionActive = false; g.pizzas = 0; clearPickups();
        tone(523.25, .08); setTimeout(() => tone(659.25, .08), 80); setTimeout(() => tone(783.99, .15), 160);
        g.mission++;
        if (g.mission >= MISSIONS.length) {
          const score = g.tips + g.integrity * 200 + Math.max(0, 900 - Math.round(g.shiftElapsed));
          stopMusic(); setFinalScore(score);
          const nextBest = Math.max(bestScore, score); setBestScore(nextBest); localStorage.setItem("sc-pizza-2-best", String(nextBest));
          setScreen("won"); return;
        }
        g.phase = "need_load"; g.time = MISSIONS[g.mission].seconds;
        g.note = `DELIVERY CLEAN · +$${deliveryTip} · RETURN TO HQ`; g.noteUntil = now + 4200; g.callUntil = now + 6200;
        g.radioText = mission.thanks; g.radioSpeaker = mission.caller; g.radioAvatar = mission.portrait;
      }
      refreshTarget(g);
    };

    const loop = (now: number) => {
      const devAuto = devAutopilotRef.current;
      const rawDt = Math.max(0, (now - g.last) / 1000);
      const dt = devAuto ? Math.min(.5, rawDt) * 4 : Math.min(.06, rawDt);
      g.last = now; g.shiftElapsed += dt;
      const mission = MISSIONS[g.mission]; if (!mission) return;
      if (g.missionActive) {
        g.time -= dt;
        if (g.time <= 0) { finishWithLoss(g.tips, "ORDER EXPIRED · JOBEN IS OPENING THE SPREADSHEET"); return; }
      }
      g.hitCooldown = Math.max(0, g.hitCooldown - dt); g.boostTime = Math.max(0, g.boostTime - dt);

      const target = currentTarget(g); const targetDistance = distanceMeters(g.position, target.point);
      if (g.missionActive && g.phase === "outbound" && g.legDistance > 100) {
        const progress = 1 - targetDistance / g.legDistance;
        const nextStage = progress > .68 ? 2 : progress > .34 ? 1 : 0;
        if (nextStage > g.banterStage) {
          g.banterStage = nextStage;
          g.radioText = mission.banter[nextStage - 1]; g.radioSpeaker = mission.caller; g.radioAvatar = mission.portrait;
          g.callUntil = now + 4700;
          tone(nextStage === 1 ? 392 : 523.25, .06, "square", .025);
        }
      }
      const keys = keysRef.current;
      let eastInput = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0) + stickRef.current.x;
      let northInput = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - stickRef.current.y;

      if (devAuto) {
        const northMeters = (target.point.lat - g.position.lat) * 111320;
        const eastMeters = (target.point.lng - g.position.lng) * 111320 * Math.cos(g.position.lat * Math.PI / 180);
        const magnitude = Math.max(1, Math.hypot(eastMeters, northMeters));
        if (targetDistance > 70) {
          const autoSpeed = Math.min(560, Math.max(24, (targetDistance - 50) / Math.max(dt, .01) * .58));
          g.eastVelocity = eastMeters / magnitude * autoSpeed;
          g.northVelocity = northMeters / magnitude * autoSpeed;
        } else {
          g.eastVelocity = 0; g.northVelocity = 0;
        }
        eastInput = 0; northInput = 0;
        landHeldRef.current = targetDistance < 80;
      }

      const inputMagnitude = Math.hypot(eastInput, northInput);
      if (inputMagnitude > 1) { eastInput /= inputMagnitude; northInput /= inputMagnitude; }
      if (!devAuto) {
        const weatherDrift = mission.modifier === "fog" && g.missionActive ? Math.sin(now / 900) * 2.7 : 0;
        g.eastVelocity += (eastInput * FLIGHT_ACCELERATION + weatherDrift) * dt;
        g.northVelocity += northInput * FLIGHT_ACCELERATION * dt;
        if (g.boostTime > 0) {
          const boostHeading = g.heading * Math.PI / 180;
          g.eastVelocity += Math.sin(boostHeading) * FLIGHT_ACCELERATION * 1.15 * dt;
          g.northVelocity += Math.cos(boostHeading) * FLIGHT_ACCELERATION * 1.15 * dt;
        }
        const drag = Math.exp(-(g.boostTime > 0 ? .18 : inputMagnitude > .05 ? .48 : 1.75) * dt);
        g.eastVelocity *= drag; g.northVelocity *= drag;
      }
      const speed = Math.hypot(g.eastVelocity, g.northVelocity);
      const maxSpeed = devAuto ? 560 : g.boostTime > 0 ? BOOST_SPEED : CRUISE_SPEED;
      if (speed > maxSpeed) { g.eastVelocity *= maxSpeed / speed; g.northVelocity *= maxSpeed / speed; }
      const actualSpeed = Math.hypot(g.eastVelocity, g.northVelocity);
      const audio = audioRef.current;
      if (audio.ctx && audio.engine && audio.engineGain) {
        const at = audio.ctx.currentTime;
        const engineLevel = .004 + Math.min(actualSpeed / CRUISE_SPEED, 1.5) * .012;
        const audible = mutedRef.current ? .0001 : engineLevel * (speechActiveRef.current ? .16 : 1);
        audio.engine.frequency.setTargetAtTime(72 + actualSpeed * .72 + (g.boostTime > 0 ? 55 : 0), at, .06);
        audio.engineGain.gain.setTargetAtTime(audible, at, .08);
      }
      if (actualSpeed > 1.5) g.heading = (Math.atan2(g.eastVelocity, g.northVelocity) * 180 / Math.PI + 360) % 360;
      g.position = offsetPoint(g.position, g.eastVelocity * dt, g.northVelocity * dt);
      g.position.lat = clamp(g.position.lat, 36.925, 37.09); g.position.lng = clamp(g.position.lng, -122.19, -121.94);

      g.gulls.forEach((gull, index) => {
        const hazardActive = g.missionActive && (g.phase === "outbound" || g.phase === "cake") && gull.missions.includes(g.mission);
        gull.angle += gull.angularSpeed * dt;
        gull.lat = offsetPoint(gull.center, Math.cos(gull.angle) * gull.radius, Math.sin(gull.angle) * gull.radius).lat;
        gull.lng = offsetPoint(gull.center, Math.cos(gull.angle) * gull.radius, Math.sin(gull.angle) * gull.radius).lng;
        const marker = gullMarkerRefs.current[index]; if (marker) { marker.setLatLng(gull); marker.setOpacity(hazardActive ? 1 : 0); }
        if (hazardActive && !devAuto && g.hitCooldown <= 0 && distanceMeters(g.position, gull) < gull.hitRadius) {
          const threat = gull.kind === "drone" ? "ROGUE DRONE" : gull.kind === "flock" ? "GULL MOB" : "GULL";
          g.hitCooldown = 2.4; g.integrity--; g.time = Math.max(1, g.time - 3); g.combo = 0;
          g.note = `${threat} STRIKE · −3 SEC · CARGO SECURE`;
          g.radioText = HAZARD_RADIO_LINES[gull.kind];
          g.radioSpeaker = mission.caller; g.radioAvatar = mission.portrait; g.callUntil = now + 4200;
          g.noteUntil = now + 4200; tone(116, .24, "sawtooth", .07);
          if (g.integrity <= 0) { finishWithLoss(g.tips, "AIRCRAFT GROUNDED · THE SKY WON"); return; }
        }
      });

      g.pickups.forEach((pickup, index) => {
        if (!pickup.active || distanceMeters(g.position, pickup) >= 34) return;
        pickup.active = false; pickupMarkerRefs.current[index]?.remove();
        if (pickup.kind === "tip") { g.tips += 25; g.note = "+$25 ROUTE TIP"; tone(880, .07); }
        else { g.boostCharges = Math.min(3, g.boostCharges + 1); g.note = "AFTERBURN CHARGE +1"; tone(440, .07); setTimeout(() => tone(660, .09), 70); }
        g.noteUntil = now + 1500;
      });

      const readyToLand = targetDistance < 90 && actualSpeed < LANDING_SPEED;
      if (landHeldRef.current && readyToLand) g.landingProgress += dt;
      else g.landingProgress = Math.max(0, g.landingProgress - dt * 1.8);
      if (g.landingProgress >= 1.2) { finishLandingAction(now); if (g.mission >= MISSIONS.length) return; }

      if (now - g.lastMap > 32) { g.lastMap = now; map.setView(g.position, map.getZoom(), { animate: false }); }

      if (now - lastHudRef.current > 90) {
        lastHudRef.current = now;
        const liveTarget = currentTarget(g); const liveDistance = distanceMeters(g.position, liveTarget.point);
        const actionLabel = g.phase === "need_load" ? "Hold to load order" : g.phase === "need_reload" ? "Hold to reload" : g.phase === "cake" ? "Hold to collect cake" : "Hold to deliver";
        const signalLost = mission.modifier === "signal" && g.missionActive && Math.floor(now / 2200) % 5 === 0;
        setHud({
          mission: g.mission, phase: g.phase, missionActive: g.missionActive, time: g.time, shiftElapsed: g.shiftElapsed,
          pizzas: g.pizzas, tips: g.tips, integrity: g.integrity,
          combo: g.combo, boostCharges: g.boostCharges, boostActive: g.boostTime > 0,
          speed: actualSpeed * 2.237, heading: g.heading, distance: liveDistance, bearing: bearingDegrees(g.position, liveTarget.point),
          targetLabel: liveTarget.label, actionLabel, readyToLand, landingProgress: g.landingProgress / 1.2,
          note: g.note, noteVisible: now < g.noteUntil, callVisible: now < g.callUntil,
          radioText: g.radioText, radioSpeaker: g.radioSpeaker, radioAvatar: g.radioAvatar,
          chapterVisible: now < g.chapterUntil, signalLost, impact: g.hitCooldown > 1.95,
        });
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [screen, mapReady, paused, bestScore, clearPickups, refreshTarget, spawnPickups, stopMusic, tone]);

  const stickDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    stickRef.current = { active: true, id: event.pointerId, x: 0, y: 0, startX: event.clientX, startY: event.clientY };
  };
  const stickMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const stick = stickRef.current; if (!stick.active || stick.id !== event.pointerId) return;
    const dx = event.clientX - stick.startX; const dy = event.clientY - stick.startY; const magnitude = Math.max(46, Math.hypot(dx, dy));
    stick.x = clamp(dx / magnitude, -1, 1); stick.y = clamp(dy / magnitude, -1, 1);
    setStickVisual({ x: stick.x * 30, y: stick.y * 30 });
  };
  const stickUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (stickRef.current.id !== event.pointerId) return;
    stickRef.current = { active: false, id: -1, x: 0, y: 0, startX: 0, startY: 0 }; setStickVisual({ x: 0, y: 0 });
  };

  const screenSteerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch" && window.innerWidth > 760) return;
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    stickRef.current = { active: true, id: event.pointerId, x: 0, y: 0, startX: event.clientX, startY: event.clientY };
    const dx = event.clientX - window.innerWidth / 2;
    const dy = event.clientY - window.innerHeight * .47;
    const magnitude = Math.hypot(dx, dy);
    const power = clamp((magnitude - 18) / 110, 0, 1);
    stickRef.current.x = magnitude ? dx / magnitude * power : 0;
    stickRef.current.y = magnitude ? dy / magnitude * power : 0;
  };
  const screenSteerMove = (event: React.PointerEvent<HTMLElement>) => {
    const stick = stickRef.current;
    if (!stick.active || stick.id !== event.pointerId || (event.pointerType !== "touch" && window.innerWidth > 760)) return;
    event.preventDefault();
    const dx = event.clientX - window.innerWidth / 2;
    const dy = event.clientY - window.innerHeight * .47;
    const magnitude = Math.hypot(dx, dy);
    const power = clamp((magnitude - 18) / 110, 0, 1);
    stick.x = magnitude ? dx / magnitude * power : 0;
    stick.y = magnitude ? dy / magnitude * power : 0;
  };
  const screenSteerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (stickRef.current.id !== event.pointerId) return;
    stickRef.current = { active: false, id: -1, x: 0, y: 0, startX: 0, startY: 0 };
  };

  const mission = MISSIONS[Math.min(hud.mission, MISSIONS.length - 1)];
  const rank = finalScore >= 1750 ? "S" : finalScore >= 1350 ? "A" : finalScore >= 950 ? "B" : "C";
  const weatherLabel = mission.modifier === "clear" ? "Clear coast" : mission.modifier === "gulls" ? "Gull activity" : mission.modifier === "fog" ? "Fog + crosswind" : mission.modifier === "signal" ? "Redwood interference" : "Night mountain run";
  const radioVoiceLabel = radioVoiceProfile(hud.radioSpeaker).label;

  const playIntro = useCallback(() => {
    const video = introVideoRef.current;
    if (!video) return;
    setIntroError("");
    setIntroStalled(false);
    setIntroStarted(true);
    video.currentTime = 0;
    void video.play().catch(() => {
      setIntroStarted(false);
      setIntroError("The cutscene could not start. Try again or skip to the title.");
    });
  }, []);

  const finishIntro = useCallback(() => {
    if (introStallTimerRef.current) window.clearTimeout(introStallTimerRef.current);
    introVideoRef.current?.pause();
    setScreen("title");
  }, []);

  const watchIntroStall = useCallback(() => {
    const video = introVideoRef.current;
    if (!video || video.ended) return;
    if (introStallTimerRef.current) window.clearTimeout(introStallTimerRef.current);
    const checkpoint = video.currentTime;
    introStallTimerRef.current = window.setTimeout(() => {
      const current = introVideoRef.current;
      if (current && !current.ended && current.currentTime <= checkpoint + .08) {
        current.pause();
        setIntroStalled(true);
      }
    }, 1100);
  }, []);

  const clearIntroStall = useCallback(() => {
    if (introStallTimerRef.current) window.clearTimeout(introStallTimerRef.current);
    setIntroStalled(false);
  }, []);

  const resumeIntro = useCallback(() => {
    const video = introVideoRef.current;
    if (!video) return;
    setIntroStalled(false);
    void video.play().catch(() => setIntroStalled(true));
  }, []);

  const watchBriefingStall = useCallback(() => {
    const video = briefingVideoRef.current;
    if (!video || video.ended) return;
    if (briefingStallTimerRef.current) window.clearTimeout(briefingStallTimerRef.current);
    const checkpoint = video.currentTime;
    briefingStallTimerRef.current = window.setTimeout(() => {
      const current = briefingVideoRef.current;
      if (current && !current.ended && current.currentTime <= checkpoint + .08) {
        current.pause();
        setBriefingStalled(true);
      }
    }, 1100);
  }, []);

  const clearBriefingStall = useCallback(() => {
    if (briefingStallTimerRef.current) window.clearTimeout(briefingStallTimerRef.current);
    setBriefingStalled(false);
  }, []);

  const resumeBriefing = useCallback(() => {
    const video = briefingVideoRef.current;
    if (!video) return;
    setBriefingStalled(false);
    void video.play().catch(() => setBriefingStalled(true));
  }, []);

  return (
    <main className="game-shell">
      {screen === "intro" && (
        <section className={`intro-screen ${introStarted ? "is-playing" : ""}`} aria-label="Opening cutscene">
          <div className="intro-backdrop" aria-hidden="true" />
          <video ref={introVideoRef} className="intro-video" src="assets/mark-intro-cutscene.mp4" poster="assets/mark-intro-poster.webp" playsInline preload="metadata" onPlaying={clearIntroStall} onWaiting={watchIntroStall} onStalled={watchIntroStall} onEnded={finishIntro} onError={() => { setIntroStarted(false); setIntroError("The cutscene did not load. Skip to the title or reload the page."); }} aria-label="Joby Pizza opening cutscene" />
          <div className="intro-grade" aria-hidden="true" />
          {!introStarted && <div className="intro-start"><button className="intro-play" type="button" onClick={playIntro}><small>JOBY PIZZA PRESENTS</small><b>▶ PLAY INTRO</b><span>10 seconds · sound on</span></button>{introError && <p role="alert">{introError}</p>}</div>}
          {introStarted && introStalled && <div className="video-recovery"><b>VIDEO PAUSED</b><span>Your phone stopped the stream.</span><button type="button" onClick={resumeIntro}>▶ Resume intro</button><button type="button" className="recovery-skip" onClick={finishIntro}>Skip to title</button></div>}
          <button className="intro-skip" type="button" onClick={finishIntro}>{introStarted ? "Skip cutscene" : "Skip to title"}</button>
        </section>
      )}

      {screen === "title" && (
        <section className="title-screen" aria-label="Santa Cruz Pizza Delivery 2 title screen">
          <div className="title-art" aria-hidden="true" /><div className="scanlines" aria-hidden="true" /><div className="title-vignette" aria-hidden="true" />
          <header className="title-lockup"><p className="eyebrow">A <span>JOBY PIZZA</span> ORIGINAL GAME</p><img className="title-brand-logo" src="assets/joby-pizza-logo.webp" alt="Joby Pizza Delivery Services" /><h1><span>Santa Cruz</span><strong>Birthday Airlift</strong><em>II</em></h1><p className="subtitle">Five impossible pizzas. Fifteen airborne hazards. One suspicious cake.</p></header>
          <div className="title-actions"><button className="start-button" type="button" onClick={() => setScreen("briefing")}>Clock in, Mark</button><p className="control-hint">REAL SANTA CRUZ · 535 MPH ARCADE FLIGHT · FULL STORY CAMPAIGN</p></div>
          <div className="title-badges"><span>WASD / ARROWS TO FLY</span><span>E TO LAND</span><span>SPACE TO BOOST</span><span>AI VOICE CAST</span></div>
          <button className="replay-intro" type="button" onClick={() => { setIntroStarted(false); setScreen("intro"); }}>↺ Replay intro</button>
        </section>
      )}

      {screen === "briefing" && (
        <section className="briefing-overlay" role="dialog" aria-modal="true" aria-labelledby="briefing-title">
          <div className="briefing-card"><div className="call-status"><img src="assets/joby-wing-mark.webp" alt="" /><span className="live-dot" /> Incoming video · JoBen · Dispatch HQ</div><div className="briefing-grid">
            <div className="boss-frame"><video ref={briefingVideoRef} className="boss-video" src="assets/joben-intro.mp4" poster="assets/joben-intro-poster.webp" autoPlay playsInline controls preload="metadata" onLoadedData={() => { const video = briefingVideoRef.current; if (video && video.paused) void video.play().catch(() => setBriefingStalled(true)); }} onPlaying={clearBriefingStall} onWaiting={watchBriefingStall} onStalled={watchBriefingStall} onError={() => setBriefingStalled(true)} aria-label="JoBen gives Mark the delivery briefing" /><span className="feed-label">LIVE JOBY DISPATCH // 10 SEC</span>{briefingStalled && <div className="video-recovery briefing-recovery"><b>CALL PAUSED</b><button type="button" onClick={resumeBriefing}>▶ Resume JoBen</button></div>}</div>
            <div className="briefing-copy"><p className="kicker">Previously, at the worst delivery company in Santa Cruz</p><h2 id="briefing-title">JoBen promised a normal shift.</h2>
              <p>JoBen is lying. Five callers are already on the radio. The last order is marked <b>NOT A BIRTHDAY SURPRISE</b>, which is how you know it is absolutely a birthday surprise.</p>
              <p className="mobile-briefing-summary">Fly fast. Dodge gulls. Brake under 72 mph, enter the yellow zone and hold LAND.</p>
              <div className="objective-row"><span>01</span><p><b>Fly like you stole it.</b> Cruise past 535 mph. Pizza Afterburn clears 850.</p></div>
              <div className="objective-row"><span>02</span><p><b>Own the airspace.</b> Dodge gulls, organized gull mobs and rogue delivery drones.</p></div>
              <div className="objective-row"><span>03</span><p><b>Bring the pizza home.</b> Brake below 72 mph, enter the yellow zone and hold LAND.</p></div>
              <button className="accept-button" type="button" onClick={startGame}>Answer Paige’s call</button>
            </div>
          </div></div>
        </section>
      )}

      {screen === "playing" && (
        <section className={`real-game modifier-${mission.modifier} ${hud.boostActive ? "is-boosting" : ""} ${hud.impact ? "impact" : ""}`} aria-label="Real-map Santa Cruz pizza delivery game" onPointerDownCapture={screenSteerDown} onPointerMoveCapture={screenSteerMove} onPointerUpCapture={screenSteerUp} onPointerCancelCapture={screenSteerUp}>
          <div ref={mapContainerRef} className="leaflet-game-map" aria-label="OpenStreetMap of Santa Cruz centered on Mark’s aircraft" />
          <div className="map-grade" aria-hidden="true" /><div className="weather-layer" aria-hidden="true" /><div className="game-scanlines" aria-hidden="true" />
          <div className={`speed-lines ${hud.speed > 220 ? "show" : ""}`} style={{ opacity: clamp((hud.speed - 180) / 180, 0, .88) }} aria-hidden="true">{Array.from({ length: 16 }, (_, index) => <i key={index} />)}</div>
          <div className={`contrail left ${hud.speed > 260 ? "show" : ""}`} style={{ transform: `rotate(${hud.heading}deg)` }} aria-hidden="true" /><div className={`contrail right ${hud.speed > 260 ? "show" : ""}`} style={{ transform: `rotate(${hud.heading}deg)` }} aria-hidden="true" />
          <div className={`aircraft-center ${hud.boostActive ? "boosting" : ""}`} style={{ transform: `translate(-50%, -50%) rotate(${hud.heading - 45}deg)` }}><img src="assets/player-evtol-joby-v2.webp" alt="Mark’s Joby Pizza delivery aircraft" /></div>

          <div className={`chapter-card ${hud.chapterVisible ? "show" : ""}`} aria-live="polite"><small>DELIVERY {hud.mission + 1} · {mission.episode}</small><b>{mission.headline}</b><span>{mission.place}</span></div>
          <div className={`speed-readout ${hud.boostActive ? "hot" : ""}`}><b>{Math.round(hud.speed)}</b><span>MPH</span><i>{hud.boostActive ? "AFTERBURN" : hud.speed > 360 ? "FULL SEND" : hud.speed > 80 ? "CRUISE" : "VTOL"}</i></div>

          {tileStatus === "loading" && <div className="map-status">Loading the real Santa Cruz map…</div>}
          {tileStatus === "error" && <div className="map-status error">Map tiles failed to load. Reconnect to continue with the real map.</div>}

          <header className="flight-topbar">
            <div className="mission-number"><small>DELIVERY</small><b>{hud.mission + 1}<i>/5</i></b></div>
            <div className="mission-order"><span>{mission.emoji}</span><div><small>{mission.caller} · {mission.pizzas} PIZZA{mission.pizzas > 1 ? "S" : ""}</small><b>{mission.place}</b><em>{weatherLabel}</em></div></div>
            <div className={`order-clock ${hud.time < 20 && hud.missionActive ? "danger" : ""}`}><small>{hud.missionActive ? "ORDER TIME" : "RETURN LEG"}</small><b>{hud.missionActive ? formatTime(hud.time) : "—:—"}</b></div>
          </header>

          <aside className="flight-stats">
            <img className="hud-brand-mark" src="assets/joby-wing-mark.webp" alt="Joby Pizza" />
            <div><small>AIRFRAME</small><b>{[0,1,2].map((n) => <i key={n} className={n < hud.integrity ? "full" : ""}>◆</i>)}</b></div>
            <div><small>CARGO</small><b>{hud.pizzas ? "🍕".repeat(hud.pizzas) : "EMPTY"}</b></div>
            <div><small>TIPS</small><b>${hud.tips}</b></div>
            <div><small>STREAK</small><b>×{Math.max(1, hud.combo + 1)}</b></div><div><small>SHIFT</small><b>{formatTime(hud.shiftElapsed)}</b></div>
          </aside>

          <aside className={`navigation-card ${hud.signalLost ? "signal-lost" : ""}`}>
            <div className="compass-ring"><span style={{ transform: `rotate(${hud.bearing}deg)` }}>▲</span></div>
            <div><small>{hud.signalLost ? "SIGNAL LOST" : "NEXT TARGET"}</small><b>{hud.signalLost ? "REDWOODS BLOCKING NAV" : hud.targetLabel}</b><em>{hud.signalLost ? "Hold course" : `${formatDistance(hud.distance)} · ${Math.round(hud.speed)} mph`}</em></div>
          </aside>

          <div className={`incoming-order ${hud.callVisible ? "show" : ""}`} aria-live="polite"><div className="radio-portrait"><img src={hud.radioAvatar} alt="" /></div><div className="radio-copy"><small><i /> LIVE · {hud.radioSpeaker}<b className="voice-badge">🔊 AI VOICE · {radioVoiceLabel}</b></small><p>{hud.radioText}</p><span className="radio-wave">▂▅▃▇▂▆▃▅▂▇▃▆</span></div></div>
          <div className={`flight-toast ${hud.noteVisible ? "show" : ""}`} role="status" aria-live="polite">{hud.note}</div>
          <div className="mobile-steer-hint" aria-hidden="true">PRESS + HOLD ANYWHERE TO STEER</div>

          <div className="route-ribbon">{MISSIONS.map((item, index) => <span key={item.place} className={index < hud.mission ? "done" : index === hud.mission ? "active" : ""}><i>{index + 1}</i><b>{item.short}</b></span>)}</div>

          <div className="flight-controls">
            <div className="touch-stick" onPointerDown={stickDown} onPointerMove={stickMove} onPointerUp={stickUp} onPointerCancel={stickUp} aria-label="Drag to steer"><span style={{ transform: `translate(${stickVisual.x}px, ${stickVisual.y}px)` }} /></div>
            <div className="action-cluster">
              <button className="boost-control" type="button" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); activateBoost(); }} onClick={activateBoost} disabled={!hud.boostCharges || hud.boostActive}><small>SPACE · 850 MPH</small><b>⚡ PIZZA AFTERBURN ×{hud.boostCharges}</b></button>
              <button className={`land-control ${hud.readyToLand ? "ready" : ""}`} type="button" onPointerDown={() => { landHeldRef.current = true; }} onPointerUp={() => { landHeldRef.current = false; }} onPointerCancel={() => { landHeldRef.current = false; }} onPointerLeave={() => { landHeldRef.current = false; }} disabled={!hud.readyToLand}>
                <span className="land-progress" style={{ transform: `scaleX(${hud.landingProgress})` }} /><small>{hud.readyToLand ? "HOLD E / HOLD BUTTON" : hud.distance > 90 ? "ENTER YELLOW ZONE" : "BRAKE BELOW 72 MPH"}</small><b>{hud.actionLabel}</b>
              </button>
            </div>
          </div>

          <div className="game-tools"><button type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? "Turn sound on" : "Mute sound"}>{muted ? "🔇" : "🔊"}</button><button type="button" onClick={() => setPaused(true)} aria-label="Pause game">Ⅱ</button></div>
          {paused && <div className="pause-overlay"><div><p>SHIFT PAUSED</p><h2>The map will be here.</h2><button className="accept-button" type="button" onClick={() => setPaused(false)}>Resume flight</button></div></div>}
        </section>
      )}

      {(screen === "won" || screen === "lost") && (
        <section className={`end-screen ${screen}`}><div className="end-art" aria-hidden="true" /><div className="end-card">
          <img className="end-logo" src="assets/joby-pizza-logo.webp" alt="Joby Pizza Delivery Services" />
          {screen === "won" ? <><img className="end-cake" src="assets/birthday-pizza-cake.webp" alt="Birthday pizza cake" /><div className="victory-cast" aria-label="Everyone from Mark’s birthday shift">{MISSIONS.map((item) => <img key={item.caller} src={item.portrait} alt={item.caller} />)}</div></> : <img className="end-boss" src="assets/job-en-boss.webp" alt="JoBen on a video call" />}
          <p className="kicker">{screen === "won" ? "ALL FIVE REAL-WORLD DELIVERIES COMPLETE" : "SHIFT FAILED"}</p><h2>{screen === "won" ? "Happy Birthday, Mark." : "Mark. The route won."}</h2>
          <p>{screen === "won" ? `Every caller patched through at once. Nobody coordinated this. Everybody coordinated this. Santa Cruz crossed, cake intact, birthday rescued in ${formatTime(hud.shiftElapsed)}.` : "JoBen has moved your name into a red spreadsheet cell. Fortunately, the aircraft is still warm."}</p>
          <div className="score-line"><span>RANK <b>{screen === "won" ? rank : "F"}</b></span><span>SCORE <b>{finalScore}</b></span><span>BEST <b>{bestScore}</b></span></div>
          <button className="start-button" type="button" onClick={startGame}>{screen === "won" ? "Fly another shift" : "Restart from Front Street"}</button>
        </div></section>
      )}
    </main>
  );
}
