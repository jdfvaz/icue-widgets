/* Bambu Print Status - iCUE widget for XENEON EDGE
 * Polls the local bridge (bridge/bridge.js) and renders the print state. */
(function () {
  'use strict';

  var DEFAULTS = {
    printerLabel: '',
    bridgeUrl: 'http://localhost:8765',
    refreshSeconds: 3,
    showTemperatures: true,
    theme: 'classic',
    backdrop: 'auto',
    progressStyle: 'auto',
    fontStyle: 'technical',
    glowAmount: 40,
    backgroundOpacity: 100,
    animations: true,
    celebrate: true,
    backgroundColor: '#1b1035',
    backgroundColor2: '#3a1060',
    textColor: '#fff4e8',
    accentColor: '#ffcc00',
    progressColor: '#00e0b8'
  };

  // bg/bg2: background, text, accent: build plate + glow, progress: theme progress color.
  // textGlow scales how much the Glow slider lights up text (0 keeps Classic crisp).
  var THEMES = {
    classic:   { bg: '#20252b', bg2: '#2b323b', text: '#ede7dd', accent: '#c9a15a', progress: '#c9a15a', backdrop: 'solid',    progress_style: 'filament', textGlow: 0 },
    neon:      { bg: '#100a2c', bg2: '#2a0b52', text: '#f6f0ff', accent: '#ff2bd6', progress: '#1fe5ff', backdrop: 'glow',     progress_style: 'gradient', textGlow: 1, ok: '#5cffb0', warn: '#ffd23f', bad: '#ff4d6d' },
    synthwave: { bg: '#1a0a33', bg2: '#5a1468', text: '#ffeaf7', accent: '#ff8a1c', progress: '#ff3d9a', backdrop: 'grid',     progress_style: 'gradient', textGlow: 1, ok: '#4dffd2', warn: '#ffd23f', bad: '#ff5470' },
    disco:     { bg: '#150c24', bg2: '#2c1147', text: '#ffffff', accent: '#ffd84d', progress: '#ff4fd8', backdrop: 'glow',     progress_style: 'rainbow',  textGlow: 1, ok: '#6dff9e', warn: '#ffd84d', bad: '#ff5a5a' },
    lava:      { bg: '#260804', bg2: '#5c1607', text: '#fff0dc', accent: '#ffb703', progress: '#ff5400', backdrop: 'glow',     progress_style: 'gradient', textGlow: 0.8, ok: '#b7f06a', warn: '#ffd166', bad: '#ff8fa3' },
    aurora:    { bg: '#03182a', bg2: '#0a4a60', text: '#e8fcff', accent: '#4ef0c4', progress: '#8a7dff', backdrop: 'glow',     progress_style: 'gradient', textGlow: 0.8, ok: '#4ef0c4', warn: '#ffcf5c', bad: '#ff6b8b' },
    bubblegum: { bg: '#ffd8ee', bg2: '#c6eeff', text: '#3a1044', accent: '#8a2be2', progress: '#ff3d9e', backdrop: 'gradient', progress_style: 'gradient', textGlow: 0.4, ok: '#16804a', warn: '#a85d00', bad: '#c0153a' }
  };
  var STATUS_DEFAULTS = { ok: '#8cc48b', warn: '#f0a43c', bad: '#ef6b57' };
  var BACKDROPS = ['solid', 'gradient', 'glow', 'grid'];
  var PROGRESS_STYLES = ['filament', 'theme', 'gradient', 'rainbow'];
  var FONTS = ['technical', 'clean', 'chunky', 'handwritten', 'code'];

  // The printer reports a job you cancelled as FAILED with this code.
  var CANCELLED_CODE = '0300-400C';
  var KEEP_LAST_DATA_MS = 10 * 60 * 1000; // show last known data this long if the bridge disappears

  var settings = Object.assign({}, DEFAULTS);
  var look = { theme: THEMES.classic, progressStyle: 'filament' };
  var lastData = null;
  var lastDataAt = 0;
  var bridgeOk = null; // null = not tried yet
  var timer = null;
  var inFlight = false;
  var polling = false;
  var prevCls = null;

  function $(id) { return document.getElementById(id); }

  // iCUE exposes each control as a global variable (and some versions also pass
  // them in the event payload). Read the globals defensively.
  function readGlobals() {
    var g = {};
    try { if (typeof printerLabel !== 'undefined') g.printerLabel = printerLabel; } catch (e) {}
    try { if (typeof bridgeUrl !== 'undefined') g.bridgeUrl = bridgeUrl; } catch (e) {}
    try { if (typeof refreshSeconds !== 'undefined') g.refreshSeconds = refreshSeconds; } catch (e) {}
    try { if (typeof showTemperatures !== 'undefined') g.showTemperatures = showTemperatures; } catch (e) {}
    try { if (typeof theme !== 'undefined') g.theme = theme; } catch (e) {}
    try { if (typeof backdrop !== 'undefined') g.backdrop = backdrop; } catch (e) {}
    try { if (typeof progressStyle !== 'undefined') g.progressStyle = progressStyle; } catch (e) {}
    try { if (typeof fontStyle !== 'undefined') g.fontStyle = fontStyle; } catch (e) {}
    try { if (typeof glowAmount !== 'undefined') g.glowAmount = glowAmount; } catch (e) {}
    try { if (typeof backgroundOpacity !== 'undefined') g.backgroundOpacity = backgroundOpacity; } catch (e) {}
    try { if (typeof animations !== 'undefined') g.animations = animations; } catch (e) {}
    try { if (typeof celebrate !== 'undefined') g.celebrate = celebrate; } catch (e) {}
    try { if (typeof backgroundColor !== 'undefined') g.backgroundColor = backgroundColor; } catch (e) {}
    try { if (typeof backgroundColor2 !== 'undefined') g.backgroundColor2 = backgroundColor2; } catch (e) {}
    try { if (typeof textColor !== 'undefined') g.textColor = textColor; } catch (e) {}
    try { if (typeof accentColor !== 'undefined') g.accentColor = accentColor; } catch (e) {}
    try { if (typeof progressColor !== 'undefined') g.progressColor = progressColor; } catch (e) {}
    return g;
  }

  function toBool(v, fallback) {
    if (v === true || v === 'true' || v === 1 || v === '1') return true;
    if (v === false || v === 'false' || v === 0 || v === '0') return false;
    return fallback;
  }

  function clampNum(v, min, max, fallback) {
    var n = Number(v);
    return isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  function pick(v, list, fallback) {
    return list.indexOf(v) >= 0 ? v : fallback;
  }

  function color(v, fallback) {
    return typeof v === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v.trim()) ? v.trim().slice(0, 7) : fallback;
  }

  // "#rrggbb" + alpha -> rgba() string, used for glows
  function rgba(hex, a) {
    var h = color(hex, null);
    if (!h || !(a > 0)) return 'transparent';
    var n = parseInt(h.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + Math.min(1, a).toFixed(3) + ')';
  }

  function applySettings(payloadSettings) {
    var prevUrl = settings.bridgeUrl;
    var prevRefresh = settings.refreshSeconds;
    Object.assign(settings, readGlobals(), payloadSettings || {});

    settings.refreshSeconds = clampNum(settings.refreshSeconds, 2, 60, DEFAULTS.refreshSeconds);
    settings.glowAmount = clampNum(settings.glowAmount, 0, 100, DEFAULTS.glowAmount);
    settings.backgroundOpacity = clampNum(settings.backgroundOpacity, 0, 100, DEFAULTS.backgroundOpacity);
    settings.showTemperatures = toBool(settings.showTemperatures, true);
    settings.animations = toBool(settings.animations, true);
    settings.celebrate = toBool(settings.celebrate, true);

    applyLook();

    if (polling && (prevUrl !== settings.bridgeUrl || prevRefresh !== settings.refreshSeconds)) {
      schedule(0);
    }
    render();
  }

  function applyLook() {
    var t;
    if (settings.theme === 'custom') {
      t = {
        bg: color(settings.backgroundColor, DEFAULTS.backgroundColor),
        bg2: color(settings.backgroundColor2, DEFAULTS.backgroundColor2),
        text: color(settings.textColor, DEFAULTS.textColor),
        accent: color(settings.accentColor, DEFAULTS.accentColor),
        progress: color(settings.progressColor, DEFAULTS.progressColor),
        backdrop: 'gradient',
        progress_style: 'theme',
        textGlow: 1
      };
    } else {
      t = THEMES[settings.theme] || THEMES.classic;
    }
    look.theme = t;
    look.progressStyle = settings.progressStyle === 'auto' ? t.progress_style : pick(settings.progressStyle, PROGRESS_STYLES, t.progress_style);
    var backdropStyle = settings.backdrop === 'auto' ? t.backdrop : pick(settings.backdrop, BACKDROPS, t.backdrop);
    var glow = settings.glowAmount / 100;

    var html = document.documentElement;
    var s = html.style;
    s.setProperty('--bg', t.bg);
    s.setProperty('--bg2', t.bg2);
    s.setProperty('--text', t.text);
    s.setProperty('--accent', t.accent);
    s.setProperty('--progress', t.progress);
    s.setProperty('--ok', t.ok || STATUS_DEFAULTS.ok);
    s.setProperty('--warn', t.warn || STATUS_DEFAULTS.warn);
    s.setProperty('--bad', t.bad || STATUS_DEFAULTS.bad);
    s.setProperty('--glow', String(glow));
    s.setProperty('--glow-accent', rgba(t.accent, glow * 0.8 * (t.textGlow || 0)));
    s.setProperty('--bg-opacity', String(settings.backgroundOpacity / 100));

    html.setAttribute('data-backdrop', backdropStyle);
    html.setAttribute('data-progress', look.progressStyle);
    html.setAttribute('data-font', pick(settings.fontStyle, FONTS, 'technical'));
    html.setAttribute('data-anim', settings.animations ? 'on' : 'off');
  }

  // ------------------------------------------------------------- polling --

  function baseUrl() {
    var url = String(settings.bridgeUrl || DEFAULTS.bridgeUrl).trim();
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    return url.replace(/\/+$/, '');
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(poll, ms);
  }

  function startPolling() {
    if (polling) return;
    polling = true;
    schedule(0);
  }

  function poll() {
    if (inFlight) return;
    inFlight = true;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = setTimeout(function () { if (ctrl) ctrl.abort(); }, 4000);

    fetch(baseUrl() + '/status', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        lastData = data;
        lastDataAt = Date.now();
        bridgeOk = true;
      })
      .catch(function () {
        // Bridge not running, wrong address, or the network permission was denied.
        bridgeOk = false;
      })
      .then(function () {
        clearTimeout(timeout);
        inFlight = false;
        render();
        schedule(settings.refreshSeconds * 1000);
      });
  }

  // ---------------------------------------------------------- formatting --

  function timeParts(min) {
    if (min === null || min === undefined || !isFinite(min)) return null;
    min = Math.max(0, Math.round(min));
    if (min < 1) return [['<1', 'min']];
    if (min < 60) return [[min, 'min']];
    if (min < 1440) {
      var h = Math.floor(min / 60), m = min % 60;
      return m ? [[h, 'h'], [m, 'min']] : [[h, 'h']];
    }
    var d = Math.floor(min / 1440), hh = Math.floor((min % 1440) / 60);
    return hh ? [[d, 'd'], [hh, 'h']] : [[d, 'd']];
  }

  function clock(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var now = new Date();
    if (d.toDateString() === now.toDateString()) return t;
    var tomorrow = new Date(now.getTime());
    tomorrow.setDate(now.getDate() + 1);
    if (d.toDateString() === tomorrow.toDateString()) return 'tomorrow ' + t;
    return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + t;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function fill(node, children) {
    while (node.firstChild) node.removeChild(node.firstChild);
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
  }

  function timeNode(min, suffix) {
    var parts = timeParts(min);
    if (!parts) return null;
    var wrap = el('span', 'time');
    parts.forEach(function (p) {
      wrap.appendChild(el('span', 'time-num', p[0]));
      wrap.appendChild(el('span', 'time-unit', p[1]));
    });
    if (suffix) wrap.appendChild(el('span', 'time-suffix', suffix));
    return wrap;
  }

  function temp(t) {
    if (!t || t.current === null || t.current === undefined) return null;
    var cur = Math.round(t.current);
    var tgt = t.target ? Math.round(t.target) : 0;
    var v = el('span', 'v');
    v.appendChild(document.createTextNode(cur + '\u00B0'));
    if (tgt > 0 && Math.abs(cur - tgt) > 2) v.appendChild(el('span', 'target', ' / ' + tgt + '\u00B0'));
    return v;
  }

  function item(label, valueNode, extraCls) {
    if (!valueNode) return null;
    var n = el('span', 'item' + (extraCls ? ' ' + extraCls : ''));
    n.appendChild(el('span', 'k', label));
    n.appendChild(valueNode);
    return n;
  }

  // ------------------------------------------------------------ confetti --

  function celebrateNow() {
    var layer = $('confettiLayer');
    if (!layer) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !settings.animations) return;
    var t = look.theme;
    var colors = [t.accent, t.progress, t.text, '#ffd84d', '#2ec4ff', '#ff4fd8', '#3ddc84'];
    var fillColor = document.getElementById('app').style.getPropertyValue('--fill');
    if (fillColor) colors.push(fillColor);
    for (var i = 0; i < 80; i++) {
      var bit = el('span', 'bit' + (i % 3 === 0 ? ' round' : ''));
      bit.style.left = (Math.random() * 100).toFixed(2) + '%';
      bit.style.background = colors[i % colors.length];
      bit.style.setProperty('--dx', (Math.random() * 30 - 15).toFixed(1) + 'vw');
      bit.style.setProperty('--rot', Math.round(Math.random() * 1080 - 540) + 'deg');
      bit.style.animationDelay = (Math.random() * 0.9).toFixed(2) + 's';
      bit.style.animationDuration = (2.6 + Math.random() * 2).toFixed(2) + 's';
      layer.appendChild(bit);
    }
    setTimeout(function () { fill(layer, []); }, 6500);
  }

  // ------------------------------------------------------------- render --

  var STATES = {
    RUNNING: { cls: 'is-running', label: 'Printing' },
    PREPARE: { cls: 'is-prepare', label: 'Preparing' },
    SLICING: { cls: 'is-prepare', label: 'Preparing' },
    PAUSE: { cls: 'is-pause', label: 'Paused' },
    FINISH: { cls: 'is-finish', label: 'Finished' },
    FAILED: { cls: 'is-failed', label: 'Failed' },
    IDLE: { cls: 'is-idle', label: 'Idle' }
  };

  function render() {
    var app = $('app');
    if (!app) return;

    var data = lastData;
    var dataAge = Date.now() - lastDataAt;
    var showingOld = bridgeOk === false && data && dataAge < KEEP_LAST_DATA_MS;
    var printer = (data && data.printer) || {};
    var job = (data && data.job) || {};
    var name = String(settings.printerLabel || '').trim() || printer.name || 'Bambu Lab';

    var view = {
      cls: 'is-loading', status: 'Connecting', job: '', main: null, sub: '',
      pct: null, details: [], stale: false
    };

    if (bridgeOk === null) {
      view.main = el('span', 'hero-text', 'Looking for the bridge');
    } else if (bridgeOk === false && !showingOld) {
      view.cls = 'is-offline';
      view.status = 'Offline';
      view.main = el('span', 'hero-text', 'Start the bridge');
      view.sub = 'Run start-bridge.bat on this PC. Looking for it at ' + baseUrl();
    } else if (!printer.connected) {
      view.cls = 'is-offline';
      view.status = 'Offline';
      view.main = el('span', 'hero-text', 'Printer not connected');
      view.sub = printer.error || 'Waiting for the printer to answer.';
    } else {
      var st = STATES[job.state] || { cls: 'is-idle', label: job.state ? String(job.state) : 'Idle' };
      view.cls = st.cls;
      view.status = st.label;
      view.job = job.name || '';

      if (st.cls === 'is-running') {
        view.pct = job.percent;
        view.main = timeNode(job.remainingMin, 'left') || el('span', 'hero-text', 'Printing');
        view.sub = job.finishAt ? 'Done at ' + clock(job.finishAt) : '';
      } else if (st.cls === 'is-prepare') {
        view.pct = job.percent || 0;
        view.main = el('span', 'hero-text', job.stage || 'Getting ready');
        var est = timeParts(job.remainingMin);
        view.sub = est && job.remainingMin > 0 ? 'Print time about ' + est.map(function (p) { return p[0] + ' ' + p[1]; }).join(' ') : '';
      } else if (st.cls === 'is-pause') {
        view.pct = job.percent;
        view.main = timeNode(job.remainingMin, 'left') || el('span', 'hero-text', 'Paused');
        view.sub = (job.stage || 'Paused') + (job.errorCode ? '. Error ' + job.errorCode : '') + '. Resume on the printer.';
      } else if (st.cls === 'is-finish') {
        view.pct = 100;
        view.main = el('span', 'hero-text', 'Ready to remove');
        view.sub = job.finishedAt ? 'Finished at ' + clock(job.finishedAt) : 'The print is done.';
      } else if (st.cls === 'is-failed' && job.errorCode === CANCELLED_CODE) {
        view.cls = 'is-cancelled';
        view.status = 'Cancelled';
        view.pct = job.percent;
        view.main = el('span', 'hero-text', 'Print cancelled');
        view.sub = 'Start a new print to see its progress here.';
      } else if (st.cls === 'is-failed') {
        view.pct = job.percent;
        view.main = el('span', 'hero-text', 'Print failed');
        view.sub = (job.errorCode ? 'Error ' + job.errorCode + '. ' : '') + 'Check the printer screen for details.';
      } else {
        view.job = '';
        view.main = el('span', 'hero-text', 'No print running');
        view.sub = 'Start a print to see its progress here.';
      }

      if (printer.stale) view.sub = 'No update from the printer for over a minute.';

      var active = st.cls === 'is-running' || st.cls === 'is-pause' || st.cls === 'is-prepare';
      if (active && job.totalLayers > 0) {
        var lv = el('span', 'v');
        lv.appendChild(document.createTextNode(String(job.layer || 0)));
        lv.appendChild(el('span', 'target', ' of ' + job.totalLayers));
        view.details.push(item('Layer', lv));
      }
      if (st.cls === 'is-running' && job.speed) view.details.push(item('Speed', el('span', 'v', job.speed)));
      if (settings.showTemperatures && data.temps) {
        view.details.push(item('Nozzle', temp(data.temps.nozzle)));
        view.details.push(item('Bed', temp(data.temps.bed)));
      }
      if (data.filament && (data.filament.type || data.filament.color)) {
        var fv = el('span', 'v');
        var sw = el('span', 'swatch');
        if (data.filament.color) sw.style.background = data.filament.color;
        fv.appendChild(sw);
        fv.appendChild(document.createTextNode(data.filament.type || 'Filament'));
        view.details.push(item('Filament', fv, 'item-filament'));
      }
    }

    if (showingOld) {
      view.status = 'Offline';
      view.stale = true;
      view.sub = 'Bridge stopped responding. Showing data from ' + clock(new Date(lastDataAt).toISOString()) + '.';
    }

    // Apply to DOM
    app.className = view.cls + (view.stale || printer.stale ? ' is-stale' : '');
    $('printerName').textContent = name;
    $('statusText').textContent = view.status;
    $('jobName').textContent = view.job;
    $('jobName').hidden = !view.job;
    fill($('heroMain'), [view.main]);
    $('heroSub').textContent = view.sub;
    $('heroSub').hidden = !view.sub;
    fill($('details'), view.details);
    $('details').hidden = view.details.length === 0;

    var pct = view.pct === null || view.pct === undefined || !isFinite(view.pct) ? null : Math.max(0, Math.min(100, Math.round(view.pct)));
    app.style.setProperty('--p', pct === null ? 0 : pct / 100);
    app.classList.toggle('has-progress', pct !== null);
    $('pctValue').textContent = pct === null ? '' : String(pct);

    // Progress color: loaded filament or the theme's progress color
    var fil = data && data.filament && color(data.filament.color, null);
    var fillColor = look.progressStyle === 'filament' && fil ? fil : look.theme.progress;
    app.style.setProperty('--fill', fillColor);
    app.style.setProperty('--glow-fill', rgba(fillColor, (settings.glowAmount / 100) * 0.9));

    // Confetti when a print we watched finishes (not on every iCUE restart)
    if (view.cls === 'is-finish' && settings.celebrate &&
        (prevCls === 'is-running' || prevCls === 'is-prepare' || prevCls === 'is-pause')) {
      celebrateNow();
    }
    if (view.cls !== 'is-loading' && !view.stale) prevCls = view.cls;
  }

  // Expose for the inline iCUE event hookup in index.html
  window.applySettings = applySettings;
  window.startPolling = startPolling;
  window.bambuCelebrate = celebrateNow;

  // Opened in a normal browser (no iCUE runtime): run with defaults for testing.
  if (typeof window.iCUE_initialized === 'undefined' && typeof iCUE_initialized === 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      applySettings();
      startPolling();
    });
  }
})();
