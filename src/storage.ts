// 녹음 목록 저장소 — 기기 안에만 저장 (AsyncStorage)
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ModeId } from './modes';

export type TranscriptStatus = 'none' | 'processing' | 'done' | 'error';

export interface RecordingItem {
  id: string;
  mode: ModeId;
  title: string;
  uri: string; // 녹음 파일 위치 (앱 문서 폴더)
  durationMs: number;
  createdAt: string; // ISO 날짜
  transcriptStatus: TranscriptStatus; // Phase 1(변환)에서 사용
  transcriptMd?: string; // 변환 결과 markdown
}

const KEY = 'voice-note/recordings/v1';

export async function loadRecordings(): Promise<RecordingItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RecordingItem[]) : [];
  } catch {
    return [];
  }
}

async function saveAll(items: RecordingItem[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

export async function addRecording(item: RecordingItem): Promise<RecordingItem[]> {
  const items = await loadRecordings();
  const next = [item, ...items];
  await saveAll(next);
  return next;
}

export async function updateRecording(
  id: string,
  patch: Partial<RecordingItem>,
): Promise<RecordingItem[]> {
  const items = await loadRecordings();
  const next = items.map((r) => (r.id === id ? { ...r, ...patch } : r));
  await saveAll(next);
  return next;
}

export async function removeRecording(id: string): Promise<RecordingItem[]> {
  const items = await loadRecordings();
  const next = items.filter((r) => r.id !== id);
  await saveAll(next);
  return next;
}

// 마지막으로 쓴 모드 기억
const LAST_MODE_KEY = 'voice-note/last-mode';
export const loadLastMode = async (): Promise<ModeId | null> =>
  (await AsyncStorage.getItem(LAST_MODE_KEY)) as ModeId | null;
export const saveLastMode = (mode: ModeId) => AsyncStorage.setItem(LAST_MODE_KEY, mode);

// ---- 표시용 도우미 ----
export const formatDuration = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export const formatDate = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const newId = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
