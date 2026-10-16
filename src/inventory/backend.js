// Firestore backend for the inventory module. store.js is the only caller.
//
// Same five-function shape as src/dev/mockBackend.js (brb-inventory only),
// which `npm run dev:mock` swaps in via a Vite alias.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase/config'

// Timestamps become ISO strings so the UI (timeAgo, sorting) never sees a
// Firestore type — and matches the mock backend exactly.
const normalize = (value) => {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, normalize(inner)]))
  return value
}

export const watch = (collectionName, callback, onError) =>
  onSnapshot(
    collection(db, collectionName),
    // 'estimate' fills a pending serverTimestamp with local time instead of null.
    (snapshot) => callback(snapshot.docs.map((snap) => ({ ...normalize(snap.data({ serverTimestamps: 'estimate' })), id: snap.id }))),
    onError,
  )

export const add = async (collectionName, data) => (await addDoc(collection(db, collectionName), data)).id

export const update = (collectionName, id, patch) => updateDoc(doc(db, collectionName, id), patch)

export const remove = (collectionName, id) => deleteDoc(doc(db, collectionName, id))

// ops: [{ type: 'set' | 'update' | 'delete', collection, id?, data? }] — all or nothing.
export const batch = (ops) => {
  const writes = writeBatch(db)
  for (const op of ops) {
    const ref = op.id ? doc(db, op.collection, op.id) : doc(collection(db, op.collection))
    if (op.type === 'set') writes.set(ref, op.data)
    else if (op.type === 'update') writes.update(ref, op.data)
    else writes.delete(ref)
  }
  return writes.commit()
}

// Server time, so the security rules can insist timestamps aren't faked.
export const now = () => serverTimestamp()
