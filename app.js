const G = 9.80665;
const MAX_SAMPLES = 36000;
const DRAW_WINDOW_MS = 60000;
const LOG_INTERVAL_MS = 100;
const EVENT_COOLDOWN_MS = 1400;
const GPS_STALE_MS = 3500;
const GPS_DELTA_MAX_ACCURACY_M = 35;
const GPS_MAX_REASONABLE_ACCEL = 8;

const els = {
  recordButton: document.querySelector("#recordButton"),
  recordButtonText: document.querySelector("#recordButtonText"),
  permissionButton: document.querySelector("#permissionButton"),
  markerButton: document.querySelector("#markerButton"),
  demoButton: document.querySelector("#demoButton"),
  exportCsvButton: document.querySelector("#exportCsvButton"),
  exportJsonButton: document.querySelector("#exportJsonButton"),
  clearButton: document.querySelector("#clearButton"),
  recordingBadge: document.querySelector("#recordingBadge"),
  elapsedValue: document.querySelector("#elapsedValue"),
  speedValue: document.querySelector("#speedValue"),
  speedSourceValue: document.querySelector("#speedSourceValue"),
  sampleValue: document.querySelector("#sampleValue"),
  gpsValue: document.querySelector("#gpsValue"),
  gpsCoordValue: document.querySelector("#gpsCoordValue"),
  accuracyValue: document.querySelector("#accuracyValue"),
  eventBadge: document.querySelector("#eventBadge"),
  eventCount: document.querySelector("#eventCount"),
  eventList: document.querySelector("#eventList"),
  sampleRows: document.querySelector("#sampleRows"),
  lastSampleTime: document.querySelector("#lastSampleTime"),
  motionDot: document.querySelector("#motionDot"),
  longitudinalValue: document.querySelector("#longitudinalValue"),
  lateralValue: document.querySelector("#lateralValue"),
  verticalValue: document.querySelector("#verticalValue"),
  mountDirection: document.querySelector("#mountDirection"),
  staticCalibrateButton: document.querySelector("#staticCalibrateButton"),
  forwardCalibrateButton: document.querySelector("#forwardCalibrateButton"),
  calibrationState: document.querySelector("#calibrationState"),
  gravityQuality: document.querySelector("#gravityQuality"),
  forwardQuality: document.querySelector("#forwardQuality"),
  noiseValue: document.querySelector("#noiseValue"),
  pitchValue: document.querySelector("#pitchValue"),
  rollValue: document.querySelector("#rollValue"),
  headingOffsetValue: document.querySelector("#headingOffsetValue"),
  calibrationHint: document.querySelector("#calibrationHint"),
  accelGauge: document.querySelector("#accelGauge"),
  miniMap: document.querySelector("#miniMap"),
  trendChart: document.querySelector("#trendChart")
};

const state = {
  recording: false,
  sensorsEnabled: false,
  geolocationId: null,
  startedAt: 0,
  elapsedBeforePause: 0,
  lastLogAt: 0,
  lastMotionAt: 0,
  lastGpsAt: 0,
  lastEventAt: new Map(),
  lastEventLabel: "无事件",
  samples: [],
  events: [],
  track: [],
  raw: {
    linear: [0, 0, 0],
    gravity: [0, 0, G],
    speed: null,
    lat: null,
    lon: null,
    accuracy: null,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speedSource: "waiting",
    gpsSpeedRaw: null,
    gpsTimestamp: null
  },
  gps: {
    speedFiltered: null,
    speedSource: "waiting",
    speedRaw: null
  },
  vehicle: {
    longitudinal: 0,
    lateral: 0,
    vertical: 0,
    total: 0,
    longFiltered: 0,
    latFiltered: 0
  },
  calibration: {
    gravity: [0, 0, 1],
    forward: [0, 1, 0],
    lateral: [1, 0, 0],
    vertical: [0, 0, 1],
    bias: [0, 0, 0],
    noise: null,
    pitch: null,
    roll: null,
    headingOffset: null,
    staticReady: false,
    forwardReady: false,
    forwardQuality: 0
  },
  staticCal: null,
  forwardCal: null,
  previousPosition: null,
  lastSpeedSample: null
};

let demoTimer = null;
let demoStartedWithSensors = false;

const eventDefs = {
  brake: { label: "急刹车", className: "brake", threshold: -3.0 },
  accel: { label: "急加速", className: "accel", threshold: 2.3 },
  turn: { label: "急转向", className: "turn", threshold: 3.2 },
  manual: { label: "人工标记", className: "manual", threshold: 0 }
};

function now() {
  return performance.now();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mul(a, scalar) {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function magnitude(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a, fallback = [0, 0, 1]) {
  const size = magnitude(a);
  if (size < 0.0001) return fallback.slice();
  return [a[0] / size, a[1] / size, a[2] / size];
}

function projectToPlane(vector, normal) {
  return sub(vector, mul(normal, dot(vector, normal)));
}

function vectorFromMotion(part) {
  if (!part) return null;
  const x = Number.isFinite(part.x) ? part.x : 0;
  const y = Number.isFinite(part.y) ? part.y : 0;
  const z = Number.isFinite(part.z) ? part.z : 0;
  return [x, y, z];
}

function mountDirectionVector() {
  switch (els.mountDirection.value) {
    case "right":
      return [1, 0, 0];
    case "bottom":
      return [0, -1, 0];
    case "left":
      return [-1, 0, 0];
    case "top":
    default:
      return [0, 1, 0];
  }
}

function rebuildAxes(forwardSeed = mountDirectionVector()) {
  const vertical = normalize(state.calibration.gravity, [0, 0, 1]);
  const flatForward = projectToPlane(forwardSeed, vertical);
  const forward = normalize(flatForward, normalize(projectToPlane(mountDirectionVector(), vertical), [0, 1, 0]));
  const lateral = normalize(cross(forward, vertical), [1, 0, 0]);
  state.calibration.forward = forward;
  state.calibration.lateral = lateral;
  state.calibration.vertical = vertical;
  updateCalibrationAngles();
}

function updateCalibrationAngles() {
  if (!state.calibration.staticReady) {
    state.calibration.pitch = null;
    state.calibration.roll = null;
    state.calibration.headingOffset = null;
    return;
  }

  const gravity = normalize(state.calibration.gravity, [0, 0, 1]);
  state.calibration.pitch = (Math.atan2(-gravity[1], Math.hypot(gravity[0], gravity[2])) * 180) / Math.PI;
  state.calibration.roll = (Math.atan2(gravity[0], gravity[2]) * 180) / Math.PI;

  const vertical = state.calibration.vertical;
  const baseForward = normalize(projectToPlane(mountDirectionVector(), vertical), state.calibration.forward);
  const signed =
    (Math.atan2(dot(cross(baseForward, state.calibration.forward), vertical), dot(baseForward, state.calibration.forward)) *
      180) /
    Math.PI;
  state.calibration.headingOffset = signed;
}

function formatDuration(ms) {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function elapsedMs() {
  if (state.recording) return state.elapsedBeforePause + now() - state.startedAt;
  return state.elapsedBeforePause;
}

function kmh(ms) {
  return ms * 3.6;
}

function formatSpeed(speed) {
  return Number.isFinite(speed) ? `${kmh(speed).toFixed(1)} km/h` : "-- km/h";
}

function formatSpeedSource(source) {
  switch (source) {
    case "gps":
      return "手机 GPS 速度";
    case "gps_delta":
      return "GPS 坐标差分";
    case "gps_stationary":
      return "GPS 静止过滤";
    case "demo":
      return "演示数据";
    case "waiting":
      return "等待 GPS";
    default:
      return "GPS测速";
  }
}

function formatCoord(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "--, --";
  return `${lat.toFixed(8)}, ${lon.toFixed(8)}`;
}

function formatAngle(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}°` : "--";
}

function formatG(ms2) {
  return `${(ms2 / G).toFixed(2)} g`;
}

function formatClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

async function requestMotionPermission() {
  if (
    typeof DeviceMotionEvent !== "undefined" &&
    typeof DeviceMotionEvent.requestPermission === "function"
  ) {
    const result = await DeviceMotionEvent.requestPermission();
    if (result !== "granted") throw new Error("motion-denied");
  }
}

async function enableSensors() {
  if (state.sensorsEnabled) return;
  await requestMotionPermission();
  window.addEventListener("devicemotion", handleMotion, { passive: true });
  startGeolocation();
  state.sensorsEnabled = true;
  els.permissionButton.textContent = "已授权";
  els.permissionButton.disabled = true;
  updateStatus();
}

async function ensureSensorsEnabled() {
  try {
    await enableSensors();
    return true;
  } catch (error) {
    els.permissionButton.textContent = "授权失败";
    els.calibrationHint.textContent = "传感器授权未完成，请在手机浏览器里允许运动与位置权限。";
    return false;
  }
}

function startGeolocation() {
  if (!("geolocation" in navigator) || state.geolocationId !== null) return;

  state.geolocationId = navigator.geolocation.watchPosition(handlePosition, handlePositionError, {
    enableHighAccuracy: true,
    maximumAge: 250,
    timeout: 12000
  });
}

function handleMotion(event) {
  const timestamp = Date.now();
  const motionTime = now();
  state.lastMotionAt = motionTime;

  const includingGravity = vectorFromMotion(event.accelerationIncludingGravity);
  let linear = vectorFromMotion(event.acceleration);

  if (includingGravity) {
    state.raw.gravity = [
      state.raw.gravity[0] * 0.92 + includingGravity[0] * 0.08,
      state.raw.gravity[1] * 0.92 + includingGravity[1] * 0.08,
      state.raw.gravity[2] * 0.92 + includingGravity[2] * 0.08
    ];
  }

  if (!linear && includingGravity) {
    linear = sub(includingGravity, state.raw.gravity);
  }
  if (!linear) linear = [0, 0, 0];

  state.raw.linear = linear;
  collectStaticCalibration(linear, includingGravity);
  collectForwardCalibration(linear);

  const corrected = sub(linear, state.calibration.bias);
  const longitudinal = dot(corrected, state.calibration.forward);
  const lateral = dot(corrected, state.calibration.lateral);
  const vertical = dot(corrected, state.calibration.vertical);
  state.vehicle.longitudinal = longitudinal;
  state.vehicle.lateral = lateral;
  state.vehicle.vertical = vertical;
  state.vehicle.total = magnitude([longitudinal, lateral, vertical]);
  state.vehicle.longFiltered = state.vehicle.longFiltered * 0.7 + longitudinal * 0.3;
  state.vehicle.latFiltered = state.vehicle.latFiltered * 0.72 + lateral * 0.28;

  detectEvents(timestamp);
  logSample(timestamp, motionTime);
}

function handlePosition(position) {
  const { latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed } = position.coords;
  const timestamp = position.timestamp || Date.now();
  const current = {
    lat: latitude,
    lon: longitude,
    accuracy,
    altitude: Number.isFinite(altitude) ? altitude : null,
    altitudeAccuracy: Number.isFinite(altitudeAccuracy) ? altitudeAccuracy : null,
    heading: Number.isFinite(heading) ? heading : null,
    timestamp,
    gpsSpeed: Number.isFinite(speed) && speed >= 0 ? speed : null,
    speed: null,
    speedSource: "waiting"
  };

  updateGpsSpeed(current);

  state.raw.lat = latitude;
  state.raw.lon = longitude;
  state.raw.accuracy = accuracy;
  state.raw.altitude = current.altitude;
  state.raw.altitudeAccuracy = current.altitudeAccuracy;
  state.raw.heading = current.heading;
  state.raw.speed = current.speed;
  state.raw.speedSource = current.speedSource;
  state.raw.gpsSpeedRaw = current.gpsSpeedRaw;
  state.raw.gpsTimestamp = timestamp;
  state.lastGpsAt = now();

  if (state.recording) {
    state.track.push({
      lat: latitude,
      lon: longitude,
      timestamp,
      speed: current.speed,
      speedSource: current.speedSource,
      gpsSpeed: current.gpsSpeedRaw,
      accuracy,
      altitude: current.altitude,
      altitudeAccuracy: current.altitudeAccuracy,
      heading: current.heading
    });
    if (state.track.length > 5000) state.track.shift();
  }

  updateSpeedDerivative(current);
  state.previousPosition = current;
}

function handlePositionError(error) {
  els.gpsValue.textContent = error.code === 1 ? "被拒绝" : "不可用";
}

function ingestDemoFrame(frame) {
  const timestamp = Date.now();
  const motionTime = now();
  state.sensorsEnabled = true;
  state.lastMotionAt = motionTime;
  state.lastGpsAt = motionTime;
  state.raw.linear = frame.linear;
  state.raw.speed = frame.speed;
  state.raw.lat = frame.lat;
  state.raw.lon = frame.lon;
  state.raw.accuracy = frame.accuracy;
  state.raw.altitude = null;
  state.raw.altitudeAccuracy = null;
  state.raw.heading = null;
  state.raw.speedSource = "demo";
  state.raw.gpsSpeedRaw = frame.speed;
  state.raw.gpsTimestamp = timestamp;
  state.gps.speedFiltered = frame.speed;
  state.gps.speedSource = "demo";
  state.gps.speedRaw = frame.speed;

  const corrected = sub(frame.linear, state.calibration.bias);
  const longitudinal = dot(corrected, state.calibration.forward);
  const lateral = dot(corrected, state.calibration.lateral);
  const vertical = dot(corrected, state.calibration.vertical);
  state.vehicle.longitudinal = longitudinal;
  state.vehicle.lateral = lateral;
  state.vehicle.vertical = vertical;
  state.vehicle.total = magnitude([longitudinal, lateral, vertical]);
  state.vehicle.longFiltered = state.vehicle.longFiltered * 0.7 + longitudinal * 0.3;
  state.vehicle.latFiltered = state.vehicle.latFiltered * 0.72 + lateral * 0.28;

  if (state.recording) {
    state.track.push({
      lat: frame.lat,
      lon: frame.lon,
      timestamp,
      speed: frame.speed,
      speedSource: "demo",
      gpsSpeed: frame.speed,
      accuracy: frame.accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null
    });
  }

  detectEvents(timestamp);
  logSample(timestamp, motionTime);
}

function distanceMeters(a, b) {
  const radius = 6371000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function updateGpsSpeed(sample) {
  let measuredSpeed = sample.gpsSpeed;
  let source = Number.isFinite(measuredSpeed) ? "gps" : "waiting";

  if (!Number.isFinite(measuredSpeed) && state.previousPosition) {
    const dt = (sample.timestamp - state.previousPosition.timestamp) / 1000;
    const accuracyOk =
      Number.isFinite(sample.accuracy) &&
      Number.isFinite(state.previousPosition.accuracy) &&
      sample.accuracy <= GPS_DELTA_MAX_ACCURACY_M &&
      state.previousPosition.accuracy <= GPS_DELTA_MAX_ACCURACY_M;

    if (dt >= 0.5 && dt <= 10 && accuracyOk) {
      const meters = distanceMeters(state.previousPosition, sample);
      const noiseFloor = clamp((sample.accuracy + state.previousPosition.accuracy) * 0.22, 2.2, 12);
      if (meters <= noiseFloor) {
        measuredSpeed = 0;
        source = "gps_stationary";
      } else {
        measuredSpeed = (meters - noiseFloor) / dt;
        source = "gps_delta";
      }
    }
  }

  if (Number.isFinite(measuredSpeed) && Number.isFinite(state.gps.speedFiltered)) {
    const dt = state.previousPosition ? (sample.timestamp - state.previousPosition.timestamp) / 1000 : 1;
    if (dt > 0) {
      const delta = measuredSpeed - state.gps.speedFiltered;
      const maxDelta = GPS_MAX_REASONABLE_ACCEL * dt;
      measuredSpeed = state.gps.speedFiltered + clamp(delta, -maxDelta, maxDelta);
    }
  }

  if (Number.isFinite(measuredSpeed)) {
    const alpha = source === "gps" ? 0.45 : 0.28;
    state.gps.speedFiltered = Number.isFinite(state.gps.speedFiltered)
      ? state.gps.speedFiltered * (1 - alpha) + measuredSpeed * alpha
      : measuredSpeed;
    if (state.gps.speedFiltered < 0.25 && source !== "gps") state.gps.speedFiltered = 0;
  }

  state.gps.speedRaw = Number.isFinite(sample.gpsSpeed) ? sample.gpsSpeed : measuredSpeed;
  state.gps.speedSource = source;
  sample.gpsSpeedRaw = state.gps.speedRaw;
  sample.speed = Number.isFinite(state.gps.speedFiltered) ? state.gps.speedFiltered : null;
  sample.speedSource = source;
}

function updateSpeedDerivative(sample) {
  if (!Number.isFinite(sample.speed)) return;
  if (state.lastSpeedSample) {
    const dt = (sample.timestamp - state.lastSpeedSample.timestamp) / 1000;
    if (dt > 0.4 && dt < 8) {
      sample.speedDelta = (sample.speed - state.lastSpeedSample.speed) / dt;
    }
  }
  state.lastSpeedSample = sample;
}

function collectStaticCalibration(linear, includingGravity) {
  if (!state.staticCal) return;
  const bucket = state.staticCal;
  bucket.linear.push(linear);
  if (includingGravity) bucket.gravity.push(includingGravity);

  if (now() - bucket.startedAt < bucket.duration) {
    const pct = Math.round(((now() - bucket.startedAt) / bucket.duration) * 100);
    els.calibrationHint.textContent = `静止校准 ${clamp(pct, 0, 100)}%`;
    return;
  }

  const bias = averageVector(bucket.linear);
  const gravity = averageVector(bucket.gravity.length ? bucket.gravity : [state.raw.gravity]);
  const noise = bucket.linear.reduce((sum, vector) => sum + magnitude(sub(vector, bias)), 0) / bucket.linear.length;

  state.calibration.bias = bias;
  state.calibration.gravity = normalize(gravity, [0, 0, 1]);
  state.calibration.noise = noise;
  state.calibration.staticReady = true;
  state.staticCal = null;
  rebuildAxes();
  els.calibrationHint.textContent = "静止校准完成，可继续直线校准。";
  updateCalibrationStatus();
}

function collectForwardCalibration(linear) {
  if (!state.forwardCal) return;
  const bucket = state.forwardCal;
  const speedSample = state.lastSpeedSample;
  const speedDelta = speedSample?.speedDelta;

  if (Number.isFinite(speedDelta) && Math.abs(speedDelta) > 0.18) {
    const corrected = sub(linear, state.calibration.bias);
    const flat = projectToPlane(corrected, state.calibration.vertical);
    const amount = magnitude(flat);
    if (amount > 0.12) {
      bucket.vectors.push(mul(normalize(flat), Math.sign(speedDelta) * Math.min(2.5, Math.abs(speedDelta))));
    }
  }

  if (now() - bucket.startedAt < bucket.duration) {
    const pct = Math.round(((now() - bucket.startedAt) / bucket.duration) * 100);
    els.calibrationHint.textContent = `直线校准 ${clamp(pct, 0, 100)}%`;
    return;
  }

  if (bucket.vectors.length >= 8) {
    const forward = normalize(averageVector(bucket.vectors), state.calibration.forward);
    rebuildAxes(forward);
    state.calibration.forwardReady = true;
    state.calibration.forwardQuality = clamp(bucket.vectors.length / 40, 0.2, 1);
    els.calibrationHint.textContent = "直线校准完成，前后方向已按车速变化修正。";
  } else {
    state.calibration.forwardReady = false;
    state.calibration.forwardQuality = 0;
    els.calibrationHint.textContent = "直线校准样本不足，当前使用手机朝向设置。";
  }

  state.forwardCal = null;
  updateCalibrationStatus();
}

function averageVector(vectors) {
  if (!vectors.length) return [0, 0, 0];
  const total = vectors.reduce((sum, vector) => add(sum, vector), [0, 0, 0]);
  return mul(total, 1 / vectors.length);
}

function startStaticCalibration() {
  state.staticCal = {
    startedAt: now(),
    duration: 2600,
    linear: [],
    gravity: []
  };
  els.calibrationHint.textContent = "静止校准 0%";
}

function startForwardCalibration() {
  state.forwardCal = {
    startedAt: now(),
    duration: 9000,
    vectors: []
  };
  els.calibrationHint.textContent = "直线校准 0%";
}

function startRecording() {
  state.recording = true;
  state.startedAt = now();
  state.lastLogAt = 0;
  state.samples = [];
  state.events = [];
  state.track = [];
  state.lastEventAt.clear();
  state.lastEventLabel = "无事件";
  els.recordButton.classList.add("recording");
  els.recordButtonText.textContent = "停止记录";
  els.recordingBadge.classList.add("recording");
  els.recordingBadge.textContent = "记录中";
  updateEvents();
}

function stopRecording() {
  state.elapsedBeforePause = elapsedMs();
  state.recording = false;
  els.recordButton.classList.remove("recording");
  els.recordButtonText.textContent = "继续记录";
  els.recordingBadge.classList.remove("recording");
  els.recordingBadge.textContent = "已暂停";
}

async function toggleRecording() {
  if (!state.sensorsEnabled && !(await ensureSensorsEnabled())) return;

  if (state.recording) {
    stopRecording();
  } else {
    if (state.elapsedBeforePause > 0 && state.samples.length) {
      state.startedAt = now();
      state.recording = true;
      els.recordButton.classList.add("recording");
      els.recordButtonText.textContent = "停止记录";
      els.recordingBadge.classList.add("recording");
      els.recordingBadge.textContent = "记录中";
    } else {
      state.elapsedBeforePause = 0;
      startRecording();
    }
  }
}

function logSample(timestamp, motionTime) {
  if (!state.recording) return;
  if (motionTime - state.lastLogAt < LOG_INTERVAL_MS) return;
  state.lastLogAt = motionTime;

  const sample = {
    timestamp,
    elapsedMs: elapsedMs(),
    rawX: state.raw.linear[0],
    rawY: state.raw.linear[1],
    rawZ: state.raw.linear[2],
    longitudinal: state.vehicle.longitudinal,
    lateral: state.vehicle.lateral,
    vertical: state.vehicle.vertical,
    total: state.vehicle.total,
    speed: state.raw.speed,
    speedSource: state.raw.speedSource,
    gpsSpeedRaw: state.raw.gpsSpeedRaw,
    lat: state.raw.lat,
    lon: state.raw.lon,
    accuracy: state.raw.accuracy,
    altitude: state.raw.altitude,
    altitudeAccuracy: state.raw.altitudeAccuracy,
    heading: state.raw.heading,
    gpsTimestamp: state.raw.gpsTimestamp
  };

  state.samples.push(sample);
  if (state.samples.length > MAX_SAMPLES) state.samples.shift();
}

function detectEvents(timestamp) {
  if (!state.recording) return;

  const long = state.vehicle.longFiltered;
  const lat = state.vehicle.latFiltered;
  if (long <= eventDefs.brake.threshold) {
    addEvent("brake", Math.abs(long), timestamp);
  } else if (long >= eventDefs.accel.threshold) {
    addEvent("accel", long, timestamp);
  }

  if (Math.abs(lat) >= eventDefs.turn.threshold) {
    addEvent("turn", Math.abs(lat), timestamp);
  }
}

function addEvent(type, intensity = 0, timestamp = Date.now()) {
  if (type !== "manual") {
    const last = state.lastEventAt.get(type) || 0;
    if (timestamp - last < EVENT_COOLDOWN_MS) return;
    state.lastEventAt.set(type, timestamp);
  }

  const def = eventDefs[type];
  const event = {
    id: `${timestamp}-${type}-${state.events.length}`,
    type,
    label: def.label,
    className: def.className,
    timestamp,
    elapsedMs: elapsedMs(),
    intensity,
    speed: state.raw.speed,
    speedSource: state.raw.speedSource,
    lat: state.raw.lat,
    lon: state.raw.lon
  };
  state.events.unshift(event);
  state.lastEventLabel = def.label;
  updateEvents();
}

function updateEvents() {
  els.eventCount.textContent = String(state.events.length);
  els.eventBadge.textContent = state.lastEventLabel;

  if (!state.events.length) {
    els.eventList.innerHTML = '<div class="event-empty">暂无事件</div>';
    return;
  }

  els.eventList.innerHTML = state.events
    .slice(0, 28)
    .map((event) => {
      const intensity = event.type === "manual" ? "标记" : `${(event.intensity / G).toFixed(2)} g`;
      return `
        <div class="event-row ${event.className}">
          <div>
            <strong>${event.label}</strong>
            <span>${formatDuration(event.elapsedMs)} · ${formatSpeed(event.speed)}</span>
          </div>
          <span>${intensity}</span>
        </div>
      `;
    })
    .join("");
}

function updateStatus() {
  const elapsed = elapsedMs();
  const gpsAge = now() - state.lastGpsAt;
  const gpsOnline = gpsAge < GPS_STALE_MS && Number.isFinite(state.raw.lat) && Number.isFinite(state.raw.lon);
  els.elapsedValue.textContent = formatDuration(elapsed);
  els.speedValue.textContent = formatSpeed(state.raw.speed);
  els.speedSourceValue.textContent = formatSpeedSource(state.raw.speedSource);
  els.sampleValue.textContent = String(state.samples.length);
  els.gpsValue.textContent = gpsOnline ? "已定位" : "等待";
  els.gpsValue.classList.toggle("gps-lock", gpsOnline);
  els.gpsValue.classList.toggle("gps-waiting", !gpsOnline);
  els.gpsCoordValue.textContent = formatCoord(state.raw.lat, state.raw.lon);
  els.accuracyValue.textContent = Number.isFinite(state.raw.accuracy)
    ? `±${Math.round(state.raw.accuracy)} m`
    : "-- m";
  els.longitudinalValue.textContent = formatG(state.vehicle.longitudinal);
  els.lateralValue.textContent = formatG(state.vehicle.lateral);
  els.verticalValue.textContent = formatG(state.vehicle.vertical);
  els.lastSampleTime.textContent = state.samples.length
    ? formatClock(state.samples[state.samples.length - 1].timestamp)
    : "--";

  els.motionDot.classList.toggle("live", now() - state.lastMotionAt < 1500);
  els.motionDot.classList.toggle("warning", state.sensorsEnabled && now() - state.lastMotionAt >= 1500);

  updateSamplesTable();
  updateCalibrationStatus();
}

function updateCalibrationStatus() {
  const cal = state.calibration;
  const gravityText = cal.staticReady ? "已完成" : "未完成";
  const forwardText = cal.forwardReady ? `${Math.round(cal.forwardQuality * 100)}%` : "手动朝向";
  els.gravityQuality.textContent = gravityText;
  els.forwardQuality.textContent = forwardText;
  els.noiseValue.textContent = Number.isFinite(cal.noise) ? `${cal.noise.toFixed(2)} m/s²` : "--";
  els.pitchValue.textContent = formatAngle(cal.pitch);
  els.rollValue.textContent = formatAngle(cal.roll);
  els.headingOffsetValue.textContent = formatAngle(cal.headingOffset);

  if (cal.staticReady && cal.forwardReady) {
    els.calibrationState.textContent = "双重校准";
  } else if (cal.staticReady) {
    els.calibrationState.textContent = "静止校准";
  } else {
    els.calibrationState.textContent = "未校准";
  }
}

function updateSamplesTable() {
  const rows = state.samples.slice(-7).reverse();
  els.sampleRows.innerHTML = rows
    .map(
      (sample) => `
        <div class="table-row" role="row">
          <span role="cell">${formatDuration(sample.elapsedMs)}</span>
          <span role="cell">${formatSpeed(sample.speed)}</span>
          <span role="cell">${formatG(sample.longitudinal)}</span>
          <span role="cell">${formatG(sample.lateral)}</span>
        </div>
      `
    )
    .join("");
}

function resizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function drawGauge() {
  const { ctx, width, height } = resizeCanvas(els.accelGauge);
  const size = Math.min(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const radius = size * 0.42;
  const longG = state.vehicle.longitudinal / G;
  const latG = state.vehicle.lateral / G;
  const dotX = cx + clamp(latG, -1.2, 1.2) * (radius / 1.2);
  const dotY = cy - clamp(longG, -1.2, 1.2) * (radius / 1.2);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f8faf9";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#d5dfdc";
  ctx.lineWidth = 1;
  [0.33, 0.66, 1].forEach((ring) => {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * ring, 0, Math.PI * 2);
    ctx.stroke();
  });

  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  ctx.fillStyle = "#6a737b";
  ctx.font = "700 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("前", cx, cy - radius - 10);
  ctx.fillText("后", cx, cy + radius + 18);
  ctx.textAlign = "left";
  ctx.fillText("左", cx - radius - 22, cy + 4);
  ctx.textAlign = "right";
  ctx.fillText("右", cx + radius + 22, cy + 4);

  const intensity = Math.hypot(longG, latG);
  ctx.beginPath();
  ctx.arc(dotX, dotY, 13 + clamp(intensity, 0, 1.2) * 7, 0, Math.PI * 2);
  ctx.fillStyle = longG < -0.25 ? "#dc2626" : longG > 0.22 ? "#15803d" : "#0f766e";
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(255,255,255,0.86)";
  ctx.stroke();

  ctx.fillStyle = "#22292f";
  ctx.font = "800 28px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${intensity.toFixed(2)} g`, cx, cy + 10);
}

function drawMap() {
  const { ctx, width, height } = resizeCanvas(els.miniMap);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f8faf9";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#e1e8e6";
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const points = state.track.length ? state.track : state.raw.lat ? [state.raw] : [];
  const valid = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));

  if (!valid.length) {
    ctx.fillStyle = "#6a737b";
    ctx.font = "800 16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("等待定位", width / 2, height / 2);
    return;
  }

  const lats = valid.map((point) => point.lat);
  const lons = valid.map((point) => point.lon);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLon = Math.min(...lons);
  let maxLon = Math.max(...lons);
  if (Math.abs(maxLat - minLat) < 0.00003) {
    minLat -= 0.00003;
    maxLat += 0.00003;
  }
  if (Math.abs(maxLon - minLon) < 0.00003) {
    minLon -= 0.00003;
    maxLon += 0.00003;
  }

  const pad = 28;
  const project = (point) => {
    const x = pad + ((point.lon - minLon) / (maxLon - minLon)) * (width - pad * 2);
    const y = height - pad - ((point.lat - minLat) / (maxLat - minLat)) * (height - pad * 2);
    return [x, y];
  };

  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  valid.forEach((point, index) => {
    const [x, y] = project(point);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const current = valid[valid.length - 1];
  const [cx, cy] = project(current);
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fillStyle = "#dc2626";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.88)";
  ctx.stroke();
}

function drawTrend() {
  const { ctx, width, height } = resizeCanvas(els.trendChart);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f8faf9";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#e1e8e6";
  ctx.lineWidth = 1;
  for (let y = 34; y < height; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const cutoff = elapsedMs() - DRAW_WINDOW_MS;
  const samples = state.samples.filter((sample) => sample.elapsedMs >= cutoff);
  if (samples.length < 2) {
    ctx.fillStyle = "#6a737b";
    ctx.font = "800 16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("等待采样", width / 2, height / 2);
    return;
  }

  const minElapsed = samples[0].elapsedMs;
  const maxElapsed = Math.max(samples[samples.length - 1].elapsedMs, minElapsed + 1000);
  const xFor = (sample) => ((sample.elapsedMs - minElapsed) / (maxElapsed - minElapsed)) * width;
  const speedMax = Math.max(18, ...samples.map((sample) => Number.isFinite(sample.speed) ? kmh(sample.speed) : 0));
  const accelMax = 6;

  drawLine(ctx, samples, xFor, (sample) => height - ((Number.isFinite(sample.speed) ? kmh(sample.speed) : 0) / speedMax) * (height - 26) - 13, "#2563eb", 2.5);
  drawLine(ctx, samples, xFor, (sample) => height / 2 - (sample.longitudinal / accelMax) * (height * 0.38), "#0f766e", 2.5);

  ctx.fillStyle = "#2563eb";
  ctx.fillRect(14, 13, 18, 4);
  ctx.fillStyle = "#0f766e";
  ctx.fillRect(94, 13, 18, 4);
  ctx.fillStyle = "#45505a";
  ctx.font = "700 12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("速度", 38, 18);
  ctx.fillText("纵向加速度", 118, 18);
}

function drawLine(ctx, samples, xFor, yFor, color, width) {
  ctx.beginPath();
  samples.forEach((sample, index) => {
    const x = xFor(sample);
    const y = yFor(sample);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function exportCsv() {
  if (!state.samples.length) return;
  const header = [
    "timestamp",
    "elapsed_ms",
    "speed_mps",
    "speed_source",
    "gps_speed_raw_mps",
    "gps_timestamp",
    "lat",
    "lon",
    "accuracy_m",
    "altitude_m",
    "altitude_accuracy_m",
    "heading_deg",
    "raw_x",
    "raw_y",
    "raw_z",
    "longitudinal_mps2",
    "lateral_mps2",
    "vertical_mps2",
    "total_mps2"
  ];
  const rows = state.samples.map((sample) =>
    [
      new Date(sample.timestamp).toISOString(),
      Math.round(sample.elapsedMs),
      numberCell(sample.speed),
      sample.speedSource || "",
      numberCell(sample.gpsSpeedRaw),
      sample.gpsTimestamp ? new Date(sample.gpsTimestamp).toISOString() : "",
      numberCell(sample.lat, 8),
      numberCell(sample.lon, 8),
      numberCell(sample.accuracy, 2),
      numberCell(sample.altitude, 2),
      numberCell(sample.altitudeAccuracy, 2),
      numberCell(sample.heading, 2),
      numberCell(sample.rawX),
      numberCell(sample.rawY),
      numberCell(sample.rawZ),
      numberCell(sample.longitudinal),
      numberCell(sample.lateral),
      numberCell(sample.vertical),
      numberCell(sample.total)
    ].join(",")
  );
  downloadFile(`adas-session-${fileStamp()}.csv`, [header.join(","), ...rows].join("\n"), "text/csv");
}

function exportJson() {
  const payload = {
    schema: "adas-recorder-session-v2",
    exportedAt: new Date().toISOString(),
    app: {
      name: "智驾测试记录仪",
      purpose: "mobile-capture-for-hud-video"
    },
    calibration: state.calibration,
    samples: state.samples,
    events: state.events.slice().reverse(),
    track: state.track
  };
  downloadFile(`adas-session-${fileStamp()}.json`, JSON.stringify(payload, null, 2), "application/json");
}

function numberCell(value, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : "";
}

function fileStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function clearData() {
  stopDemo();
  state.recording = false;
  state.samples = [];
  state.events = [];
  state.track = [];
  state.elapsedBeforePause = 0;
  state.lastEventAt.clear();
  state.lastEventLabel = "无事件";
  els.recordButton.classList.remove("recording");
  els.recordButtonText.textContent = "开始记录";
  els.recordingBadge.classList.remove("recording");
  els.recordingBadge.textContent = "待机";
  updateEvents();
  updateStatus();
}

function startDemo() {
  if (demoTimer) return;
  if (!state.recording) startRecording();
  demoStartedWithSensors = state.sensorsEnabled;
  state.sensorsEnabled = true;
  els.permissionButton.textContent = "演示数据";
  els.permissionButton.disabled = true;
  els.demoButton.textContent = "停止演示";

  const origin = {
    lat: 31.2304,
    lon: 121.4737,
    speed: 0,
    heading: -0.8,
    distance: 0,
    startedAt: now()
  };

  demoTimer = window.setInterval(() => {
    const t = (now() - origin.startedAt) / 1000;
    let accel = Math.sin(t * 0.8) * 0.45;
    if (t % 18 > 5 && t % 18 < 6.2) accel = 3.0;
    if (t % 24 > 12 && t % 24 < 13.2) accel = -4.0;
    const lateral = t % 20 > 14 && t % 20 < 15.4 ? 3.7 : Math.sin(t * 0.45) * 0.55;
    origin.speed = clamp(origin.speed + accel * 0.1, 0, 26);
    origin.heading += lateral * 0.0008;
    origin.distance += origin.speed * 0.1;
    const north = Math.cos(origin.heading) * origin.distance;
    const east = Math.sin(origin.heading) * origin.distance;
    const lat = origin.lat + north / 111111;
    const lon = origin.lon + east / (111111 * Math.cos((origin.lat * Math.PI) / 180));
    ingestDemoFrame({
      linear: [lateral, accel, Math.sin(t * 1.6) * 0.12],
      speed: origin.speed,
      lat,
      lon,
      accuracy: 5 + Math.abs(Math.sin(t)) * 3
    });
  }, LOG_INTERVAL_MS);
}

function stopDemo() {
  if (!demoTimer) return;
  window.clearInterval(demoTimer);
  demoTimer = null;
  els.demoButton.textContent = "演示";
  if (demoStartedWithSensors) {
    els.permissionButton.textContent = "已授权";
    els.permissionButton.disabled = true;
  } else {
    state.sensorsEnabled = false;
    els.permissionButton.textContent = "授权传感器";
    els.permissionButton.disabled = false;
  }
}

function toggleDemo() {
  if (demoTimer) stopDemo();
  else startDemo();
}

function renderLoop() {
  updateStatus();
  drawGauge();
  drawMap();
  drawTrend();
  requestAnimationFrame(renderLoop);
}

els.permissionButton.addEventListener("click", ensureSensorsEnabled);
els.recordButton.addEventListener("click", toggleRecording);
els.markerButton.addEventListener("click", () => addEvent("manual", 0));
els.demoButton.addEventListener("click", toggleDemo);
els.exportCsvButton.addEventListener("click", exportCsv);
els.exportJsonButton.addEventListener("click", exportJson);
els.clearButton.addEventListener("click", clearData);
els.staticCalibrateButton.addEventListener("click", async () => {
  if (await ensureSensorsEnabled()) startStaticCalibration();
});
els.forwardCalibrateButton.addEventListener("click", async () => {
  if (await ensureSensorsEnabled()) startForwardCalibration();
});
els.mountDirection.addEventListener("change", () => {
  rebuildAxes();
  state.calibration.forwardReady = false;
  state.calibration.forwardQuality = 0;
  updateCalibrationStatus();
});

rebuildAxes();
updateEvents();
renderLoop();
