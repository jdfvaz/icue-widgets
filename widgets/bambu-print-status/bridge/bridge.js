#!/usr/bin/env node
/*
 * Bambu Lab -> XENEON EDGE bridge
 *
 * iCUE widgets run in a browser engine, which cannot open the MQTT-over-TLS
 * connection Bambu printers use. This small service does that part: it talks
 * to the printer on your LAN (read-only) and serves a compact JSON status at
 * http://localhost:<port>/status for the widget to poll.
 *
 *   node bridge.js          connect to the printer in config.json
 *   node bridge.js --demo   simulate a print (no printer needed)
 *   add --log               also write to bridge.log (used when running in the background)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const VERSION = '1.1.0';
const DEMO = process.argv.includes('--demo');
const LOG_FILE = process.argv.includes('--log') ? path.join(__dirname, 'bridge.log') : null;
const LOG_MAX_BYTES = 1024 * 1024; // rotate to bridge.log.1 at 1 MB
const PUSHALL_EVERY_MS = 5 * 60 * 1000; // OpenBambuAPI: no more often than 5 min (P1P lag)
const STALE_AFTER_MS = 90 * 1000;

// ---------------------------------------------------------------- config ---

function loadConfig() {
  const file = path.join(__dirname, 'config.json');
  let cfg = {};
  if (fs.existsSync(file)) {
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      fail(`config.json is not valid JSON: ${err.message}`);
    }
  }
  cfg.printerIp = process.env.BAMBU_IP || cfg.printerIp;
  cfg.serial = (process.env.BAMBU_SERIAL || cfg.serial || '').trim().toUpperCase();
  cfg.accessCode = String(process.env.BAMBU_ACCESS_CODE || cfg.accessCode || '').trim();
  cfg.printerName = process.env.BAMBU_NAME || cfg.printerName || 'Bambu Lab';
  cfg.port = Number(process.env.BRIDGE_PORT || cfg.port || 8765);

  if (!DEMO) {
    const missing = ['printerIp', 'serial', 'accessCode'].filter((k) => !cfg[k] || /^(x+|0+)$/i.test(cfg[k]));
    if (!fs.existsSync(file) && missing.length) {
      fail('config.json not found. Copy config.example.json to config.json and fill in your printer details.\n' +
           'Or run "node bridge.js --demo" to test the widget without a printer.');
    }
    if (missing.length) fail(`config.json is missing: ${missing.join(', ')}`);
  }
  return cfg;
}

function fail(msg) {
  console.error(`\n[bridge] ${msg}\n`);
  writeLogFile(`ERROR ${msg}`);
  process.exit(1);
}

function writeLogFile(line) {
  if (!LOG_FILE) return;
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > LOG_MAX_BYTES) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* logging must never take the bridge down */
  }
}

const cfg = loadConfig();

// ----------------------------------------------------------------- state ---

let raw = {};              // merged printer report (pushall snapshot + deltas)
let connected = false;
let lastMessageAt = 0;
let lastError = null;
let lastState = null;
let finishedAt = null;

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// P1/A1 printers send a full snapshot after "pushall", then only changed
// fields. Objects are merged recursively; arrays (AMS trays etc.) are replaced.
function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (isObj(v) && isObj(target[k])) deepMerge(target[k], v);
    else target[k] = v;
  }
  return target;
}

function jobIdentity(p) {
  return p ? [p.subtask_id, p.task_id, p.gcode_file].filter(Boolean).join('|') : '';
}

function applyReport(msg) {
  if (!isObj(msg)) return;
  const before = jobIdentity(raw.print);
  deepMerge(raw, msg);
  const p = raw.print || {};
  const incoming = msg.print || {};

  // A new job keeps the previous job's 100% until fresh progress arrives.
  const after = jobIdentity(p);
  if (before && after && before !== after) {
    if (!('mc_percent' in incoming)) p.mc_percent = 0;
    if (!('layer_num' in incoming)) p.layer_num = 0;
  }

  if (p.gcode_state !== lastState) {
    if (p.gcode_state === 'FINISH' || p.gcode_state === 'FAILED') {
      finishedAt = lastState ? new Date() : null; // unknown if we started mid-way
    } else if (p.gcode_state !== 'IDLE') {
      finishedAt = null;
    }
    if (lastState !== null || p.gcode_state) log(`state ${lastState || '-'} -> ${p.gcode_state || '-'}`);
    lastState = p.gcode_state || null;
  }
  lastMessageAt = Date.now();
}

// --------------------------------------------------------------- summary ---

// Printer "stg_cur" values (community-documented, matches ha-bambulab).
const STAGES = {
  1: 'Auto bed leveling', 2: 'Heating bed', 3: 'Vibration compensation',
  4: 'Changing filament', 5: 'Paused', 6: 'Filament ran out', 7: 'Heating nozzle',
  8: 'Calibrating extrusion', 9: 'Scanning bed surface', 10: 'Inspecting first layer',
  11: 'Identifying build plate', 12: 'Calibrating lidar', 13: 'Homing toolhead',
  14: 'Cleaning nozzle tip', 15: 'Checking nozzle temperature', 16: 'Paused by user',
  17: 'Front cover fell off', 18: 'Calibrating lidar', 19: 'Calibrating flow',
  20: 'Nozzle temperature fault', 21: 'Bed temperature fault', 22: 'Unloading filament',
  23: 'Skipped steps detected', 24: 'Loading filament', 25: 'Calibrating motor noise',
  26: 'AMS disconnected', 27: 'Heatbreak fan too slow', 28: 'Chamber temperature fault',
  29: 'Cooling chamber', 30: 'Paused by G-code', 31: 'Motor noise check',
  32: 'Nozzle covered in filament', 33: 'Cutter error', 34: 'First layer error',
  35: 'Nozzle clog detected',
};

const SPEEDS = { 1: 'Silent', 2: 'Standard', 3: 'Sport', 4: 'Ludicrous' };

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanJobName(p) {
  const name = p.subtask_name || p.gcode_file || '';
  return String(name).split(/[\\/]/).pop().replace(/\.(gcode|3mf)$/gi, '').replace(/\.gcode$/i, '') || null;
}

function nozzleTemps(p) {
  let current = num(p.nozzle_temper);
  let target = num(p.nozzle_target_temper);
  // Best effort for dual-nozzle models (H2D/H2S), which pack temps per extruder:
  // temp = (target << 16) | current
  const info = p.device && p.device.extruder && p.device.extruder.info;
  if (current === null && Array.isArray(info) && info.length) {
    const decoded = info
      .map((e) => num(e && e.temp))
      .filter((t) => t !== null)
      .map((t) => ({ current: t & 0xffff, target: (t >> 16) & 0xffff }));
    if (decoded.length) {
      decoded.sort((a, b) => b.target - a.target || b.current - a.current);
      ({ current, target } = decoded[0]);
    }
  }
  return { current, target };
}

function activeFilament(p) {
  const ams = p.ams || {};
  const now = num(ams.tray_now);
  if (now === null || now === 255) return null;
  let tray = null;
  if (now === 254) {
    tray = p.vt_tray || null; // external spool
  } else if (Array.isArray(ams.ams)) {
    const amsId = now >= 128 ? now : Math.floor(now / 4); // 128+ = single-slot AMS HT
    const trayId = now >= 128 ? 0 : now % 4;
    const unit = ams.ams.find((u) => num(u && u.id) === amsId);
    tray = unit && Array.isArray(unit.tray) ? unit.tray.find((t) => num(t && t.id) === trayId) : null;
  }
  if (!tray || (!tray.tray_type && !tray.tray_color)) return null;
  const hex = typeof tray.tray_color === 'string' && /^[0-9a-f]{6}/i.test(tray.tray_color)
    ? `#${tray.tray_color.slice(0, 6).toUpperCase()}` : null;
  return { type: tray.tray_type || null, color: hex };
}

function errorCode(v) {
  const n = num(v);
  if (!n) return null;
  const hex = (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

function summarize() {
  const p = raw.print || {};
  const state = p.gcode_state || null;
  const remainingMin = num(p.mc_remaining_time);
  const stageId = num(p.stg_cur);
  const stale = connected && lastMessageAt > 0 && Date.now() - lastMessageAt > STALE_AFTER_MS;

  return {
    bridge: { version: VERSION, demo: DEMO },
    printer: {
      name: cfg.printerName,
      connected,
      stale,
      lastUpdate: lastMessageAt ? new Date(lastMessageAt).toISOString() : null,
      error: connected ? null : lastError,
    },
    job: {
      state,
      stage: stageId && STAGES[stageId] ? STAGES[stageId] : null,
      name: cleanJobName(p),
      percent: num(p.mc_percent),
      remainingMin,
      finishAt: state === 'RUNNING' && remainingMin !== null
        ? new Date(Date.now() + remainingMin * 60000).toISOString() : null,
      finishedAt: finishedAt ? finishedAt.toISOString() : null,
      layer: num(p.layer_num),
      totalLayers: num(p.total_layer_num),
      speed: SPEEDS[num(p.spd_lvl)] || null,
      errorCode: state === 'FAILED' || state === 'PAUSE' ? errorCode(p.print_error) : null,
    },
    temps: {
      nozzle: nozzleTemps(p),
      bed: { current: num(p.bed_temper), target: num(p.bed_target_temper) },
    },
    filament: activeFilament(p),
  };
}

// ------------------------------------------------------------------ mqtt ---

function startPrinterConnection() {
  let mqtt;
  try {
    mqtt = require('mqtt');
  } catch {
    fail('The "mqtt" package is missing. Run "npm install" in this folder first.');
  }

  const url = `mqtts://${cfg.printerIp}:8883`;
  const reportTopic = `device/${cfg.serial}/report`;
  const requestTopic = `device/${cfg.serial}/request`;
  let seq = 0;

  log(`connecting to ${cfg.printerIp} (serial ${cfg.serial})...`);
  const client = mqtt.connect(url, {
    username: 'bblp',
    password: cfg.accessCode,
    clientId: `xeneon-bridge-${Math.random().toString(16).slice(2, 10)}`,
    rejectUnauthorized: false, // printers use a self-signed certificate
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    keepalive: 30,
    protocolVersion: 4,
  });

  const pushAll = () => {
    if (!client.connected) return;
    client.publish(requestTopic, JSON.stringify({
      pushing: { sequence_id: String(seq++), command: 'pushall', version: 1, push_target: 1 },
    }));
  };

  client.on('connect', () => {
    connected = true;
    lastError = null;
    log('connected to printer');
    client.subscribe(reportTopic, (err) => {
      if (err) {
        lastError = `Subscribe failed: ${err.message}. Check the serial number in config.json.`;
        log(lastError);
      } else {
        pushAll();
      }
    });
  });

  client.on('message', (_topic, buf) => {
    try {
      applyReport(JSON.parse(buf.toString('utf8')));
    } catch {
      /* ignore malformed frames */
    }
  });

  client.on('close', () => {
    if (connected) log('connection closed, retrying...');
    connected = false;
  });

  client.on('error', (err) => {
    lastError = friendlyError(err);
    log(lastError);
  });

  setInterval(pushAll, PUSHALL_EVERY_MS);
}

function friendlyError(err) {
  const msg = String((err && err.message) || err);
  const code = err && err.code;
  if (code === 5 || /not authorized|bad user name or password/i.test(msg)) {
    return 'The printer rejected the access code. Check accessCode in config.json (it changes when LAN mode is toggled).';
  }
  if (['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND'].includes(code) || /timeout/i.test(msg)) {
    return `Can't reach the printer at ${cfg.printerIp}:8883. Check the IP and that the PC and printer are on the same network.`;
  }
  return `Printer connection error: ${msg}`;
}

// ------------------------------------------------------------------ demo ---

function startDemo() {
  connected = true;
  const total = 100; // minutes the fake job "takes"
  const phases = [
    ['PREPARE', 12], ['RUNNING', 70], ['PAUSE', 8], ['RUNNING', 70], ['FINISH', 20], ['IDLE', 10],
  ];
  const cycle = phases.reduce((s, [, d]) => s + d, 0);
  const runSeconds = 140;

  const tick = () => {
    const t = Math.floor(Date.now() / 1000) % cycle;
    let acc = 0;
    let state = 'IDLE';
    let into = 0;
    let runDone = 0;
    for (const [s, d] of phases) {
      if (t < acc + d) { state = s; into = t - acc; break; }
      if (s === 'RUNNING') runDone += d;
      acc += d;
    }
    const pct = state === 'RUNNING' ? Math.min(99, Math.round(((runDone + into) / runSeconds) * 100))
      : state === 'PAUSE' ? 50 : state === 'FINISH' ? 100 : 0;

    applyReport({
      print: {
        gcode_state: state,
        subtask_id: 'demo',
        subtask_name: state === 'IDLE' ? '' : 'Articulated dragon - plate 2',
        mc_percent: pct,
        mc_remaining_time: state === 'FINISH' || state === 'IDLE' ? 0 : Math.round(total * (1 - pct / 100)),
        layer_num: Math.round(pct * 2.36),
        total_layer_num: state === 'IDLE' ? 0 : 236,
        stg_cur: state === 'PREPARE' ? (into < 6 ? 2 : 1) : state === 'PAUSE' ? 6 : state === 'IDLE' ? 255 : 0,
        spd_lvl: 2,
        print_error: 0,
        nozzle_temper: state === 'PREPARE' ? 140 + into * 6 : state === 'RUNNING' || state === 'PAUSE' ? 220 : 38,
        nozzle_target_temper: state === 'RUNNING' || state === 'PREPARE' || state === 'PAUSE' ? 220 : 0,
        bed_temper: state === 'PREPARE' ? 35 + into * 2 : state === 'IDLE' ? 27 : 55,
        bed_target_temper: state === 'IDLE' || state === 'FINISH' ? 0 : 55,
        ams: {
          tray_now: state === 'IDLE' ? '255' : '1',
          ams: [{ id: '0', tray: [
            { id: '0', tray_type: 'PLA', tray_color: 'F2F2F2FF' },
            { id: '1', tray_type: 'PLA', tray_color: 'FF6A13FF' },
          ] }],
        },
      },
    });
  };
  tick();
  setInterval(tick, 1000);
  log('demo mode: simulating a print (no printer contacted)');
}

// ------------------------------------------------------------------ http ---

function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const route = (req.url || '/').split('?')[0];
  if (route === '/status') return sendJson(res, 200, summarize());
  if (route === '/raw') return sendJson(res, 200, raw); // debugging: full merged report
  if (route === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(`Bambu bridge ${VERSION} is running.\nWidget endpoint: /status\nDebug: /raw\n`);
  }
  sendJson(res, 404, { error: 'Not found. Use /status' });
}

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

// Listen on loopback only (IPv4 and IPv6) so "localhost" works either way
// and nothing is exposed to the rest of the network.
function listen() {
  const v4 = http.createServer(handler);
  v4.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      fail(`Port ${cfg.port} is already in use. Is the bridge already running? Change "port" in config.json if needed (and in the widget settings).`);
    }
    fail(`HTTP server error: ${err.message}`);
  });
  v4.listen(cfg.port, '127.0.0.1', () => {
    log(`serving http://localhost:${cfg.port}/status`);
  });

  const v6 = http.createServer(handler);
  v6.on('error', () => { /* no IPv6 loopback available: IPv4 is enough */ });
  v6.listen({ port: cfg.port, host: '::1', ipv6Only: true });
}

function log(msg) {
  const t = new Date().toLocaleTimeString();
  console.log(`[${t}] ${msg}`);
  writeLogFile(msg);
}

// ------------------------------------------------------------------ main ---

if (require.main === module) {
  process.on('uncaughtException', (err) => {
    // Log and exit non-zero so the background task restarts the bridge.
    log(`crashed: ${(err && err.stack) || err}`);
    process.exit(1);
  });
  log(`bridge ${VERSION} starting${DEMO ? ' (demo)' : ''}`);
  listen();
  if (DEMO) startDemo();
  else startPrinterConnection();
}

module.exports = { applyReport, summarize, deepMerge, errorCode, _state: () => raw };
