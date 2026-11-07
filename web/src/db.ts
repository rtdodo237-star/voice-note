// 기기 내부 저장소(IndexedDB) — 녹음 파일은 이 폰/브라우저 안에만 저장된다.
// 녹음 중에는 1초마다 조각(chunk)을 저장해서, 앱이 강제로 꺼져도 다음 실행 때 복구한다.
import type { ModeId } from './modes';

export interface Recording {
  id: string;
  mode: ModeId;
  title: string;
  createdAt: string; // ISO
  durationMs: number;
  mimeType: string;
  size: number;
  blob: Blob;
  recovered?: boolean;
}

export type RecordingMeta = Omit<Recording, 'blob'>;

interface Session {
  id: string;
  mode: ModeId;
  startedAt: string;
  mimeType: string;
  durationMs: number;
}

interface Chunk {
  key?: number;
  sessionId: string;
  data: Blob;
}

const DB_NAME = 'voice-note';
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) {
        const s = db.createObjectStore('chunks', { keyPath: 'key', autoIncrement: true });
        s.createIndex('sessionId', 'sessionId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- 완성된 녹음 ----------
export async function listRecordings(): Promise<RecordingMeta[]> {
  const db = await openDb();
  const all = await result(db.transaction('recordings').objectStore('recordings').getAll() as IDBRequest<Recording[]>);
  return all
    .map(({ blob: _blob, ...meta }) => meta)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getRecording(id: string): Promise<Recording | undefined> {
  const db = await openDb();
  return result(db.transaction('recordings').objectStore('recordings').get(id) as IDBRequest<Recording | undefined>);
}

export async function putRecording(rec: Recording): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('recordings', 'readwrite');
  tx.objectStore('recordings').put(rec);
  await done(tx);
}

export async function renameRecording(id: string, title: string): Promise<void> {
  const rec = await getRecording(id);
  if (rec) await putRecording({ ...rec, title });
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('recordings', 'readwrite');
  tx.objectStore('recordings').delete(id);
  await done(tx);
}

// ---------- 녹음 중 안전 저장 ----------
export async function startSession(s: Session): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('sessions', 'readwrite');
  tx.objectStore('sessions').put(s);
  await done(tx);
}

export async function appendChunk(sessionId: string, data: Blob, durationMs: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['chunks', 'sessions'], 'readwrite');
  tx.objectStore('chunks').add({ sessionId, data } satisfies Chunk);
  const sessions = tx.objectStore('sessions');
  // 콜백 방식 유지: 트랜잭션 안에서 await 하면 일부 사파리에서 트랜잭션이 먼저 닫힐 수 있음
  const getReq = sessions.get(sessionId) as IDBRequest<Session | undefined>;
  getReq.onsuccess = () => {
    if (getReq.result) sessions.put({ ...getReq.result, durationMs });
  };
  await done(tx);
}

async function sessionChunks(db: IDBDatabase, sessionId: string): Promise<Chunk[]> {
  const idx = db.transaction('chunks').objectStore('chunks').index('sessionId');
  const chunks = await result(idx.getAll(sessionId) as IDBRequest<Chunk[]>);
  return chunks.sort((a, b) => (a.key ?? 0) - (b.key ?? 0));
}

export async function clearSession(sessionId: string): Promise<void> {
  const db = await openDb();
  const keys = (await sessionChunks(db, sessionId)).map((c) => c.key!);
  const tx = db.transaction(['chunks', 'sessions'], 'readwrite');
  const chunkStore = tx.objectStore('chunks');
  keys.forEach((k) => chunkStore.delete(k));
  tx.objectStore('sessions').delete(sessionId);
  await done(tx);
}

/** 녹음 저장 완료: 조각을 합쳐 녹음으로 만들고 임시 조각 삭제 */
export async function finalizeSession(
  sessionId: string,
  meta: { title: string; durationMs: number },
): Promise<Recording | null> {
  const db = await openDb();
  const s = await result(db.transaction('sessions').objectStore('sessions').get(sessionId) as IDBRequest<Session | undefined>);
  if (!s) return null;
  const chunks = await sessionChunks(db, sessionId);
  if (chunks.length === 0) {
    await clearSession(sessionId);
    return null;
  }
  const blob = new Blob(chunks.map((c) => c.data), { type: s.mimeType });
  const rec: Recording = {
    id: sessionId,
    mode: s.mode,
    title: meta.title,
    createdAt: s.startedAt,
    durationMs: meta.durationMs,
    mimeType: s.mimeType,
    size: blob.size,
    blob,
  };
  await putRecording(rec);
  await clearSession(sessionId);
  return rec;
}

/** 앱이 녹음 도중 꺼졌던 경우: 남은 조각을 녹음으로 복구. 복구한 개수를 돌려준다 */
export async function recoverSessions(titleFor: (mode: ModeId, startedAt: string) => string): Promise<number> {
  const db = await openDb();
  const sessions = await result(db.transaction('sessions').objectStore('sessions').getAll() as IDBRequest<Session[]>);
  let recovered = 0;
  for (const s of sessions) {
    const rec = await finalizeSession(s.id, { title: titleFor(s.mode, s.startedAt), durationMs: s.durationMs });
    if (rec) {
      await putRecording({ ...rec, recovered: true });
      recovered += 1;
    }
  }
  return recovered;
}

/** 브라우저가 저장공간을 임의로 비우지 않도록 요청 (지원 브라우저만) */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
