// 말씀노트 연결 (갤럭시·아이폰 앱): 녹음을 구글 드라이브 '녹음노트/1_음성'에 올리고 받아쓰기 상태를 받아온다.
// 연결 서버 = 사용자의 Google Apps Script 웹 앱 (apps-script/Code.gs) — 웹앱과 같은 주소·같은 연결 키
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, UploadType } from 'expo-file-system';
import { getMode } from './modes';
import { loadRecordings, updateRecording } from './storage';
import type { RecordingItem } from './storage';

const KEY = 'voice-note/drive';
export const NOTE_APP_URL = 'https://claude.ai/artifact/XHqf2QNp3jx4e7Pt1LwfQC';

export interface DriveSettings {
  url: string;
  key: string;
  auto: boolean;
}

export async function loadSettings(): Promise<DriveSettings | null> {
  try {
    const s = JSON.parse((await AsyncStorage.getItem(KEY)) || 'null');
    return s && s.url && s.key ? { auto: true, ...s } : null;
  } catch {
    return null;
  }
}

export async function saveSettings(s: DriveSettings | null): Promise<void> {
  if (s) await AsyncStorage.setItem(KEY, JSON.stringify(s));
  else await AsyncStorage.removeItem(KEY);
}

async function call<T>(s: DriveSettings, action: string, extra: Record<string, string> = {}): Promise<T> {
  const params = new URLSearchParams({ action, key: s.key, ...extra });
  const sep = s.url.includes('?') ? '&' : '?';
  let res: Response;
  try {
    res = await fetch(`${s.url}${sep}${params.toString()}`);
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

const extOf = (uri: string) => (uri.split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1] || 'm4a').toLowerCase();
const mimeOf = (ext: string) =>
  ({ m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', '3gp': 'audio/3gpp', wav: 'audio/wav', caf: 'audio/x-caf', webm: 'audio/webm' } as Record<string, string>)[ext] || 'audio/mp4';
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

function fileNameFor(rec: RecordingItem, ext: string): string {
  const d = new Date(rec.createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${stamp}_${getMode(rec.mode).label}_${safeName(rec.title) || '녹음'}.${ext}`;
}

async function uploadOne(s: DriveSettings, rec: RecordingItem, onProgress?: (r: number) => void): Promise<string> {
  const file = new File(rec.uri);
  if (!file.exists) throw new Error('녹음 파일을 찾을 수 없어요. 기기에서 지워졌을 수 있어요.');
  const { token, audioFolderId } = await call<{ token: string; audioFolderId: string }>(s, 'token');
  const ext = extOf(rec.uri);
  const mime = mimeOf(ext);
  const meta = {
    name: fileNameFor(rec, ext),
    parents: [audioFolderId],
    mimeType: mime,
    description: JSON.stringify({ app: 'voice-note', v: 1, id: rec.id, mode: rec.mode, title: rec.title, createdAt: rec.createdAt, durationMs: Math.round(rec.durationMs) }),
    appProperties: { vn_status: 'uploaded', vn_rec: rec.id, vn_mode: rec.mode },
  };

  // 1) 이어 올리기 세션 만들기
  const start = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime },
    body: JSON.stringify(meta),
  });
  if (start.status === 401) throw new Error('드라이브 권한이 만료됐어요. 잠시 뒤 다시 시도해 주세요.');
  const location = start.headers.get('location') || start.headers.get('Location');
  if (!start.ok || !location) throw new Error(`드라이브 준비 실패 (${start.status})`);

  // 2) 녹음 파일을 그대로 전송 (메모리에 올리지 않음 · 진행률 표시)
  const res = await file.upload(location, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: { 'Content-Type': mime },
    onProgress: ({ bytesSent, totalBytes }) => totalBytes > 0 && onProgress?.(bytesSent / totalBytes),
  });
  if (res.status !== 200 && res.status !== 201) throw new Error(`드라이브 저장 실패 (${res.status})`);
  return JSON.parse(res.body).id;
}

const running = new Set<string>();

/** 녹음 하나를 드라이브로 보내기. 이미 보냈으면 건너뜀 */
export async function sendRecording(id: string, onProgress?: (r: number) => void): Promise<void> {
  const s = await loadSettings();
  if (!s) throw new Error('말씀노트 연결이 아직 설정되지 않았어요.');
  if (running.has(id)) return;
  const rec = (await loadRecordings()).find((r) => r.id === id);
  if (!rec || rec.upload?.status === 'done') return;
  running.add(id);
  try {
    await updateRecording(id, { upload: { status: 'uploading', at: new Date().toISOString() } });
    const fileId = await uploadOne(s, rec, onProgress);
    await updateRecording(id, { upload: { status: 'done', fileId, at: new Date().toISOString() }, remote: { status: 'uploaded' } });
  } catch (e) {
    await updateRecording(id, { upload: { status: 'error', error: (e as Error).message, at: new Date().toISOString() } });
    throw e;
  } finally {
    running.delete(id);
  }
}

/** 아직 못 보낸 녹음을 모두 보내기 (자동 전송이 켜져 있을 때) */
export async function syncPending(onChange?: () => void): Promise<number> {
  const s = await loadSettings();
  if (!s || !s.auto) return 0;
  const todo = (await loadRecordings()).filter((r) => r.upload?.status !== 'done').reverse();
  let sent = 0;
  for (const r of todo) {
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

export async function refreshStatus(): Promise<boolean> {
  const s = await loadSettings();
  if (!s) return false;
  const items = await loadRecordings();
  const ids = items.filter((r) => r.upload?.status === 'done' && !FINAL.has(r.remote?.status || '')).map((r) => r.id).slice(0, 50);
  if (!ids.length) return false;
  const { items: st } = await call<{ items: Record<string, { status: string; error: string; textId: string }> }>(s, 'status', { ids: ids.join(',') });
  let changed = false;
  for (const id of ids) {
    const v = st[id];
    if (!v) continue;
    const cur = items.find((r) => r.id === id)?.remote;
    if (cur?.status !== v.status || cur?.error !== v.error) {
      await updateRecording(id, { remote: { status: v.status, error: v.error || undefined, textId: v.textId || undefined, checkedAt: new Date().toISOString() } });
      changed = true;
    }
  }
  return changed;
}

export type SyncTone = 'muted' | 'busy' | 'ok' | 'err';

/** 화면에 보여줄 한 줄 상태 */
export function describe(r: RecordingItem, connected: boolean): { text: string; tone: SyncTone } | null {
  if (!connected && !r.upload) return null;
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

export const TONE_COLOR: Record<SyncTone, string> = { muted: '#6B7280', busy: '#2563EB', ok: '#16A34A', err: '#DC2626' };
