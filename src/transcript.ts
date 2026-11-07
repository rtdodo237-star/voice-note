// 공유 받은 받아쓰기 글(갤럭시 녹음 앱 · 삼성 노트 등)을 녹취록 md 로 정리
// Apps Script(buildMarkdown_)와 같은 머리말을 써서 말씀노트 자동 등록이 그대로 동작하게 한다.
import { getMode } from './modes';
import type { ModeId } from './modes';

const pad = (n: number) => String(n).padStart(2, '0');

/** "1:02:03" · "02:03" → 밀리초 */
function toMs(clock: string): number {
  const p = clock.split(':').map(Number);
  const [h, m, s] = p.length === 3 ? p : [0, p[0], p[1]];
  return ((h * 60 + m) * 60 + s) * 1000;
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

// "화자 1  00:12" · "Speaker 2 (01:05)" · "참석자 1 00:00" · "00:12 화자 1" 같은 줄
const HEAD_A = /^\s*(?:화자|참석자|speaker|발화자)\s*(\d+)\s*[\-–·:]?\s*\(?(\d{1,2}:\d{2}(?::\d{2})?)\)?\s*$/i;
const HEAD_B = /^\s*\(?(\d{1,2}:\d{2}(?::\d{2})?)\)?\s*[\-–·]?\s*(?:화자|참석자|speaker|발화자)\s*(\d+)\s*:?\s*$/i;
// 한 줄에 다 붙은 형태: "화자 1 00:12 안녕하세요" / "[00:12] 화자 1: 안녕하세요"
const INLINE = /^\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(?:(?:화자|참석자|speaker|발화자)\s*(\d+)\s*:?)?\s*(.+)$/i;
const INLINE_B = /^\s*(?:화자|참석자|speaker|발화자)\s*(\d+)\s*\(?(\d{1,2}:\d{2}(?::\d{2})?)\)?\s*:?\s+(.+)$/i;

export interface Cleaned {
  body: string; // 정리된 본문 ([mm:ss] 화자 N: …)
  speakers: number;
  durationMs: number; // 마지막 시각 기준 대략 길이
  structured: boolean; // 화자/시각 구조를 알아봤는지
}

/** 받아쓰기 글을 말씀노트 형식 줄로 정리. 구조를 못 알아보면 문단만 정돈해서 그대로 둔다 */
export function cleanTranscript(raw: string): Cleaned {
  const text = raw.replace(/\r\n?/g, '\n').replace(/ /g, ' ').trim();
  const lines = text.split('\n');
  type Seg = { spk?: number; at: number; text: string };
  const segs: Seg[] = [];
  let cur: Seg | null = null;
  let heads = 0;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let m: RegExpMatchArray | null;
    if ((m = t.match(HEAD_A))) {
      if (cur) segs.push(cur);
      cur = { spk: Number(m[1]), at: toMs(m[2]), text: '' };
      heads++;
    } else if ((m = t.match(HEAD_B))) {
      if (cur) segs.push(cur);
      cur = { spk: Number(m[2]), at: toMs(m[1]), text: '' };
      heads++;
    } else if ((m = t.match(INLINE_B))) {
      if (cur) segs.push(cur);
      cur = { spk: Number(m[1]), at: toMs(m[2]), text: m[3].trim() };
      heads++;
    } else if ((m = t.match(INLINE)) && /^\s*\[?\d/.test(t)) {
      if (cur) segs.push(cur);
      cur = { spk: m[2] ? Number(m[2]) : undefined, at: toMs(m[1]), text: m[3].trim() };
      heads++;
    } else if (cur) {
      cur.text += (cur.text ? ' ' : '') + t;
    } else {
      cur = { at: -1, text: t }; // 첫 머리말 앞의 글 (제목 줄일 수 있음)
    }
  }
  if (cur) segs.push(cur);

  if (heads < 2) {
    // 구조 없음: 빈 줄 기준 문단만 정리
    const body = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
    return { body, speakers: 1, durationMs: 0, structured: false };
  }

  // 같은 화자가 이어 말한 줄은 합치기
  const merged: Seg[] = [];
  // 머리말 앞의 짧은 한 줄(예: "음성 003")은 제목이므로 본문에서 뺌
  const list = segs.filter((x) => x.text && !(x.at === -1 && x.text.length <= 40));
  for (const x of list) if (x.at === -1) x.at = 0;
  for (const s of list) {
    const last = merged[merged.length - 1];
    if (last && s.spk !== undefined && last.spk === s.spk) last.text += ' ' + s.text;
    else merged.push({ ...s });
  }
  const spks = new Set(merged.map((s) => s.spk).filter((x) => x !== undefined));
  const body = merged.map((s) => `[${clock(s.at)}] ` + (s.spk !== undefined ? `화자 ${s.spk}: ` : '') + s.text).join('\n\n');
  return { body, speakers: Math.max(1, spks.size), durationMs: merged.length ? merged[merged.length - 1].at : 0, structured: true };
}

/** 공유 글 첫 줄이 제목처럼 보이면 꺼내기 (예: "음성 001", "주일 설교") */
export function guessTitle(raw: string, metaTitle?: string | null): string {
  if (metaTitle && metaTitle.trim()) return metaTitle.trim().slice(0, 60);
  const first = raw.trim().split('\n')[0]?.trim() || '';
  if (first && first.length <= 40 && !/[.!?。]$/.test(first) && !HEAD_A.test(first) && !HEAD_B.test(first) && !/^\[?\d{1,2}:\d{2}/.test(first)) return first;
  return '';
}

export interface MdInput {
  id: string;
  mode: ModeId;
  title: string;
  recordedAt: Date;
  cleaned: Cleaned;
  source: string; // engine 표기 (예: Galaxy AI)
}

/** Apps Script buildMarkdown_ 과 같은 모양의 녹취록 md */
export function buildMarkdown(i: MdInput): { name: string; text: string } {
  const cfg = getMode(i.mode);
  const d = i.recordedAt;
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const title = (i.title || `${cfg.label} 녹음`).replace(/[\r\n]+/g, ' ').trim();
  const fm = [
    '---',
    'app: voice-note',
    'id: ' + i.id,
    'mode: ' + i.mode,
    'category: ' + cfg.label,
    'title: ' + JSON.stringify(title),
    'date: ' + date,
    'recorded_at: ' + d.toISOString(),
    'duration: ' + clock(i.cleaned.durationMs),
    'speakers: ' + i.cleaned.speakers,
    'engine: ' + i.source,
    'audio_file_id: ',
    '---',
  ].join('\n');
  const text = `${fm}\n\n# ${title}\n\n${i.cleaned.body}\n`;
  const safe = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').slice(0, 40).trim();
  return { name: `${date}_${cfg.label}_${safe}.md`, text };
}
