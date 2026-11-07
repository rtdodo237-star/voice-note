// 드라이브 연결: 녹음을 구글 드라이브 '녹음노트/1_음성'에 올리고, 받아쓰기 진행 상태를 받아온다.
// 연결 서버 = 사용자의 Google Apps Script 웹 앱 (apps-script/Code.gs)
import { getMode } from './modes';
import { getRecording, listRecordings, patchRecording } from './db';
import type { Recording, RecordingMeta } from './db';
import { extFor, safeName } from './format';

const KEY = 'voice-note/drive';

export interface DriveSettings {
  url: string;
  key: string;
  auto: boolean;
}

export function loadSettings(): DriveSettings | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s && s.url && s.key ? { auto: true, ...s } : null;
  } catch {
    return null;
  }
}

export function saveSettings(s: DriveSettings | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* 무시 */
  }
}

async function call<T>(s: DriveSettings, action: string, extra: Record<string, string> = {}): Promise<T> {
  const u = new URL(s.url);
  u.searchParams.set('action', action);
  u.searchParams.set('key', s.key);
  Object.entries(extra).forEach(([k, v]) => u.searchParams.set(k, v));
  let res: Response;
  try {
    res = await fetch(u.toString(), { redirect: 'follow' });
  } catch {
    throw new Error('연결 서버에 닿지 못했어요. 주소와 인터넷 연결을 확인해 주세요.');
  }
  const text = await res.text();
  let data: { ok?: boolean; error?: string } & T;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('연결 주소가 맞지 않아요. Apps Script의 "웹 앱 URL"(끝이 /exec)을 넣어 주세요.');
  }
  if (!data.ok) throw new Error(data.error || '연결 서버가 거절했어요.');
  return data;
}

export async function ping(s: DriveSettings): Promise<{ vito: boolean; folder: string }> {
  return call(s, 'ping');
}

/* ---------- 업로드 ---------- */

type Progress = (ratio: number) => void;

function xhr(method: string, url: string, headers: Record<string, string>, body: Blob | string, onProgress?: Progress): Promise<XMLHttpRequest> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    Object.entries(headers).forEach(([k, v]) => x.setRequestHeader(k, v));
    if (onProgress) x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => resolve(x);
    x.onerror = () => reject(new Error('업로드 중 연결이 끊겼어요.'));
    x.send(body);
  });
}

function fileNameFor(rec: Recording): string {
  const d = new Date(rec.createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${stamp}_${getMode(rec.mode).label}_${safeName(rec.title) || '녹음'}.${extFor(rec.mimeType)}`;
}

async function uploadOne(s: DriveSettings, rec: Recording, onProgress?: Progress): Promise<string> {
  const { token, audioFolderId } = await call<{ token: string; audioFolderId: string }>(s, 'token');
  const mime = rec.mimeType.split(';')[0] || 'audio/mp4';
  const meta = {
    name: fileNameFor(rec),
    parents: [audioFolderId],
    mimeType: mime,
    description: JSON.stringify({ app: 'voice-note', v: 1, id: rec.id, mode: rec.mode, title: rec.title, createdAt: rec.createdAt, durationMs: Math.round(rec.durationMs) }),
    appProperties: { vn_status: 'uploaded', vn_rec: rec.id, vn_mode: rec.mode },
  };
  const auth = { Authorization: `Bearer ${token}` };

  // 1순위: 이어 올리기(resumable) — 긴 녹음에 안정적
  const start = await xhr(
    'POST',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',
    { ...auth, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime },
    JSON.stringify(meta),
  );
  if (start.status === 401) throw new Error('드라이브 권한이 만료됐어요. 잠시 뒤 다시 시도해 주세요.');
  const location = start.status === 200 ? start.getResponseHeader('Location') : null;
  if (location) {
    const put = await xhr('PUT', location, { 'Content-Type': mime }, rec.blob, onProgress);
    if (put.status === 200 || put.status === 201) return JSON.parse(put.responseText).id;
    throw new Error(`드라이브 저장 실패 (${put.status})`);
  }

  // 2순위: 한 번에 올리기(multipart)
  const b = 'vn' + Math.random().toString(36).slice(2);
  const body = new Blob([
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`,
    rec.blob,
    `\r\n--${b}--`,
  ]);
  const up = await xhr('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { ...auth, 'Content-Type': `multipart/related; boundary=${b}` }, body, onProgress);
  if (up.status === 200) return JSON.parse(up.responseText).id;
  throw new Error(`드라이브 저장 실패 (${up.status})`);
}

const running = new Set<string>();

/** 녹음 하나를 드라이브로 보내기. 이미 보냈으면 건너뜀 */
export async function sendRecording(id: string, onProgress?: Progress): Promise<void> {
  const s = loadSettings();
  if (!s) throw new Error('드라이브 연결이 아직 설정되지 않았어요.');
  if (running.has(id)) return;
  const rec = await getRecording(id);
  if (!rec || rec.upload?.status === 'done') return;
  running.add(id);
  try {
    await patchRecording(id, { upload: { status: 'uploading', at: new Date().toISOString() } });
    const fileId = await uploadOne(s, rec, onProgress);
    await patchRecording(id, { upload: { status: 'done', fileId, at: new Date().toISOString() }, remote: { status: 'uploaded' } });
  } catch (e) {
    await patchRecording(id, { upload: { status: 'error', error: (e as Error).message, at: new Date().toISOString() } });
    throw e;
  } finally {
    running.delete(id);
  }
}

/** 아직 못 보낸 녹음을 모두 보내기 (자동 전송이 켜져 있을 때) */
export async function syncPending(onChange?: () => void): Promise<number> {
  const s = loadSettings();
  if (!s || !s.auto || !navigator.onLine) return 0;
  const todo = (await listRecordings()).filter((r) => r.upload?.status !== 'done');
  let sent = 0;
  for (const r of todo.reverse()) {
    try {
      await sendRecording(r.id);
      sent++;
    } catch {
      /* 다음 기회에 다시 시도 */
    }
    onChange?.();
  }
  return sent;
}

/* ---------- 받아쓰기 상태 ---------- */

const FINAL = new Set(['done', 'failed']);

/** 드라이브로 보낸 녹음들의 받아쓰기 상태를 받아와 저장 */
export async function refreshStatus(items: RecordingMeta[]): Promise<boolean> {
  const s = loadSettings();
  if (!s || !navigator.onLine) return false;
  const ids = items.filter((r) => r.upload?.status === 'done' && !FINAL.has(r.remote?.status || '')).map((r) => r.id).slice(0, 50);
  if (!ids.length) return false;
  const { items: st } = await call<{ items: Record<string, { status: string; error: string; textId: string }> }>(s, 'status', { ids: ids.join(',') });
  let changed = false;
  for (const id of ids) {
    const v = st[id];
    if (!v) continue;
    const cur = items.find((r) => r.id === id)?.remote;
    if (cur?.status !== v.status || cur?.error !== v.error) {
      await patchRecording(id, { remote: { status: v.status, error: v.error || undefined, textId: v.textId || undefined, checkedAt: new Date().toISOString() } });
      changed = true;
    }
  }
  return changed;
}

/** 화면에 보여줄 한 줄 상태 */
export function describe(r: RecordingMeta): { text: string; tone: 'muted' | 'busy' | 'ok' | 'err' } | null {
  if (!loadSettings() && !r.upload) return null;
  const u = r.upload?.status;
  if (!u || u === 'pending') return { text: '드라이브 전송 대기', tone: 'muted' };
  if (u === 'uploading') return { text: '드라이브로 보내는 중', tone: 'busy' };
  if (u === 'error') return { text: '전송 실패 · 다시 보내기 필요', tone: 'err' };
  const st = r.remote?.status || 'uploaded';
  if (st === 'uploaded') return { text: '받아쓰기 대기 (5분 안)', tone: 'busy' };
  if (st === 'submitted') return { text: '받아쓰는 중', tone: 'busy' };
  if (st === 'done') return { text: '받아쓰기 완료 · 말씀노트 등록 대기', tone: 'ok' };
  if (st === 'failed') return { text: '받아쓰기 실패', tone: 'err' };
  return { text: st, tone: 'muted' };
}
