// 녹음 엔진 — 마이크 녹음, 일시정지/재개, 음량 파형, 화면 꺼짐 방지, 1초 단위 안전 저장
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModeId } from './modes';
import { appendChunk, finalizeSession, startSession, clearSession } from './db';
import type { Recording } from './db';

export type RecPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

const BAR_COUNT = 40;

/** 기기가 지원하는 녹음 형식 고르기 (아이폰=mp4, 갤럭시·크롬=webm) */
function pickMimeType(): string {
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return '';
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

type WakeLockSentinelLike = { release: () => Promise<void> };

export function useRecorder() {
  const [phase, setPhase] = useState<RecPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(0.04));
  const [interrupted, setInterrupted] = useState(false);
  const [wakeLockOn, setWakeLockOn] = useState(false);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<string | null>(null);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const wakeRef = useRef<WakeLockSentinelLike | null>(null);
  // 경과시간: 일시정지 시간 제외
  const accRef = useRef(0);
  const runStartRef = useRef<number | null>(null);

  const elapsed = useCallback(
    () => accRef.current + (runStartRef.current ? performance.now() - runStartRef.current : 0),
    [],
  );

  // ---- 화면 꺼짐 방지 ----
  const acquireWakeLock = useCallback(async () => {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } })
        .wakeLock;
      if (!wl) {
        setWakeLockOn(false);
        return;
      }
      wakeRef.current = await wl.request('screen');
      setWakeLockOn(true);
    } catch {
      setWakeLockOn(false);
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
    setWakeLockOn(false);
  }, []);

  // ---- 음량 측정 ----
  const startMeter = useCallback((stream: MediaStream) => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      ctx.resume().catch(() => {});
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      audioCtxRef.current = ctx;
      const buf = new Float32Array(analyser.fftSize);
      let last = 0;
      const tick = (t: number) => {
        rafRef.current = requestAnimationFrame(tick);
        setElapsedMs(elapsed());
        if (t - last < 90) return;
        last = t;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const level = Math.max(0.04, Math.min(1, rms * 6));
        const isRunning = recRef.current?.state === 'recording';
        setLevels((prev) => [...prev.slice(1), isRunning ? level : 0.04]);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      /* 파형 없이도 녹음은 동작 */
    }
  }, [elapsed]);

  const stopMeter = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    stopMeter();
    releaseWakeLock();
  }, [releaseWakeLock, stopMeter]);

  // ---- 시작 ----
  const start = useCallback(
    async (mode: ModeId): Promise<void> => {
      if (phase !== 'idle') return;
      setPhase('starting');
      setInterrupted(false);
      accRef.current = 0;
      runStartRef.current = null;
      setElapsedMs(0);
      setLevels(Array(BAR_COUNT).fill(0.04));

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (e) {
        setPhase('idle');
        throw e;
      }
      streamRef.current = stream;

      const mimeType = pickMimeType();
      // 음성용 48kbps: 2시간 녹음도 약 43MB → 받아쓰기 서버 한도(48MB) 안쪽
      const rec = mimeType ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48000 }) : new MediaRecorder(stream);
      const sessionId = newId();
      sessionRef.current = sessionId;
      await startSession({
        id: sessionId,
        mode,
        startedAt: new Date().toISOString(),
        mimeType: rec.mimeType || mimeType || 'audio/webm',
        durationMs: 0,
      });

      rec.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return;
        const ms = elapsed();
        writeQueue.current = writeQueue.current.then(() => appendChunk(sessionId, e.data, ms)).catch(() => {});
      };

      // 전화·다른 앱이 마이크를 가져가 녹음이 끊긴 경우
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (recRef.current && recRef.current.state !== 'inactive') {
            setInterrupted(true);
            try {
              recRef.current.stop();
            } catch {
              /* 무시 */
            }
          }
        };
      });

      recRef.current = rec;
      rec.start(1000); // 1초마다 조각 저장
      runStartRef.current = performance.now();
      startMeter(stream);
      await acquireWakeLock();
      setPhase('recording');
    },
    [acquireWakeLock, elapsed, phase, startMeter],
  );

  const pause = useCallback(() => {
    const rec = recRef.current;
    if (!rec || rec.state !== 'recording') return;
    rec.pause();
    rec.requestData?.();
    accRef.current = elapsed();
    runStartRef.current = null;
    setPhase('paused');
  }, [elapsed]);

  const resume = useCallback(() => {
    const rec = recRef.current;
    if (!rec || rec.state !== 'paused') return;
    rec.resume();
    runStartRef.current = performance.now();
    setPhase('recording');
  }, []);

  /** 녹음 종료 → 저장 대기 상태. 실제 저장은 save()에서 */
  const stop = useCallback(async (): Promise<number> => {
    const rec = recRef.current;
    const total = elapsed();
    accRef.current = total;
    runStartRef.current = null;
    setPhase('stopping');
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        rec.addEventListener('stop', () => resolve(), { once: true });
        rec.stop();
      });
    }
    await writeQueue.current;
    cleanupStream();
    setElapsedMs(total);
    return total;
  }, [cleanupStream, elapsed]);

  const save = useCallback(async (title: string): Promise<Recording | null> => {
    const id = sessionRef.current;
    if (!id) return null;
    await writeQueue.current;
    const rec = await finalizeSession(id, { title, durationMs: accRef.current });
    sessionRef.current = null;
    recRef.current = null;
    setPhase('idle');
    return rec;
  }, []);

  const discard = useCallback(async () => {
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        rec.addEventListener('stop', () => resolve(), { once: true });
        rec.stop();
      });
    }
    await writeQueue.current;
    cleanupStream();
    if (sessionRef.current) await clearSession(sessionRef.current);
    sessionRef.current = null;
    recRef.current = null;
    setPhase('idle');
  }, [cleanupStream]);

  // 화면이 다시 켜지면 화면 꺼짐 방지 재요청 (브라우저가 자동 해제함)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && (phase === 'recording' || phase === 'paused')) {
        acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [acquireWakeLock, phase]);

  // 화면 이탈 시 정리
  useEffect(() => () => cleanupStream(), [cleanupStream]);

  return { phase, elapsedMs, levels, interrupted, wakeLockOn, start, pause, resume, stop, save, discard };
}
