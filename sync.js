// Live sync via Cloud Firestore. Loaded on demand by app.js.
// Layout: rooms/{code} holds { players }, rooms/{code}/trackers/{id} holds each tracker.
// Firestore's offline cache keeps everything usable without signal and
// sends queued changes once the phone is back online.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, onSnapshot, getDocFromServer, writeBatch, increment,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let db = null;

function getDb() {
  if (!db) {
    const app = initializeApp(window.H2H_FIREBASE_CONFIG);
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  }
  return db;
}

const roomRef = (code) => doc(getDb(), 'rooms', code);
const trackerRef = (code, id) => doc(getDb(), 'rooms', code, 'trackers', id);

const toDoc = (t) => ({
  name: t.name, emoji: t.emoji, s0: t.scores[0], s1: t.scores[1],
  createdAt: t.createdAt, updatedAt: t.updatedAt,
});

const fromDoc = (snap) => {
  const d = snap.data();
  return {
    id: snap.id, name: d.name, emoji: d.emoji, scores: [d.s0, d.s1],
    createdAt: d.createdAt, updatedAt: d.updatedAt,
  };
};

// Translates an app op (see app.js) into writes on a batch.
function addToBatch(batch, code, op) {
  switch (op.type) {
    case 'inc':
      // increment() merges taps from both phones instead of overwriting each other.
      batch.update(trackerRef(code, op.id), { [`s${op.p}`]: increment(op.delta), updatedAt: op.at });
      break;
    case 'put':
      batch.set(trackerRef(code, op.tracker.id), toDoc(op.tracker));
      break;
    case 'del':
      batch.delete(trackerRef(code, op.id));
      break;
    case 'players':
      batch.set(roomRef(code), { players: op.players }, { merge: true });
      break;
    case 'batch':
      op.ops.forEach((o) => addToBatch(batch, code, o));
      break;
  }
}

export async function roomExists(code) {
  return (await getDocFromServer(roomRef(code))).exists();
}

// Creates a room seeded with this phone's current players and trackers.
export async function createRoom(code, state) {
  const batch = writeBatch(getDb());
  batch.set(roomRef(code), { players: state.players, createdAt: Date.now() });
  state.trackers.forEach((t) => batch.set(trackerRef(code, t.id), toDoc(t)));
  await batch.commit();
}

export function connect(code, { onData, onStatus, onError }) {
  let players = null;
  let trackers = null;
  const meta = { room: null, trackers: null };

  const emit = () => {
    if (players && trackers) onData({ players, trackers });
    const m = [meta.room, meta.trackers].filter(Boolean);
    onStatus({
      pending: m.some((x) => x.hasPendingWrites),
      fromCache: m.length < 2 || m.some((x) => x.fromCache),
    });
  };

  const opts = { includeMetadataChanges: true };
  const stopRoom = onSnapshot(roomRef(code), opts, (snap) => {
    meta.room = snap.metadata;
    if (snap.exists()) players = snap.data().players;
    emit();
  }, onError);
  const stopTrackers = onSnapshot(collection(getDb(), 'rooms', code, 'trackers'), opts, (snap) => {
    meta.trackers = snap.metadata;
    trackers = snap.docs.map(fromDoc);
    emit();
  }, onError);

  return {
    apply(op) {
      const batch = writeBatch(getDb());
      addToBatch(batch, code, op);
      // Resolves when the server confirms; offline it stays queued, and the
      // snapshot listeners already show the change locally.
      batch.commit().catch(onError);
    },
    stop() {
      stopRoom();
      stopTrackers();
    },
  };
}
