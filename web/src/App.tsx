import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MODES, getMode } from './modes';
import type { ModeConfig, ModeId } from './modes';
import { useRecorder } from './useRecorder';
import {
  deleteRecording,
  getRecording,
  listRecordings,
  recoverSessions,
  renameRecording,
  requestPersistentStorage,
} from './db';
import type { RecordingMeta } from './db';
import { extFor, fileStamp, formatDate, formatDuration, formatSize, safeName } from './format';
import { describe, loadSettings, ping, refreshStatus, saveSettings, sendRecording, syncPending } from './sync';

type Screen = { name: 'home' } | { name: 'record' } | { name: 'detail'; id: string } | { name: 'settings' };

/** 말씀노트 (Claude 아티팩트) — 받아쓴 녹음이 정리되어 들어가는 곳 */
const NOTE_APP_URL = 'https://claude.ai/artifact/XHqf2QNp3jx4e7Pt1LwfQC';
type Filter = ModeId | 'all';

const LAST_MODE_KEY = 'voice-note/last-mode';

const readLastMode = (): ModeId => {
  try {
    const v = localStorage.getItem(LAST_MODE_KEY) as ModeId | null;
    return v && MODES.some((m) => m.id === v) ? v : 'consult';
  } catch {
    return 'consult';
  }
};

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [mode, setMode] = useState<ModeId>(readLastMode);
  const [items, setItems] = useState<RecordingMeta[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [consentFor, setConsentFor] = useState<ModeConfig | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [installEvt, setInstallEvt] = useState<InstallPromptEvent | null>(null);
  const [recordMode, setRecordMode] = useState<ModeId>(mode);
  const recorder = useRecorder();

  const refresh = useCallback(async () => setItems(await listRecordings()), []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    (async () => {
      const n = await recoverSessions((m, startedAt) => `${getMode(m).label} ${formatDate(startedAt)} (복구됨)`);
      await refresh();
      if (n > 0) showToast(`중단됐던 녹음 ${n}개를 복구했어요`);
      requestPersistentStorage();
    })();
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, [refresh, showToast]);

  // 드라이브 연결: 못 보낸 녹음 보내기 + 받아쓰기 상태 받아오기 (앱 열 때 · 인터넷 다시 연결될 때 · 1분마다)
  const syncNow = useCallback(async () => {
    if (!loadSettings()) return;
    await syncPending(refresh).catch(() => 0);
    const cur = await listRecordings();
    if (await refreshStatus(cur).catch(() => false)) await refresh();
  }, [refresh]);

  useEffect(() => {
    const t0 = window.setTimeout(syncNow, 1500);
    const iv = window.setInterval(() => document.visibilityState === 'visible' && syncNow(), 60000);
    window.addEventListener('online', syncNow);
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(iv);
      window.removeEventListener('online', syncNow);
    };
  }, [syncNow]);

  const selectMode = (m: ModeId) => {
    setMode(m);
    try {
      localStorage.setItem(LAST_MODE_KEY, m);
    } catch {
      /* 무시 */
    }
  };

  const beginRecording = async (m: ModeId) => {
    setConsentFor(null);
    setMicError(null);
    setRecordMode(m);
    try {
      await recorder.start(m);
      setScreen({ name: 'record' });
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setMicError(
          isIos()
            ? '마이크 권한이 꺼져 있어요. 아이폰 설정 → 앱 → Safari → 마이크를 "허용"으로 바꾼 뒤 다시 시도해 주세요.'
            : '마이크 권한이 꺼져 있어요. 주소창 왼쪽 자물쇠(사이트 설정) → 마이크 → 허용으로 바꾼 뒤 다시 시도해 주세요.',
        );
      } else if (name === 'NotFoundError') {
        setMicError('마이크를 찾을 수 없어요. 마이크가 연결돼 있는지 확인해 주세요.');
      } else {
        setMicError('녹음을 시작할 수 없어요. 다른 앱이 마이크를 쓰고 있지 않은지 확인해 주세요.');
      }
    }
  };

  const onStartTap = () => {
    const m = getMode(mode);
    if (m.consentNotice) setConsentFor(m);
    else beginRecording(m.id);
  };

  return (
    <div className="app">
      {screen.name === 'home' && (
        <Home
          mode={mode}
          onSelectMode={selectMode}
          onStart={onStartTap}
          items={items}
          onOpen={(id) => setScreen({ name: 'detail', id })}
          onSettings={() => setScreen({ name: 'settings' })}
          micError={micError}
          onDismissError={() => setMicError(null)}
          installEvt={installEvt}
          onInstalled={() => setInstallEvt(null)}
        />
      )}

      {screen.name === 'record' && (
        <RecordView
          modeId={recordMode}
          recorder={recorder}
          onSaved={async (id) => {
            await refresh();
            setScreen({ name: 'detail', id });
            const s = loadSettings();
            showToast(s?.auto ? '저장했어요 · 드라이브로 보내는 중' : '저장했어요');
            if (s?.auto) {
              setTimeout(refresh, 300); // '보내는 중' 표시
              sendRecording(id)
                .then(() => showToast('드라이브로 보냈어요 · 곧 받아쓰기를 시작해요'))
                .catch((e) => showToast('드라이브 전송 실패: ' + (e as Error).message))
                .finally(refresh);
            }
          }}
          onDiscarded={() => {
            setScreen({ name: 'home' });
            showToast('녹음을 버렸어요');
          }}
        />
      )}

      {screen.name === 'detail' && (
        <Detail
          id={screen.id}
          onBack={() => setScreen({ name: 'home' })}
          onChanged={refresh}
          onDeleted={async () => {
            await refresh();
            setScreen({ name: 'home' });
            showToast('삭제했어요');
          }}
          onSettings={() => setScreen({ name: 'settings' })}
          showToast={showToast}
          stamp={items}
        />
      )}

      {screen.name === 'settings' && (
        <Settings
          onBack={() => setScreen({ name: 'home' })}
          onSaved={() => {
            setScreen({ name: 'home' });
            showToast('드라이브 연결을 저장했어요');
            syncNow();
          }}
        />
      )}

      {consentFor && (
        <Sheet onClose={() => setConsentFor(null)}>
          <p className="sheet-eyebrow" style={{ color: consentFor.color }}>
            {consentFor.label} 녹음
          </p>
          <h2 className="sheet-title">{consentFor.consentNotice}</h2>
          <div className="sheet-actions">
            <button className="btn ghost" onClick={() => setConsentFor(null)}>
              취소
            </button>
            <button className="btn solid" style={{ background: consentFor.color }} onClick={() => beginRecording(consentFor.id)}>
              네, 녹음 시작
            </button>
          </div>
        </Sheet>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ---------------- 홈 ---------------- */

function Home(props: {
  mode: ModeId;
  onSelectMode: (m: ModeId) => void;
  onStart: () => void;
  items: RecordingMeta[];
  onOpen: (id: string) => void;
  onSettings: () => void;
  micError: string | null;
  onDismissError: () => void;
  installEvt: InstallPromptEvent | null;
  onInstalled: () => void;
}) {
  const { mode, onSelectMode, onStart, items, onOpen, onSettings, micError, onDismissError, installEvt, onInstalled } = props;
  const connected = !!loadSettings();
  const [filter, setFilter] = useState<Filter>('all');
  const [usage, setUsage] = useState<string | null>(null);
  const [hideInstall, setHideInstall] = useState(() => {
    try {
      return localStorage.getItem('voice-note/hide-install') === '1';
    } catch {
      return false;
    }
  });
  const current = getMode(mode);
  const filtered = useMemo(() => (filter === 'all' ? items : items.filter((i) => i.mode === filter)), [filter, items]);

  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((est) => {
        if (est.usage != null) setUsage(formatSize(est.usage));
      })
      .catch(() => {});
  }, [items]);

  const showIosHint = !hideInstall && isIos() && !isStandalone();
  const showAndroidInstall = !hideInstall && !!installEvt && !isStandalone();

  const closeInstall = () => {
    setHideInstall(true);
    try {
      localStorage.setItem('voice-note/hide-install', '1');
    } catch {
      /* 무시 */
    }
  };

  return (
    <main className="page">
      <header className="home-head">
        <div className="head-row">
          <h1 className="brand">녹음 노트</h1>
          <button className={`conn${connected ? ' on' : ''}`} onClick={onSettings}>
            <span className="conn-dot" aria-hidden="true" />
            {connected ? '말씀노트 연결됨' : '말씀노트 연결'}
          </button>
        </div>
        <p className="lede">어떤 자리를 녹음하나요?</p>
      </header>

      {(showIosHint || showAndroidInstall) && (
        <div className="install">
          <div className="install-text">
            <strong>앱처럼 쓰기</strong>
            {showIosHint ? (
              <span>
                Safari 아래 <b>공유 버튼</b> → <b>홈 화면에 추가</b>를 누르면 아이콘으로 바로 열려요.
              </span>
            ) : (
              <span>홈 화면에 설치하면 아이콘으로 바로 열려요.</span>
            )}
          </div>
          <div className="install-actions">
            {showAndroidInstall && (
              <button
                className="btn small solid"
                onClick={async () => {
                  await installEvt!.prompt();
                  onInstalled();
                }}
              >
                설치
              </button>
            )}
            <button className="btn small ghost" onClick={closeInstall} aria-label="안내 닫기">
              닫기
            </button>
          </div>
        </div>
      )}

      <section className="modes" aria-label="녹음 모드">
        {MODES.map((m) => {
          const active = m.id === mode;
          return (
            <button
              key={m.id}
              id={`mode-${m.id}`}
              className={`mode${active ? ' active' : ''}`}
              style={{ '--mode': m.color } as React.CSSProperties}
              aria-pressed={active}
              onClick={() => onSelectMode(m.id)}
            >
              <span className="mode-mark">{m.mark}</span>
              <span className="mode-label">{m.label}</span>
              <span className="mode-desc">{m.description}</span>
            </button>
          );
        })}
      </section>

      {micError && (
        <div className="alert" role="alert">
          <span>{micError}</span>
          <button className="btn small ghost" onClick={onDismissError}>
            확인
          </button>
        </div>
      )}

      <button className="record-cta" style={{ '--mode': current.color } as React.CSSProperties} onClick={onStart}>
        <span className="cta-dot" aria-hidden="true" />
        {current.label} 녹음 시작
      </button>

      <section className="list">
        <div className="list-head">
          <h2>녹음 목록</h2>
          <span className="muted tnum">
            {filtered.length}개{usage ? ` · ${usage} 사용` : ''}
          </span>
        </div>
        <div className="chips" role="tablist">
          {(['all', ...MODES.map((m) => m.id)] as Filter[]).map((f) => (
            <button key={f} role="tab" aria-selected={f === filter} className={`chip${f === filter ? ' on' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? '전체' : getMode(f).label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="empty">
            <p>아직 녹음이 없어요.</p>
            <p className="muted">위에서 모드를 고르고 녹음을 시작하면 여기에 쌓여요.</p>
          </div>
        ) : (
          <ul className="rows">
            {filtered.map((r) => {
              const m = getMode(r.mode);
              const sync = describe(r);
              return (
                <li key={r.id}>
                  <button className="row" onClick={() => onOpen(r.id)}>
                    <span className="tag" style={{ '--mode': m.color } as React.CSSProperties}>
                      {m.label}
                    </span>
                    <span className="row-body">
                      <span className="row-title">{r.title}</span>
                      <span className="row-meta tnum">
                        {formatDate(r.createdAt)} · {formatDuration(r.durationMs)} · {formatSize(r.size)}
                        {r.recovered ? ' · 복구됨' : ''}
                      </span>
                      {sync && <span className={`sync ${sync.tone}`}>{sync.text}</span>}
                    </span>
                    <span className="chev" aria-hidden="true">›</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="foot muted">
        {connected
          ? '녹음은 이 기기에 저장되고, 구글 드라이브로 보내져 받아쓴 뒤 말씀노트에 정리돼요.'
          : '녹음은 이 기기 안에만 저장돼요. 위 “말씀노트 연결”을 하면 자동으로 받아써서 정리해 줘요.'}
      </p>
    </main>
  );
}

/* ---------------- 녹음 ---------------- */

function RecordView(props: {
  modeId: ModeId;
  recorder: ReturnType<typeof useRecorder>;
  onSaved: (id: string) => void;
  onDiscarded: () => void;
}) {
  const { modeId, recorder, onSaved, onDiscarded } = props;
  const m = getMode(modeId);
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const stoppingRef = useRef(false);

  const finish = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    await recorder.stop();
    setTitle(`${m.label} ${formatDate(new Date().toISOString())}`);
    setNaming(true);
  }, [m.label, recorder]);

  // 마이크가 끊기면(전화 등) 지금까지 녹음을 자동으로 마무리
  useEffect(() => {
    if (recorder.interrupted && !naming) finish();
  }, [finish, naming, recorder.interrupted]);

  // 녹음 중 페이지를 닫으려 하면 경고
  useEffect(() => {
    if (naming) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [naming]);

  const save = async () => {
    setSaving(true);
    const rec = await recorder.save(title.trim() || `${m.label} 녹음`);
    setSaving(false);
    if (rec) onSaved(rec.id);
    else onDiscarded();
  };

  const discard = async () => {
    await recorder.discard();
    onDiscarded();
  };

  const style = { '--mode': m.color } as React.CSSProperties;

  if (naming) {
    return (
      <main className="page narrow" style={style}>
        <p className="eyebrow">{m.label}</p>
        <h1 className="done-title">녹음 완료</h1>
        <p className="done-time tnum">{formatDuration(recorder.elapsedMs)}</p>
        {recorder.interrupted && (
          <p className="note">전화나 다른 앱 때문에 마이크가 끊겨서, 그 전까지 녹음된 내용을 저장할게요.</p>
        )}
        <label className="field-label" htmlFor="rec-title">
          {m.titleLabel}
        </label>
        <input
          id="rec-title"
          className="field"
          value={title}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <button className="btn solid block" style={{ background: m.color }} disabled={saving} onClick={save}>
          {saving ? '저장 중…' : '저장'}
        </button>
        {!confirmDiscard ? (
          <button className="btn text danger block" onClick={() => setConfirmDiscard(true)}>
            버리기
          </button>
        ) : (
          <div className="confirm">
            <span>이 녹음을 버릴까요? 되돌릴 수 없어요.</span>
            <div className="confirm-actions">
              <button className="btn small ghost" onClick={() => setConfirmDiscard(false)}>
                취소
              </button>
              <button className="btn small danger-solid" onClick={discard}>
                버리기
              </button>
            </div>
          </div>
        )}
      </main>
    );
  }

  const live = recorder.phase === 'recording';
  const paused = recorder.phase === 'paused';

  return (
    <main className="rec" style={style}>
      <div className="rec-top">
        <span className="eyebrow">{m.label} 모드</span>
      </div>

      <div className="rec-center">
        <div className="status">
          <span className={`status-dot${live ? ' live' : ''}`} />
          {live ? '녹음 중' : paused ? '일시정지' : '준비 중…'}
        </div>
        <div className="timer tnum">{formatDuration(recorder.elapsedMs)}</div>
        <div className={`wave${live ? ' live' : ''}`} aria-hidden="true">
          {recorder.levels.map((lv, i) => (
            <span key={i} style={{ height: `${8 + lv * 72}px` }} />
          ))}
        </div>
        <p className="rec-hint">{m.diarization ? '변환할 때 화자별로 나눠요' : '1인 화자로 변환해요'}</p>
        <p className={`rec-warn${recorder.wakeLockOn ? '' : ' strong'}`}>
          {recorder.wakeLockOn
            ? '화면이 꺼지지 않게 유지 중 · 전원 버튼으로 화면을 끄면 녹음이 멈출 수 있어요'
            : '화면을 켜둔 채로 녹음해 주세요 · 화면이 꺼지면 녹음이 멈출 수 있어요'}
        </p>
      </div>

      <div className="controls">
        <button
          className="round pause"
          aria-label={paused ? '이어서 녹음' : '일시정지'}
          disabled={!live && !paused}
          onClick={() => (paused ? recorder.resume() : recorder.pause())}
        >
          {paused ? '▶' : '❚❚'}
        </button>
        <button className="round stop" aria-label="녹음 종료" disabled={!live && !paused} onClick={finish}>
          <span className="stop-sq" />
        </button>
      </div>
      <p className="controls-label muted">{paused ? '이어서 녹음 · 종료' : '일시정지 · 종료'}</p>
    </main>
  );
}

/* ---------------- 상세 ---------------- */

const RATES = [1, 1.25, 1.5, 2];

function Detail(props: {
  id: string;
  onBack: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  onSettings: () => void;
  showToast: (msg: string) => void;
  /** 목록이 새로고침될 때마다 바뀌는 값 — 백그라운드 전송 결과를 화면에 반영 */
  stamp: unknown;
}) {
  const { id, onBack, onChanged, onDeleted, onSettings, showToast, stamp } = props;
  const [rec, setRec] = useState<Awaited<ReturnType<typeof getRecording>>>(undefined);
  const [url, setUrl] = useState<string | null>(null);
  const [rate, setRate] = useState(1);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    getRecording(id).then((r) => {
      setRec(r);
      if (r) {
        setTitle(r.title);
        objectUrl = URL.createObjectURL(r.blob);
        setUrl(objectUrl);
      }
    });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  // 전송·받아쓰기 상태만 다시 읽기 (재생 중인 오디오는 그대로)
  useEffect(() => {
    getRecording(id).then((r) => r && setRec(r));
  }, [id, stamp]);

  if (!rec) {
    return (
      <main className="page">
        <button className="back" onClick={onBack}>
          ‹ 목록
        </button>
        <p className="muted">불러오는 중…</p>
      </main>
    );
  }

  const m = getMode(rec.mode);
  const fileName = `${safeName(rec.title) || m.label}_${fileStamp(rec.createdAt)}.${extFor(rec.mimeType)}`;

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const skip = (sec: number) => {
    const a = audioRef.current;
    if (a) a.currentTime = Math.max(0, a.currentTime + sec);
  };

  const exportFile = async () => {
    const file = new File([rec.blob], fileName, { type: rec.mimeType });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: rec.title });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    showToast('파일을 다운로드했어요');
  };

  const saveTitle = async () => {
    const t = title.trim();
    if (!t) return;
    await renameRecording(rec.id, t);
    setRec({ ...rec, title: t });
    setEditing(false);
    onChanged();
  };

  return (
    <main className="page" style={{ '--mode': m.color } as React.CSSProperties}>
      <button className="back" onClick={onBack}>
        ‹ 목록
      </button>

      <p className="eyebrow">{m.label}{rec.recovered ? ' · 복구된 녹음' : ''}</p>
      {editing ? (
        <div className="edit-row">
          <input id="detail-title" className="field" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveTitle()} />
          <button className="btn small solid" style={{ background: m.color }} onClick={saveTitle}>
            저장
          </button>
        </div>
      ) : (
        <h1 className="detail-title">
          {rec.title}{' '}
          <button className="btn text small" onClick={() => setEditing(true)}>
            이름 바꾸기
          </button>
        </h1>
      )}
      <p className="muted tnum">
        {formatDate(rec.createdAt)} · {formatDuration(rec.durationMs)} · {formatSize(rec.size)}
      </p>

      <section className="player">
        {url && <audio ref={audioRef} src={url} controls preload="metadata" className="audio" />}
        <div className="player-row">
          <button className="btn small ghost" onClick={() => skip(-15)}>
            -15초
          </button>
          <button className="btn small ghost tnum" onClick={cycleRate}>
            속도 {rate}x
          </button>
          <button className="btn small ghost" onClick={() => skip(15)}>
            +15초
          </button>
        </div>
      </section>

      <button className="btn solid block" style={{ background: m.color }} onClick={exportFile}>
        파일로 내보내기
      </button>
      <p className="hint muted">카카오톡·메일·파일 앱·에어드롭으로 보내거나 저장할 수 있어요.</p>

      <section className="info">
        <h2>텍스트 변환 설정</h2>
        <dl>
          <dt>화자분리</dt>
          <dd>{m.diarization ? '사용' : '사용 안 함 (1인 화자)'}</dd>
          <dt>정리 항목</dt>
          <dd>{m.summarySections.join(' · ')}</dd>
          <dt>저장 위치</dt>
          <dd className="mono">{m.ragCollection}</dd>
        </dl>
      </section>

      <SyncPanel rec={rec} onChanged={async () => { setRec(await getRecording(rec.id)); onChanged(); }} onSettings={onSettings} showToast={showToast} />

      {!confirmDelete ? (
        <button className="btn text danger block" onClick={() => setConfirmDelete(true)}>
          녹음 삭제
        </button>
      ) : (
        <div className="confirm">
          <span>이 녹음을 삭제할까요? 되돌릴 수 없어요.</span>
          <div className="confirm-actions">
            <button className="btn small ghost" onClick={() => setConfirmDelete(false)}>
              취소
            </button>
            <button
              className="btn small danger-solid"
              onClick={async () => {
                await deleteRecording(rec.id);
                onDeleted();
              }}
            >
              삭제
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

/* ---------------- 말씀노트 연결 상태 (상세 화면) ---------------- */

function SyncPanel(props: {
  rec: NonNullable<Awaited<ReturnType<typeof getRecording>>>;
  onChanged: () => void;
  onSettings: () => void;
  showToast: (msg: string) => void;
}) {
  const { rec, onChanged, onSettings, showToast } = props;
  const [progress, setProgress] = useState<number | null>(null);
  const settings = loadSettings();
  const st = describe(rec);

  // 상세 화면을 여는 동안 받아쓰기 상태를 30초마다 확인
  useEffect(() => {
    if (!settings || rec.upload?.status !== 'done') return;
    const check = () => refreshStatus([rec]).then((ch) => ch && onChanged()).catch(() => {});
    check();
    const iv = window.setInterval(check, 30000);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.id, rec.upload?.status, rec.remote?.status]);

  if (!settings) {
    return (
      <section className="sync-panel">
        <h2>말씀노트 연결</h2>
        <p className="muted">연결하면 이 녹음을 자동으로 받아써서 말씀노트에 정리해 넣어요.</p>
        <button className="btn ghost block" onClick={onSettings}>
          연결 설정하기
        </button>
      </section>
    );
  }

  const send = async () => {
    setProgress(0);
    try {
      await sendRecording(rec.id, (r) => setProgress(r));
      showToast('드라이브로 보냈어요 · 곧 받아쓰기를 시작해요');
    } catch (e) {
      showToast('전송 실패: ' + (e as Error).message);
    } finally {
      setProgress(null);
      onChanged();
    }
  };

  const canSend = rec.upload?.status !== 'done' && rec.upload?.status !== 'uploading' && progress === null;
  const failed = rec.remote?.status === 'failed';

  return (
    <section className="sync-panel">
      <h2>말씀노트 연결</h2>
      <ol className="steps">
        <li className={rec.upload?.status === 'done' ? 'ok' : rec.upload?.status === 'error' ? 'err' : 'now'}>
          <b>드라이브 전송</b>
          <span>
            {rec.upload?.status === 'done' ? '완료' : progress !== null ? `보내는 중 ${Math.round(progress * 100)}%` : rec.upload?.status === 'uploading' ? '보내는 중' : rec.upload?.status === 'error' ? rec.upload.error : '대기'}
          </span>
        </li>
        <li className={rec.remote?.status === 'done' ? 'ok' : failed ? 'err' : rec.upload?.status === 'done' ? 'now' : ''}>
          <b>받아쓰기 (VITO)</b>
          <span>
            {rec.remote?.status === 'done' ? '완료' : failed ? rec.remote?.error || '실패' : rec.remote?.status === 'submitted' ? '받아쓰는 중 · 녹음 길이에 따라 수 분' : rec.upload?.status === 'done' ? '5분 안에 시작' : '전송 후 시작'}
          </span>
        </li>
        <li className={rec.remote?.status === 'done' ? 'now' : ''}>
          <b>말씀노트 등록 · AI 정리</b>
          <span>{rec.remote?.status === 'done' ? '1시간 안에 자동 등록돼요' : '받아쓰기 후 자동'}</span>
        </li>
      </ol>
      {progress !== null && (
        <div className="bar" aria-hidden="true">
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      {canSend && (
        <button className="btn solid block" style={{ background: getMode(rec.mode).color }} onClick={send}>
          {rec.upload?.status === 'error' ? '다시 보내기' : '드라이브로 보내기'}
        </button>
      )}
      {st?.tone === 'ok' && (
        <a className="btn ghost block link-btn" href={NOTE_APP_URL} target="_blank" rel="noopener noreferrer">
          말씀노트 열기
        </a>
      )}
    </section>
  );
}

/* ---------------- 연결 설정 ---------------- */

function Settings({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const cur = loadSettings();
  const [url, setUrl] = useState(cur?.url || '');
  const [key, setKey] = useState(cur?.key || '');
  const [auto, setAuto] = useState(cur?.auto ?? true);
  const [check, setCheck] = useState<{ tone: 'ok' | 'err' | 'busy'; text: string } | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const test = async (): Promise<boolean> => {
    const s = { url: url.trim(), key: key.trim(), auto };
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(s.url)) {
      setCheck({ tone: 'err', text: '주소는 https://script.google.com/… 으로 시작하고 /exec 로 끝나야 해요.' });
      return false;
    }
    if (!s.key) {
      setCheck({ tone: 'err', text: '연결 키를 넣어 주세요. (Apps Script setup 실행 로그에 있어요)' });
      return false;
    }
    setCheck({ tone: 'busy', text: '연결 확인 중…' });
    try {
      const r = await ping(s);
      setCheck(
        r.vito
          ? { tone: 'ok', text: `연결됐어요. 드라이브 '${r.folder}' 폴더 · VITO 받아쓰기 준비 완료` }
          : { tone: 'err', text: '연결은 됐지만 VITO 키가 아직 없어요. Apps Script 맨 위에 키를 넣고 setup을 다시 실행해 주세요.' },
      );
      return true;
    } catch (e) {
      setCheck({ tone: 'err', text: (e as Error).message });
      return false;
    }
  };

  const save = async () => {
    if (await test()) {
      saveSettings({ url: url.trim(), key: key.trim(), auto });
      onSaved();
    }
  };

  return (
    <main className="page">
      <button className="back" onClick={onBack}>
        ‹ 돌아가기
      </button>
      <h1 className="detail-title">말씀노트 연결</h1>
      <p className="muted">
        녹음을 구글 드라이브로 보내면 자동으로 받아쓰고(화자 구분 포함), Claude가 말씀노트에 모드별 지침대로 정리해 넣어요.
      </p>

      <label className="field-label" htmlFor="set-url">
        연결 주소 (Apps Script 웹 앱 URL)
      </label>
      <input id="set-url" className="field mono-in" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="https://script.google.com/macros/s/…/exec" value={url} onChange={(e) => setUrl(e.target.value)} />

      <label className="field-label" htmlFor="set-key">
        연결 키
      </label>
      <input id="set-key" className="field mono-in" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="setup 실행 로그의 '연결 키'" value={key} onChange={(e) => setKey(e.target.value)} />

      <label className="toggle" htmlFor="set-auto">
        <input id="set-auto" type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        <span>
          <b>저장하면 바로 드라이브로 보내기</b>
          <small>끄면 녹음 상세 화면에서 직접 보낼 수 있어요</small>
        </span>
      </label>

      {check && <p className={`note-line ${check.tone}`}>{check.text}</p>}

      <div className="row-btns">
        <button className="btn ghost" onClick={test}>
          연결 확인
        </button>
        <button className="btn solid" onClick={save}>
          저장
        </button>
      </div>

      {cur &&
        (!confirmOff ? (
          <button className="btn text danger block" onClick={() => setConfirmOff(true)}>
            이 기기의 연결 끊기
          </button>
        ) : (
          <div className="confirm">
            <span>연결을 끊을까요? 녹음은 그대로 남고, 새 녹음만 드라이브로 가지 않아요.</span>
            <div className="confirm-actions">
              <button className="btn small ghost" onClick={() => setConfirmOff(false)}>
                취소
              </button>
              <button
                className="btn small danger-solid"
                onClick={() => {
                  saveSettings(null);
                  onBack();
                }}
              >
                끊기
              </button>
            </div>
          </div>
        ))}

      <p className="foot muted">연결 주소와 키는 이 기기에만 저장돼요. 맥·아이폰·갤럭시마다 한 번씩 넣어 주세요.</p>
    </main>
  );
}

/* ---------------- 공용 ---------------- */

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
