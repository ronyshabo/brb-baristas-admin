// Firestore backend for the schedule module. store.js is the only caller.

import { collection, deleteDoc, doc, onSnapshot, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

// Timestamps become ISO strings so the UI never sees a Firestore type.
const normalize = (value) => {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, normalize(inner)]))
  return value
}

export const watch = (collectionName, callback, onError) =>
  onSnapshot(
    collection(db, collectionName),
    (snapshot) => callback(snapshot.docs.map((snap) => ({ ...normalize(snap.data({ serverTimestamps: 'estimate' })), id: snap.id }))),
    onError,
  )

export const set = (collectionName, id, data) => setDoc(doc(db, collectionName, id), data)

export class AlreadyExistsError extends Error {}

// Writes only if the doc does not exist yet, so two people tapping the same
// empty shift at once cannot both get it.
export const create = (collectionName, id, data) =>
  runTransaction(db, async (transaction) => {
    const ref = doc(db, collectionName, id)
    if ((await transaction.get(ref)).exists()) throw new AlreadyExistsError(`${collectionName}/${id} already exists`)
    transaction.set(ref, data)
  })

export const update = (collectionName, id, patch) => updateDoc(doc(db, collectionName, id), patch)

export const remove = (collectionName, id) => deleteDoc(doc(db, collectionName, id))

export const now = () => serverTimestamp()
