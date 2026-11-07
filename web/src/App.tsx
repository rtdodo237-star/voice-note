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

type Screen = { name: 'home' } | { name: 'record' } | { name: 'detail'; id: string };
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
            showToast('저장했어요');
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
          showToast={showToast}
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
  micError: string | null;
  onDismissError: () => void;
  installEvt: InstallPromptEvent | null;
  onInstalled: () => void;
}) {
  const { mode, onSelectMode, onStart, items, onOpen, micError, onDismissError, installEvt, onInstalled } = props;
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
        <h1 className="brand">녹음 노트</h1>
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
                    </span>
                    <span className="chev" aria-hidden="true">›</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="foot muted">녹음은 이 기기 안에만 저장돼요. 다른 기기로 옮기려면 녹음을 열고 “파일로 내보내기”를 누르세요.</p>
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
  showToast: (msg: string) => void;
}) {
  const { id, onBack, onChanged, onDeleted, showToast } = props;
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
        <button className="btn ghost block" disabled>
          텍스트로 변환 · 다음 단계에서 연결
        </button>
      </section>

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
