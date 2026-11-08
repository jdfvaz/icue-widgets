/*
 * Discord Server widget for CORSAIR iCUE (XENEON EDGE)
 *
 * Data source: Discord's public server widget feed
 *   https://discord.com/api/v10/guilds/{serverId}/widget.json
 * It needs no login or bot token. The server owner turns it on in
 * Server Settings > Widget > Enable Server Widget.
 *
 * What the feed contains: server name, online count, the voice channels that
 * everyone can join, and up to 100 online members (name, avatar, status,
 * current game, voice channel, mute/deafen state).
 */

var DSW_DEFAULTS = {
  serverId: "",
  refreshSeconds: 60,
  openIn: "app",
  showMembers: true,
  showActivity: true,
  showEmptyRooms: false,
  textColor: "#eef0ff",
  accentColor: "#7b83ff",
  backgroundColor: "#1e2033",
  transparency: 0
};

// Sample server shown until a Server ID is set (and when previewing in a browser).
var DSW_DEMO = {
  id: "",
  name: "Night Shift",
  instant_invite: null,
  presence_count: 23,
  memberCount: 148,
  channels: [
    { id: "c1", name: "Lounge", position: 0 },
    { id: "c2", name: "Ranked queue", position: 1 },
    { id: "c3", name: "Study hall", position: 2 },
    { id: "c4", name: "Movie night", position: 3 },
    { id: "c5", name: "AFK", position: 4 }
  ],
  members: [
    { username: "mira", status: "online", channel_id: "c1" },
    { username: "tobi.k", status: "online", channel_id: "c1", self_mute: true },
    { username: "Juno", status: "idle", channel_id: "c1", self_deaf: true },
    { username: "R4ven", status: "online", channel_id: "c2", activity: { name: "Rocket League" } },
    { username: "sol", status: "dnd", channel_id: "c2", activity: { name: "Rocket League" } },
    { username: "pixelmoth", status: "online", channel_id: "c3" },
    { username: "ana_b", status: "online", activity: { name: "Factorio" } },
    { username: "Kestrel", status: "idle" },
    { username: "dex", status: "dnd", activity: { name: "Visual Studio Code" } },
    { username: "lumen", status: "online", activity: { name: "Spotify" } },
    { username: "orla", status: "online" },
    { username: "Basil", status: "idle", activity: { name: "Stardew Valley" } },
    { username: "wren", status: "online", activity: { name: "Elden Ring" } },
    { username: "quill", status: "online" },
    { username: "Marlow", status: "dnd" },
    { username: "fen", status: "online", activity: { name: "Minecraft" } },
    { username: "Ivo", status: "online" },
    { username: "salt", status: "idle" }
  ]
};

// Reads a value iCUE injected for an x-icue-property (pattern from the iCUE docs).
function dswReadProperty(name) {
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

var DiscordWidget = (function () {
  var API = "https://discord.com/api/v10";
  var CDN = "https://cdn.discordapp.com";
  var STATUS_RANK = { online: 0, idle: 1, dnd: 2 };
  var AV_COLORS = ["#5b6ee1", "#3c9d8f", "#c2577a", "#c98a2e", "#7a5cc7", "#4f8fc0", "#5f9e4a"];

  var ICON_SPEAKER =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 9.5v5h3.8l4.7 3.9V5.6L7.3 9.5H3.5z" fill="currentColor"/>' +
    '<path d="M15.5 8.6a4.8 4.8 0 0 1 0 6.8M18.3 6a8.6 8.6 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var ICON_MUTED =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/>' +
    '<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path d="M4 4l16 16" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
  var ICON_DEAFENED =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15v-3a8 8 0 0 1 16 0v3" fill="none" stroke="currentColor" stroke-width="2.2"/>' +
    '<rect x="3" y="13.5" width="4.5" height="7" rx="1.6" fill="currentColor"/><rect x="16.5" y="13.5" width="4.5" height="7" rx="1.6" fill="currentColor"/>' +
    '<path d="M4 4l16 16" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';

  var settings = Object.assign({}, DSW_DEFAULTS);
  var st = {
    started: false,
    guildId: null,
    data: null,
    invite: null,
    inviteCode: null,
    inviteAt: 0,
    error: null,
    lastOk: 0,
    timer: null,
    seq: 0
  };

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  // ---------- Settings ----------

  function readSettings(extra) {
    var next = {};
    Object.keys(DSW_DEFAULTS).forEach(function (key) {
      var d = DSW_DEFAULTS[key];
      var v = dswReadProperty(key);
      if (extra && extra[key] !== undefined && extra[key] !== null && extra[key] !== "") v = extra[key];
      if (v === undefined) v = d;
      if (typeof d === "boolean") v = v === true || v === "true" || v === 1;
      else if (typeof d === "number") { v = Number(v); if (!isFinite(v)) v = d; }
      else v = String(v);
      next[key] = v;
    });
    return next;
  }

  // Accepts a bare ID or anything containing one (for example the widget URL
  // https://discord.com/widget?id=123... copied from Server Settings > Widget).
  function parseGuildId(raw) {
    var m = String(raw || "").match(/\d{17,20}/);
    return m ? m[0] : null;
  }

  function apply(extra) {
    var prev = settings;
    settings = readSettings(extra);

    var s = document.documentElement.style;
    s.setProperty("--text", settings.textColor);
    s.setProperty("--accent", settings.accentColor);
    s.setProperty("--bg", settings.backgroundColor);
    s.setProperty("--alpha", Math.max(0, Math.min(100, 100 - settings.transparency)) + "%");

    var gid = parseGuildId(settings.serverId);
    var guildChanged = gid !== st.guildId;
    if (guildChanged) {
      st.guildId = gid;
      st.data = null;
      st.invite = null;
      st.inviteCode = null;
      st.error = null;
      st.lastOk = 0;
    }

    if (!st.started || guildChanged || prev.refreshSeconds !== settings.refreshSeconds) {
      st.started = true;
      refresh();
    } else {
      render();
    }
  }

  // ---------- Network ----------

  function fetchJson(url) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeout = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;
    return fetch(url, { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        return res.text().then(function (text) {
          var body = null;
          try { body = text ? JSON.parse(text) : null; } catch (e) {}
          var snippet = body ? "" : String(text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
          return { ok: res.ok, status: res.status, body: body, snippet: snippet };
        });
      })
      .finally(function () { if (timeout) clearTimeout(timeout); });
  }

  function schedule(minDelayMs) {
    clearTimeout(st.timer);
    if (!st.guildId) return;
    var base = Math.max(30, settings.refreshSeconds) * 1000;
    if (st.error && !st.data) base = 30000; // setup problem: check again sooner
    st.timer = setTimeout(refresh, Math.max(minDelayMs || 0, base));
  }

  function classify(r) {
    var code = r.body && r.body.code;
    var msg = (r.body && r.body.message) || r.snippet || "";
    var reply = "Discord replied " + r.status + (code ? " (code " + code + (msg ? ": " + msg : "") + ")" : (msg ? ": " + msg : "")) + ".";
    if (code === 50004) return { kind: "disabled", reply: reply };
    if (code === 10004 || r.status === 404 || r.status === 400) return { kind: "unknown", reply: reply };
    if (r.status === 429) return { kind: "busy", reply: reply };
    return { kind: "http", status: r.status, reply: reply };
  }

  function refresh() {
    clearTimeout(st.timer);
    var gid = st.guildId;
    if (!gid) { render(); return; }
    var seq = ++st.seq;
    if (!st.data) render(); // show "Connecting" right away

    fetchJson(API + "/guilds/" + gid + "/widget.json").then(function (r) {
      if (seq !== st.seq) return;
      st.checkedAt = Date.now();
      if (r.ok && r.body && Array.isArray(r.body.members)) {
        st.data = r.body;
        st.error = null;
        st.lastOk = Date.now();
        loadInvite(r.body);
      } else {
        st.error = classify(r);
      }
      render();
      var retryAfter = r.status === 429 && r.body && r.body.retry_after ? r.body.retry_after * 1000 : 0;
      schedule(retryAfter);
    }, function () {
      if (seq !== st.seq) return;
      st.error = { kind: "network" };
      render();
      schedule(0);
    });
  }

  // The invite (if the server set an invite channel for its widget) gives us
  // the server icon and the total member count.
  function loadInvite(data) {
    if (!data.instant_invite) { st.invite = null; return; }
    var code = String(data.instant_invite).split("?")[0].split("/").filter(Boolean).pop();
    if (!code) return;
    if (code === st.inviteCode && Date.now() - st.inviteAt < 15 * 60 * 1000) return;
    st.inviteCode = code;
    st.inviteAt = Date.now();
    var gid = st.guildId;
    fetchJson(API + "/invites/" + encodeURIComponent(code) + "?with_counts=true").then(function (r) {
      if (gid !== st.guildId || !r.ok || !r.body || !r.body.guild) return;
      st.invite = {
        icon: r.body.guild.icon || null,
        memberCount: r.body.approximate_member_count || null
      };
      render();
    }, function () {});
  }

  // ---------- Links ----------

  function openLink(url) {
    if (window.plugins && window.plugins.Linkprovider &&
        typeof pluginLinkprovider_initialized !== "undefined" && pluginLinkprovider_initialized) {
      window.plugins.Linkprovider.open(url);
    } else {
      window.open(url, "_blank");
    }
  }

  function openDiscord(channelId) {
    if (!st.guildId) return; // sample data has nothing to open
    var path = "/channels/" + st.guildId + (channelId ? "/" + channelId : "");
    openLink(settings.openIn === "browser" ? "https://discord.com" + path : "discord://-" + path);
  }

  // ---------- Rendering helpers ----------

  function hash(text) {
    var h = 0;
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    return h;
  }

  function initials(text, max) {
    var words = String(text || "").trim().split(/\s+/).filter(Boolean);
    var out = "";
    for (var i = 0; i < words.length && out.length < max; i++) {
      var m = words[i].match(/[\p{L}\p{N}]/u);
      if (m) out += m[0].toUpperCase();
    }
    return out || "?";
  }

  function activityName(m) {
    if (m.activity && m.activity.name) return m.activity.name;
    if (m.game && m.game.name) return m.game.name;
    return "";
  }

  function avatar(m, mode) {
    var name = m.username || "?";
    var a = el("span", "av");
    a.style.setProperty("--av-bg", AV_COLORS[hash(name) % AV_COLORS.length]);
    a.appendChild(el("span", "ini", initials(name, 1)));

    if (m.avatar_url) {
      var img = new Image();
      img.alt = "";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.onerror = function () { img.remove(); };
      img.src = m.avatar_url;
      a.appendChild(img);
    }

    if (mode === "status") {
      var status = STATUS_RANK[m.status] !== undefined ? m.status : "online";
      a.appendChild(el("i", "dot is-" + status));
    } else if (mode === "voice") {
      var deaf = m.deaf || m.self_deaf;
      var muted = m.mute || m.self_mute || m.suppress;
      if (deaf || muted) {
        var b = el("i", "badge");
        b.innerHTML = deaf ? ICON_DEAFENED : ICON_MUTED;
        a.appendChild(b);
      }
    }
    return a;
  }

  // Hides children that overflow the container's height and appends a "+N" item.
  function fit(container, makeMore) {
    if (!container || container.offsetParent === null) return;
    Array.prototype.slice.call(container.querySelectorAll(":scope > .more")).forEach(function (e) { e.remove(); });
    var items = Array.prototype.slice.call(container.children);
    items.forEach(function (e) { e.hidden = false; });
    var limit = container.clientHeight;
    if (!limit) return;

    var overflows = function (e) { return e.offsetTop + e.offsetHeight > limit + 1; };
    var first = -1;
    for (var i = 0; i < items.length; i++) { if (overflows(items[i])) { first = i; break; } }
    if (first === -1) return;

    var hidden = items.length - first;
    for (var j = first; j < items.length; j++) items[j].hidden = true;
    var more = makeMore(hidden);
    container.appendChild(more);
    while (overflows(more) && first > 0) {
      first--;
      hidden++;
      items[first].hidden = true;
      container.removeChild(more);
      more = makeMore(hidden);
      container.appendChild(more);
    }
  }

  function fitAll() {
    Array.prototype.slice.call(document.querySelectorAll(".room-people")).forEach(function (c) {
      fit(c, function (n) { return el("span", "more", "+" + n); });
    });
    fit($("rooms"), function (n) { return el("div", "more more-rooms", "+" + n + (n === 1 ? " channel" : " channels")); });
    fit($("members"), function (n) { return el("div", "more", "+" + n + " more"); });
    fit($("faces"), function (n) { return el("span", "more", "+" + n); });
  }

  function ago(t) {
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return "less than a minute ago";
    var m = Math.round(s / 60);
    if (m < 60) return m + (m === 1 ? " minute ago" : " minutes ago");
    var h = Math.round(m / 60);
    return h + (h === 1 ? " hour ago" : " hours ago");
  }

  // ---------- Render ----------

  function renderTop(data, demo) {
    var name = data ? data.name : "Discord server";
    $("srvName").textContent = name;

    var icon = $("srvIcon");
    icon.textContent = "";
    if (!demo && st.invite && st.invite.icon) {
      var img = new Image();
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.onerror = function () { icon.textContent = initials(name, 2); };
      img.src = CDN + "/icons/" + st.guildId + "/" + st.invite.icon + ".png?size=128";
      icon.appendChild(img);
    } else {
      icon.textContent = initials(name, 2);
    }

    $("stats").hidden = !data;
    if (!data) return;
    var members = data.members || [];
    var voiceTotal = members.filter(function (m) { return m.channel_id; }).length;
    $("voiceCount").textContent = voiceTotal;
    $("voiceCount").parentNode.classList.toggle("is-zero", voiceTotal === 0);
    $("onlineCount").textContent = data.presence_count != null ? data.presence_count : members.length;
    var total = demo ? data.memberCount : (st.invite && st.invite.memberCount);
    $("memberStat").hidden = !total;
    if (total) $("memberCount").textContent = total;
  }

  function updateNotice() {
    var n = $("notice");
    n.textContent = "";
    if (!st.guildId) {
      n.className = "notice is-demo";
      n.appendChild(el("span", null, "Sample data. Add your Server ID in the widget settings."));
      n.hidden = false;
    } else if (st.data && st.error) {
      n.className = "notice";
      n.appendChild(el("span", null, "Couldn't refresh. Showing what Discord reported " + ago(st.lastOk) + "."));
      n.hidden = false;
    } else {
      n.hidden = true;
    }
  }

  function showMessage(title, detail) {
    $("main").hidden = true;
    $("faces").classList.remove("has-faces");
    $("msgTitle").textContent = title;
    $("msgDetail").textContent = detail;
    var reply = st.error && st.error.reply;
    $("msgCode").textContent = reply ? reply + " Checked at " + new Date(st.checkedAt || Date.now()).toLocaleTimeString() + "." : "";
    $("msgCode").hidden = !reply;
    $("message").hidden = false;
  }

  function render() {
    var demo = !st.guildId;
    var data = demo ? DSW_DEMO : st.data;
    var err = st.error;

    renderTop(data, demo);
    updateNotice();

    if (err && (err.kind === "disabled" || err.kind === "unknown")) {
      if (err.kind === "disabled") {
        showMessage("The server widget is turned off",
          "In Discord, open Server Settings, then Engagement. Under Server Widget, turn on Enable Server Widget and click Save Changes. Tap here to check again.");
      } else {
        showMessage("No server found with that ID",
          "Check the Server ID in the widget settings. In Discord it's under Server Settings, then Engagement, in the Server Widget section.");
      }
      return;
    }
    if (!data) {
      if (err && err.kind === "network") {
        showMessage("Can't reach Discord",
          "Check your internet connection, and in iCUE make sure this widget is allowed to use the network. Tap here to try again.");
      } else if (err && err.kind === "busy") {
        showMessage("Discord asked to slow down", "Trying again shortly. Tap here to try now.");
      } else if (err) {
        showMessage("Discord refused the request", "The widget checks again every 30 seconds. Tap here to try now.");
      } else {
        showMessage("Connecting to Discord", "Loading server " + st.guildId + ".");
      }
      return;
    }

    $("message").hidden = true;
    var mainEl = $("main");
    mainEl.hidden = false;
    mainEl.classList.toggle("no-members", !settings.showMembers);

    var members = data.members || [];
    var inVoice = members.filter(function (m) { return m.channel_id; });
    var channels = (data.channels || []).slice().sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
    var rooms = channels.map(function (c) {
      return { id: c.id, name: c.name, people: inVoice.filter(function (m) { return m.channel_id === c.id; }) };
    });
    var shown = settings.showEmptyRooms ? rooms : rooms.filter(function (r) { return r.people.length; });
    mainEl.classList.toggle("no-voice", shown.length === 0);
    mainEl.style.setProperty("--voice-fr", Math.min(Math.max(shown.length, 1), 3) + "fr");

    // Voice channels
    var roomsEl = $("rooms");
    roomsEl.textContent = "";
    if (!shown.length) {
      var quiet = el("div", "voice-empty");
      quiet.innerHTML = ICON_SPEAKER;
      quiet.appendChild(el("span", null, channels.length
        ? "Nobody in voice right now"
        : "No voice channels are visible to the server widget"));
      roomsEl.appendChild(quiet);
    }
    shown.forEach(function (r) {
      var b = el("button", "room" + (r.people.length ? " is-live" : ""));
      b.type = "button";
      b.addEventListener("click", function () { openDiscord(r.id); });

      var head = el("div", "room-head");
      head.innerHTML = ICON_SPEAKER;
      head.appendChild(el("span", "room-name", r.name));
      if (r.people.length) head.appendChild(el("span", "room-count", String(r.people.length)));
      b.appendChild(head);

      if (r.people.length) {
        var ppl = el("div", "room-people");
        r.people.forEach(function (p) {
          var muted = p.deaf || p.self_deaf || p.mute || p.self_mute || p.suppress;
          var chip = el("span", "chip" + (muted ? " is-muted" : ""));
          chip.appendChild(avatar(p, "voice"));
          chip.appendChild(el("span", "chip-name", p.username));
          ppl.appendChild(chip);
        });
        b.appendChild(ppl);
      }
      roomsEl.appendChild(b);
    });

    // Online members who are not in voice
    var online = members.filter(function (m) { return !m.channel_id; }).sort(function (a, b) {
      var ra = STATUS_RANK[a.status] !== undefined ? STATUS_RANK[a.status] : 3;
      var rb = STATUS_RANK[b.status] !== undefined ? STATUS_RANK[b.status] : 3;
      return ra - rb || String(a.username).localeCompare(String(b.username));
    });
    var membersEl = $("members");
    membersEl.textContent = "";
    membersEl.classList.toggle("roomy", online.length > 0 && online.length <= 8);
    if (!online.length) {
      membersEl.appendChild(el("div", "empty", members.length ? "Everyone online is in voice." : "Nobody is online."));
    }
    online.forEach(function (m) {
      var row = el("div", "member");
      row.appendChild(avatar(m, "status"));
      var text = el("div", "m-text");
      text.appendChild(el("span", "m-name", m.username));
      var act = settings.showActivity ? activityName(m) : "";
      if (act) text.appendChild(el("span", "m-act", act));
      row.appendChild(text);
      membersEl.appendChild(row);
    });

    // Compact tiles: faces of people in voice, or of online members if voice is empty
    var faces = $("faces");
    faces.textContent = "";
    var faceList = inVoice.length ? inVoice : online;
    faces.classList.toggle("is-voice", inVoice.length > 0);
    faces.classList.toggle("has-faces", faceList.length > 0);
    faceList.forEach(function (m) { faces.appendChild(avatar(m, inVoice.length ? "plain" : "status")); });

    requestAnimationFrame(fitAll);
  }

  function init() {
    var top = $("top");
    top.addEventListener("click", function () { openDiscord(null); });
    top.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") openDiscord(null); });
    $("message").addEventListener("click", function () {
      if (!st.guildId) return;
      $("msgTitle").textContent = "Checking again";
      refresh();
    });
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(function () { requestAnimationFrame(fitAll); }).observe($("root"));
    }
    setInterval(updateNotice, 30000);
  }

  init();
  return { apply: apply };
})();

// ---------- iCUE lifecycle ----------

icueEvents = {
  onICUEInitialized: function (payload) { DiscordWidget.apply(payload && payload.settings); },
  onDataUpdated: function (payload) { DiscordWidget.apply(payload && payload.settings); }
};

if (typeof iCUE_initialized === "undefined") {
  // Opened directly in a browser for testing: add ?server=YOUR_SERVER_ID to the URL.
  var dswQuery = new URLSearchParams(window.location.search);
  DiscordWidget.apply({ serverId: dswQuery.get("server") || "" });
} else if (iCUE_initialized) {
  DiscordWidget.apply();
}
