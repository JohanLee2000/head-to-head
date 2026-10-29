(() => {
  'use strict';

  const STORAGE_KEY = 'h2h-state-v1';
  const ROOM_KEY = 'h2h-room';
  const EMOJIS = ['🏆', '🎮', '♟️', '🃏', '🎲', '🎯', '🏓', '🎳', '⚽', '🏀', '🏃', '🧩',
    '🍳', '🧹', '☕', '🍕', '💬', '😂', '🎤', '📚', '🚗', '💤', '❤️', '⭐'];

  const $ = (sel) => document.querySelector(sel);
  const els = {
    scoreboard: $('#scoreboard'),
    trackers: $('#trackers'),
    trackerCount: $('#trackerCount'),
    empty: $('#empty'),
    syncPill: $('#syncPill'),
    trackerDialog: $('#trackerDialog'),
    trackerForm: $('#trackerForm'),
    settingsDialog: $('#settingsDialog'),
    settingsForm: $('#settingsForm'),
    toast: $('#toast'),
    toastMsg: $('#toastMsg'),
    toastUndo: $('#toastUndo'),
  };

  // ---------- State ----------

  const defaultState = () => ({
    version: 1,
    players: [{ name: 'Player 1' }, { name: 'Player 2' }],
    trackers: [],
  });

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const toCount = (v) => Math.max(0, Math.min(999999, Math.floor(Number(v)) || 0));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const sortTrackers = (list) => list.sort((a, b) => b.createdAt - a.createdAt);

  // Coerces anything (stored, imported or synced) into a well-formed state, or null if unusable.
  function normalize(s) {
    if (!s || !Array.isArray(s.players) || s.players.length !== 2 || !Array.isArray(s.trackers)) return null;
    const now = Date.now();
    return {
      version: 1,
      players: s.players.map((p, i) => ({
        name: String(p?.name ?? '').trim().slice(0, 24) || `Player ${i + 1}`,
      })),
      trackers: sortTrackers(s.trackers
        .filter((t) => t && String(t.name ?? '').trim())
        .map((t) => ({
          id: String(t.id || uid()),
          name: String(t.name).trim().slice(0, 40),
          emoji: String(t.emoji || '🏆').slice(0, 8),
          scores: [toCount(t.scores?.[0]), toCount(t.scores?.[1])],
          createdAt: Number(t.createdAt) || now,
          updatedAt: Number(t.updatedAt) || now,
        }))),
    };
  }

  function load() {
    try {
      const parsed = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
      if (parsed) return parsed;
    } catch { /* fall through to defaults */ }
    return defaultState();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  }

  let state = load();
  let bump = null; // { id, p } — the counter to animate on next render
  let fresh = null; // id of a just-added tracker to animate in

  const playerName = (i) => state.players[i].name;
  const findTracker = (id) => state.trackers.find((t) => t.id === id);

  // ---------- Operations ----------
  // Every change is a small op so it can be applied here or sent to the shared
  // rivalry, and undone by applying its inverse:
  //   { type: 'inc', id, p, delta, at }   { type: 'put', tracker }   { type: 'del', id }
  //   { type: 'players', players }         { type: 'batch', ops }

  function applyLocal(s, op) {
    switch (op.type) {
      case 'inc': {
        const t = s.trackers.find((x) => x.id === op.id);
        if (t) { t.scores[op.p] = Math.max(0, t.scores[op.p] + op.delta); t.updatedAt = op.at; }
        break;
      }
      case 'put':
        s.trackers = s.trackers.filter((x) => x.id !== op.tracker.id);
        s.trackers.push(clone(op.tracker));
        sortTrackers(s.trackers);
        break;
      case 'del':
        s.trackers = s.trackers.filter((x) => x.id !== op.id);
        break;
      case 'players':
        s.players = clone(op.players);
        break;
      case 'batch':
        op.ops.forEach((o) => applyLocal(s, o));
        break;
    }
  }

  // Must be called before the op is applied, against the current state.
  function inverse(op) {
    switch (op.type) {
      case 'inc': return { ...op, delta: -op.delta };
      case 'put': {
        const old = findTracker(op.tracker.id);
        return old ? { type: 'put', tracker: clone(old) } : { type: 'del', id: op.tracker.id };
      }
      case 'del': {
        const old = findTracker(op.id);
        return old ? { type: 'put', tracker: clone(old) } : null;
      }
      case 'players': return { type: 'players', players: clone(state.players) };
      case 'batch': return { type: 'batch', ops: op.ops.map(inverse).filter(Boolean).reverse() };
    }
    return null;
  }

  function dispatch(op) {
    if (sync) {
      sync.apply(op); // the snapshot listener re-renders, instantly and offline too
    } else {
      applyLocal(state, op);
      save();
      render();
    }
  }

  // Applies an op and offers an undo for it.
  function run(op, message) {
    const undo = inverse(op);
    dispatch(op);
    if (message && undo) showToast(message, () => dispatch(undo));
  }

  // ---------- Rendering ----------

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const initial = (name) => ([...name.trim()][0] || '?').toUpperCase();

  function timeAgo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function render() {
    renderScoreboard();
    renderTrackers();
    bump = null;
    fresh = null;
  }

  function renderScoreboard() {
    const lead = [0, 0];
    const totals = [0, 0];
    let ties = 0;
    for (const t of state.trackers) {
      totals[0] += t.scores[0];
      totals[1] += t.scores[1];
      if (t.scores[0] > t.scores[1]) lead[0]++;
      else if (t.scores[1] > t.scores[0]) lead[1]++;
      else ties++;
    }
    const leader = lead[0] > lead[1] ? 0 : lead[1] > lead[0] ? 1 : -1;
    const decided = lead[0] + lead[1];

    let caption;
    if (!state.trackers.length) caption = 'Add a tracker to start the rivalry';
    else if (leader === -1) caption = decided ? '<strong>All square</strong> — anyone’s game' : 'No one has the edge yet';
    else caption = `<strong>${esc(playerName(leader))}</strong> leads ${lead[leader]}–${lead[1 - leader]} in trackers`;

    const player = (i) => `
      <div class="sb-player p${i} ${leader === i ? 'is-leader' : ''}">
        <div class="avatar" aria-hidden="true">${esc(initial(playerName(i)))}</div>
        <div class="sb-name">${esc(playerName(i))}</div>
        <div class="sb-big" aria-label="${lead[i]} trackers led">${lead[i]}</div>
        <div class="sb-sub">${totals[i]} point${totals[i] === 1 ? '' : 's'} total</div>
      </div>`;

    els.scoreboard.innerHTML = `
      ${player(0)}
      <div class="sb-mid"><span class="vs">vs</span>${ties ? `<span class="ties">${ties} tied</span>` : ''}</div>
      ${player(1)}
      <div class="sb-bar ${decided ? '' : 'neutral'}" aria-hidden="true">
        <span class="b0" style="flex-grow:${decided ? lead[0] : 1}"></span>
        <span class="b1" style="flex-grow:${decided ? lead[1] : 1}"></span>
      </div>
      <p class="sb-caption">${caption}</p>`;
  }

  function renderTrackers() {
    const list = state.trackers;
    els.empty.hidden = list.length > 0;
    els.trackerCount.textContent = list.length ? `${list.length}` : '';

    els.trackers.innerHTML = list.map((t) => {
      const [a, b] = t.scores;
      const side = (p) => {
        const score = t.scores[p];
        const leads = p === 0 ? a > b : b > a;
        const bumped = bump && bump.id === t.id && bump.p === p;
        const who = esc(playerName(p));
        return `
          <div class="side p${p} ${leads ? 'lead' : ''} ${bumped ? 'bump' : ''}">
            <button class="tap" type="button" data-act="inc" data-p="${p}" aria-label="Add a point for ${who}, currently ${score}">
              <span class="who">${who}</span>
              <span class="num">${score}</span>
              <span class="plus">TAP +1</span>
            </button>
            <button class="minus" type="button" data-act="dec" data-p="${p}" aria-label="Remove a point from ${who}" ${score ? '' : 'disabled'}>−</button>
          </div>`;
      };
      return `
        <article class="card ${fresh === t.id ? 'fresh' : ''}" data-id="${esc(t.id)}">
          <div class="card-head">
            <div class="emoji" aria-hidden="true">${esc(t.emoji)}</div>
            <div class="card-title">
              <h3>${esc(t.name)}</h3>
              <small>Updated ${timeAgo(t.updatedAt)}</small>
            </div>
            <button class="more" type="button" data-act="edit" aria-label="Edit ${esc(t.name)}">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
            </button>
          </div>
          <div class="duel">${side(0)}${side(1)}</div>
        </article>`;
    }).join('');
  }

  // ---------- Toast with undo ----------

  let toastTimer = 0;
  let undoFn = null;

  function showToast(message, onUndo) {
    els.toastMsg.textContent = message;
    undoFn = onUndo || null;
    els.toastUndo.hidden = !onUndo;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 4000);
  }

  function hideToast() {
    els.toast.classList.remove('show');
    undoFn = null;
  }

  els.toastUndo.addEventListener('click', () => {
    const fn = undoFn;
    hideToast();
    if (fn) fn();
  });

  // ---------- Tracker interactions ----------

  els.trackers.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const t = findTracker(btn.closest('[data-id]').dataset.id);
    if (!t) return;
    const p = Number(btn.dataset.p);

    switch (btn.dataset.act) {
      case 'inc':
        bump = { id: t.id, p };
        navigator.vibrate?.(12);
        run({ type: 'inc', id: t.id, p, delta: 1, at: Date.now() }, `+1 ${playerName(p)} · ${t.name}`);
        break;
      case 'dec':
        if (!t.scores[p]) return;
        run({ type: 'inc', id: t.id, p, delta: -1, at: Date.now() }, `−1 ${playerName(p)} · ${t.name}`);
        break;
      case 'edit':
        openTrackerDialog(t);
        break;
    }
  });

  // ---------- Add / edit tracker dialog ----------

  let editingId = null;
  const tf = els.trackerForm;

  $('#emojiGrid').innerHTML = EMOJIS.map((em, i) => `
    <label><input type="radio" name="emoji" value="${em}" ${i === 0 ? 'checked' : ''} aria-label="${em}"><span>${em}</span></label>`).join('');

  function openTrackerDialog(t = null) {
    editingId = t ? t.id : null;
    $('#trackerDialogTitle').textContent = t ? 'Edit tracker' : 'New tracker';
    $('#trackerDanger').hidden = !t;
    $('#score0Label').textContent = `${playerName(0)}’s score`;
    $('#score1Label').textContent = `${playerName(1)}’s score`;

    tf.name.value = t ? t.name : '';
    tf.score0.value = t ? t.scores[0] : 0;
    tf.score1.value = t ? t.scores[1] : 0;
    const emoji = t ? t.emoji : EMOJIS[0];
    const radio = [...tf.emoji].find((r) => r.value === emoji) || tf.emoji[0];
    radio.checked = true;

    els.trackerDialog.showModal();
    if (!t) tf.name.focus();
  }

  tf.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = tf.name.value.trim();
    if (!name) { tf.name.focus(); return; }
    const emoji = tf.emoji.value || EMOJIS[0];
    const scores = [toCount(tf.score0.value), toCount(tf.score1.value)];
    const existing = editingId && findTracker(editingId);
    const now = Date.now();

    if (existing) {
      const changed = scores[0] !== existing.scores[0] || scores[1] !== existing.scores[1];
      const tracker = { ...clone(existing), name, emoji, scores, updatedAt: changed ? now : existing.updatedAt };
      run({ type: 'put', tracker }, `Saved “${name}”`);
    } else {
      fresh = uid();
      run({ type: 'put', tracker: { id: fresh, name, emoji, scores, createdAt: now, updatedAt: now } }, `Added “${name}”`);
    }
    els.trackerDialog.close();
  });

  $('#resetTrackerBtn').addEventListener('click', () => {
    const t = findTracker(editingId);
    if (!t) return;
    run({ type: 'put', tracker: { ...clone(t), scores: [0, 0], updatedAt: Date.now() } }, `Reset “${t.name}”`);
    els.trackerDialog.close();
  });

  $('#deleteTrackerBtn').addEventListener('click', () => {
    const t = findTracker(editingId);
    if (!t) return;
    run({ type: 'del', id: t.id }, `Deleted “${t.name}”`);
    els.trackerDialog.close();
  });

  $('#addBtn').addEventListener('click', () => openTrackerDialog());

  // ---------- Settings dialog ----------

  const sf = els.settingsForm;

  function openSettings() {
    sf.p0.value = playerName(0);
    sf.p1.value = playerName(1);
    renderSyncSection();
    els.settingsDialog.showModal();
  }

  sf.addEventListener('submit', (e) => {
    e.preventDefault();
    const players = [sf.p0.value, sf.p1.value].map((n, i) => ({ name: n.trim().slice(0, 24) || `Player ${i + 1}` }));
    if (players.some((p, i) => p.name !== playerName(i))) run({ type: 'players', players });
    els.settingsDialog.close();
  });

  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `head-to-head-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $('#importInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let next = null;
    try { next = normalize(JSON.parse(await file.text())); } catch { /* invalid JSON */ }
    if (!next) { showToast('That file isn’t a Head to Head backup'); return; }
    run({
      type: 'batch',
      ops: [
        { type: 'players', players: next.players },
        ...state.trackers.map((t) => ({ type: 'del', id: t.id })),
        ...next.trackers.map((t) => ({ type: 'put', tracker: t })),
      ],
    }, `Imported ${next.trackers.length} tracker${next.trackers.length === 1 ? '' : 's'}`);
    els.settingsDialog.close();
  });

  $('#resetAllBtn').addEventListener('click', () => {
    if (!state.trackers.length) return;
    const now = Date.now();
    run({
      type: 'batch',
      ops: state.trackers.map((t) => ({ type: 'put', tracker: { ...clone(t), scores: [0, 0], updatedAt: now } })),
    }, 'All scores reset');
    els.settingsDialog.close();
  });

  $('#deleteAllBtn').addEventListener('click', () => {
    if (!state.trackers.length) return;
    run({ type: 'batch', ops: state.trackers.map((t) => ({ type: 'del', id: t.id })) }, 'All trackers deleted');
    els.settingsDialog.close();
  });

  $('#settingsBtn').addEventListener('click', openSettings);
  $('#emptyNamesBtn').addEventListener('click', openSettings);

  // ---------- Live sync ----------

  let sync = null; // connection from sync.js while in a shared rivalry
  let roomCode = null;
  let syncMeta = { pending: false, fromCache: true };

  const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const prettyCode = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;
  const isCode = (c) => c.length === 10 && [...c].every((ch) => CODE_ALPHABET.includes(ch));

  function newCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  }

  // Only load Firebase when sync is used, so local-only use never needs the network.
  let syncModule = null;
  async function loadSync() {
    syncModule ??= await import('./sync.js');
    return syncModule;
  }

  async function connect(code) {
    const mod = await loadSync();
    sync?.stop();
    roomCode = code;
    syncMeta = { pending: false, fromCache: true };
    try { localStorage.setItem(ROOM_KEY, code); } catch { /* ignore */ }
    sync = mod.connect(code, {
      onData(remote) {
        const next = normalize(remote);
        if (!next) return;
        state = next;
        save(); // keep a local copy so the app opens instantly and survives leaving
        render();
      },
      onStatus(meta) {
        syncMeta = meta;
        renderSyncPill();
      },
      onError(err) {
        console.error(err);
        showToast(err?.code === 'permission-denied' ? 'Sync was refused — check your Firebase rules' : 'Couldn’t sync that change');
      },
    });
    renderSyncPill();
    renderSyncSection();
  }

  function disconnect() {
    sync?.stop();
    sync = null;
    roomCode = null;
    try { localStorage.removeItem(ROOM_KEY); } catch { /* ignore */ }
    renderSyncPill();
    renderSyncSection();
  }

  async function createRoom() {
    if (!navigator.onLine) { showToast('Connect to the internet to start syncing'); return; }
    const code = newCode();
    try {
      const mod = await loadSync();
      await mod.createRoom(code, state);
    } catch (err) {
      console.error(err);
      showToast('Couldn’t create the shared rivalry');
      return;
    }
    await connect(code);
    showToast('Shared rivalry created — send your invite link');
  }

  async function joinRoom(raw) {
    const code = cleanCode(raw);
    if (!isCode(code)) { showToast('Codes look like ABCDE-23456'); return; }
    if (code === roomCode) { showToast('You’re already in this rivalry'); return; }
    if (!navigator.onLine) { showToast('Connect to the internet to join'); return; }
    if (state.trackers.length && !confirm(
      `Joining replaces the ${state.trackers.length} tracker${state.trackers.length === 1 ? '' : 's'} on this phone with the shared ones. Export a backup first if you want to keep them.\n\nJoin now?`)) return;
    let exists = false;
    try {
      exists = await (await loadSync()).roomExists(code);
    } catch (err) {
      console.error(err);
      showToast('Couldn’t reach the server — try again');
      return;
    }
    if (!exists) { showToast('No rivalry found with that code'); return; }
    await connect(code);
    els.settingsDialog.close();
    showToast('Joined! Scores now sync live');
  }

  function inviteLink() {
    return `${location.origin}${location.pathname}?join=${roomCode}`;
  }

  async function shareInvite() {
    const url = inviteLink();
    const text = `Join our Head to Head rivalry! Code: ${prettyCode(roomCode)}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Head to Head', text, url }); } catch { /* cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('Invite link copied');
    } catch {
      prompt('Copy this invite link:', url);
    }
  }

  function renderSyncPill() {
    const pill = els.syncPill;
    if (!sync) { pill.hidden = true; return; }
    let label = 'Synced';
    let kind = 'ok';
    if (!navigator.onLine) { label = 'Offline'; kind = 'off'; }
    else if (syncMeta.pending) { label = 'Syncing…'; kind = 'busy'; }
    else if (syncMeta.fromCache) { label = 'Connecting…'; kind = 'busy'; }
    pill.hidden = false;
    pill.dataset.kind = kind;
    pill.textContent = label;
    pill.title = !navigator.onLine ? 'Changes are saved and will sync when you’re back online' : '';
  }

  function renderSyncSection() {
    const available = Boolean(window.H2H_SYNC_ENABLED);
    $('#syncUnavailable').hidden = available;
    $('#syncOff').hidden = !available || Boolean(sync);
    $('#syncOn').hidden = !sync;
    if (sync) $('#roomCode').textContent = prettyCode(roomCode);
  }

  $('#createRoomBtn').addEventListener('click', createRoom);
  $('#joinBtn').addEventListener('click', () => joinRoom($('#joinInput').value));
  $('#joinInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); joinRoom(e.target.value); }
  });
  $('#shareRoomBtn').addEventListener('click', shareInvite);
  $('#leaveRoomBtn').addEventListener('click', () => {
    if (!confirm('Stop syncing on this phone? You’ll keep a copy of the current scores here, but changes won’t be shared anymore.')) return;
    disconnect();
    showToast('Sync stopped on this phone');
  });
  window.addEventListener('online', renderSyncPill);
  window.addEventListener('offline', renderSyncPill);

  // ---------- Dialog plumbing ----------

  for (const dialog of [els.trackerDialog, els.settingsDialog]) {
    // Close when tapping the backdrop or a [data-close] button.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
    });
  }

  // ---------- Lifecycle ----------

  // Keep multiple open tabs in sync when not using live sync.
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && !sync) { state = load(); render(); }
  });

  // Refresh "updated x ago" labels now and then.
  setInterval(() => { if (!document.hidden) renderTrackers(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderTrackers(); });

  render();

  if (window.H2H_SYNC_ENABLED) {
    let savedRoom = null;
    try { savedRoom = localStorage.getItem(ROOM_KEY); } catch { /* ignore */ }
    if (savedRoom && isCode(savedRoom)) {
      connect(savedRoom).catch((err) => { console.error(err); showToast('Couldn’t start sync'); });
    }

    // Invite links look like ?join=CODE
    const params = new URLSearchParams(location.search);
    const invite = params.get('join');
    if (invite) {
      history.replaceState(null, '', location.pathname);
      joinRoom(invite);
    }
  }

  // Ask the browser not to evict our data under storage pressure.
  navigator.storage?.persist?.().catch(() => {});

  if ('serviceWorker' in navigator) {
    // Reload once when a new version takes over, so updates show up right away.
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
