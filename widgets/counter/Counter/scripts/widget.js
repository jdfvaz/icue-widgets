/*
 * Counter widget for CORSAIR iCUE (XENEON EDGE)
 *
 * Tap the big number to add one step. The reset button asks for
 * confirmation (optional) before clearing the count back to zero.
 * The count is kept in localStorage so it survives a restart of iCUE.
 */

var CTR_DEFAULTS = {
  step: 1,
  label: "",
  confirmReset: true,
  textColor: "#eef0ff",
  accentColor: "#7b83ff",
  backgroundColor: "#1e2033",
  transparency: 0
};

var CTR_STORAGE_KEY = "icueCounterWidget.value";

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
  var count = 0;

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

  function loadCount() {
    try {
      var raw = window.localStorage ? window.localStorage.getItem(CTR_STORAGE_KEY) : null;
      var n = raw !== null ? Number(raw) : 0;
      return isFinite(n) ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  function saveCount() {
    try {
      if (window.localStorage) window.localStorage.setItem(CTR_STORAGE_KEY, String(count));
    } catch (e) {}
  }

  function renderCount() {
    $("countValue").textContent = String(count);
  }

  function bump() {
    var step = settings.step || 1;
    count += step;
    saveCount();
    renderCount();
    pulse();
  }

  function pulse() {
    var el = $("count");
    el.classList.remove("is-bump");
    // Force reflow so the animation restarts on quick repeated taps.
    void el.offsetWidth;
    el.classList.add("is-bump");
  }

  function doReset() {
    count = 0;
    saveCount();
    renderCount();
    hideConfirm();
  }

  function showConfirm() {
    $("confirm").hidden = false;
  }

  function hideConfirm() {
    $("confirm").hidden = true;
  }

  function apply(extra) {
    settings = readSettings(extra);

    var s = document.documentElement.style;
    s.setProperty("--text", settings.textColor);
    s.setProperty("--accent", settings.accentColor);
    s.setProperty("--bg", settings.backgroundColor);
    s.setProperty("--alpha", Math.max(0, Math.min(100, 100 - settings.transparency)) + "%");

    var labelEl = $("labelText");
    if (settings.label) {
      labelEl.textContent = settings.label;
      labelEl.hidden = false;
    } else {
      labelEl.hidden = true;
    }

    renderCount();
  }

  function init() {
    count = loadCount();
    renderCount();

    $("count").addEventListener("click", bump);
    $("count").addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); bump(); }
    });

    $("reset").addEventListener("click", function () {
      if (settings.confirmReset) showConfirm();
      else doReset();
    });

    $("confirmYes").addEventListener("click", doReset);
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
