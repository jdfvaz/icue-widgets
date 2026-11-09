/*
 * Counter widget for CORSAIR iCUE (XENEON EDGE)
 *
 * Tap a number to add one step. Each counter has its own reset button,
 * which asks for confirmation (optional) before clearing it back to zero.
 * Set "Number of counters" (1-4) to track more than one thing in the same
 * widget, each with its own label. Counts are kept in localStorage so they
 * survive a restart of iCUE.
 */

var CTR_MAX = 4;

var CTR_DEFAULTS = {
  counterCount: 1,
  step: 1,
  confirmReset: true,
  label1: "",
  label2: "",
  label3: "",
  label4: "",
  textColor: "#eef0ff",
  accentColor: "#7b83ff",
  backgroundColor: "#1e2033",
  transparency: 0
};

var CTR_LEGACY_KEY = "icueCounterWidget.value"; // single-counter version 1.0.0
function ctrStorageKey(i) { return "icueCounterWidget.value." + i; }

// Reads a value iCUE injected for an x-icue-property (pattern from the iCUE docs).
function ctrReadProperty(name) {
  if (typeof window !== "undefined" && Object.prototype.hasOwnProperty.call(window, name)) {
    var v = window[name];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  try {
    var value = Function('return typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined')();
    if (value !== undefined && value !== null && value !== "") return value;
  } catch (e) {}
  return undefined;
}

var CounterWidget = (function () {
  var settings = Object.assign({}, CTR_DEFAULTS);
  var counts = [0, 0, 0, 0]; // index 0 => counter 1, ... index 3 => counter 4
  var pendingReset = null;

  function $(id) { return document.getElementById(id); }

  function readSettings(extra) {
    var next = {};
    Object.keys(CTR_DEFAULTS).forEach(function (key) {
      var d = CTR_DEFAULTS[key];
      var v = ctrReadProperty(key);
      if (extra && extra[key] !== undefined && extra[key] !== null && extra[key] !== "") v = extra[key];
      if (v === undefined) v = d;
      if (typeof d === "boolean") v = v === true || v === "true" || v === 1;
      else if (typeof d === "number") { v = Number(v); if (!isFinite(v)) v = d; }
      else v = String(v);
      next[key] = v;
    });
    return next;
  }

  function loadCounts() {
    var out = [0, 0, 0, 0];
    for (var i = 1; i <= CTR_MAX; i++) {
      try {
        var raw = window.localStorage ? window.localStorage.getItem(ctrStorageKey(i)) : null;
        if (raw === null && i === 1) {
          // migrate the single-counter version's value
          raw = window.localStorage ? window.localStorage.getItem(CTR_LEGACY_KEY) : null;
        }
        var n = raw !== null ? Number(raw) : 0;
        out[i - 1] = isFinite(n) ? n : 0;
      } catch (e) {}
    }
    return out;
  }

  function saveCount(i) {
    try {
      if (window.localStorage) window.localStorage.setItem(ctrStorageKey(i), String(counts[i - 1]));
    } catch (e) {}
  }

  function clampCount(n) {
    n = Math.round(Number(n) || 1);
    return Math.max(1, Math.min(CTR_MAX, n));
  }

  function renderValue(i) {
    $("tileValue-" + i).textContent = String(counts[i - 1]);
  }

  function bump(i) {
    var step = settings.step || 1;
    counts[i - 1] += step;
    saveCount(i);
    renderValue(i);
    pulse(i);
  }

  function pulse(i) {
    var el = $("tileCount-" + i);
    el.classList.remove("is-bump");
    void el.offsetWidth; // restart the animation on quick repeated taps
    el.classList.add("is-bump");
  }

  function doReset(i) {
    counts[i - 1] = 0;
    saveCount(i);
    renderValue(i);
    hideConfirm();
  }

  function showConfirm(i) {
    pendingReset = i;
    $("confirm").hidden = false;
  }

  function hideConfirm() {
    pendingReset = null;
    $("confirm").hidden = true;
  }

  function apply(extra) {
    settings = readSettings(extra);
    var n = clampCount(settings.counterCount);

    var s = document.documentElement.style;
    s.setProperty("--text", settings.textColor);
    s.setProperty("--accent", settings.accentColor);
    s.setProperty("--bg", settings.backgroundColor);
    s.setProperty("--alpha", Math.max(0, Math.min(100, 100 - settings.transparency)) + "%");

    var container = $("counters");
    container.className = "counters count-" + n;

    for (var i = 1; i <= CTR_MAX; i++) {
      $("tile-" + i).hidden = i > n;
      var labelEl = $("tileLabel-" + i);
      var labelText = settings["label" + i];
      if (labelText) {
        labelEl.textContent = labelText;
        labelEl.hidden = false;
      } else {
        labelEl.hidden = true;
      }
      renderValue(i);
    }
  }

  function init() {
    counts = loadCounts();

    for (var i = 1; i <= CTR_MAX; i++) {
      (function (idx) {
        $("tileCount-" + idx).addEventListener("click", function () { bump(idx); });
        $("tileCount-" + idx).addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); bump(idx); }
        });
        $("tileReset-" + idx).addEventListener("click", function () {
          if (settings.confirmReset) showConfirm(idx);
          else doReset(idx);
        });
      })(i);
    }

    $("confirmYes").addEventListener("click", function () {
      if (pendingReset !== null) doReset(pendingReset);
    });
    $("confirmNo").addEventListener("click", hideConfirm);
  }

  init();
  return { apply: apply };
})();

// ---------- iCUE lifecycle ----------

icueEvents = {
  onICUEInitialized: function (payload) { CounterWidget.apply(payload && payload.settings); },
  onDataUpdated: function (payload) { CounterWidget.apply(payload && payload.settings); }
};

if (typeof iCUE_initialized === "undefined") {
  // Opened directly in a browser for testing.
  CounterWidget.apply({});
} else if (iCUE_initialized) {
  CounterWidget.apply();
}
