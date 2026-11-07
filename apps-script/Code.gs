/**
 * 녹음 노트 ↔ 구글 드라이브 ↔ VITO 받아쓰기 연결 서버
 *
 * 하는 일
 *  1) 녹음 노트 앱이 드라이브에 녹음을 올릴 수 있게 짧은 업로드 권한을 내줌 (doGet ?action=token)
 *  2) 5분마다 '녹음노트/1_음성' 폴더의 새 녹음을 VITO로 받아쓰기
 *  3) 끝나면 '녹음노트/2_녹취' 폴더에 녹취록 md 저장 → Claude가 말씀노트에 등록
 *
 * 처음 설정 (한 번만)
 *  1) 아래 VITO_CLIENT_ID / VITO_CLIENT_SECRET 에 리턴제로 개발자 콘솔에서 받은 값 붙여넣기
 *  2) 위 함수 선택에서 setup 선택 → 실행 → 권한 허용
 *  3) 실행 로그에 나오는 '연결 키'를 복사해 두기
 *  4) 배포 → 새 배포 → 유형 '웹 앱' → 실행: 나 / 액세스: 모든 사용자 → 배포 → 웹 앱 URL 복사
 *  5) 녹음 노트 앱 → 설정 → '드라이브 연결'에 URL과 연결 키 넣기
 *
 * 권한: 드라이브 전체가 아니라 '이 연결이 만든 파일'만 다뤄요 (drive.file).
 */

// ===== 1) 여기에 VITO 키를 붙여넣으세요 =====
const VITO_CLIENT_ID = '여기에_CLIENT_ID';
const VITO_CLIENT_SECRET = '여기에_CLIENT_SECRET';
// ==========================================

const ROOT_NAME = '녹음노트';
const AUDIO_NAME = '1_음성';
const TEXT_NAME = '2_녹취';
const MAX_SUBMIT_PER_RUN = 3;          // 한 번 실행에 VITO로 보낼 최대 개수
const MAX_SUBMIT_BYTES = 48 * 1024 * 1024; // Apps Script 전송 한도(50MB) 안쪽
const MAX_TRIES = 5;

const MODE = {
  consult: { label: '상담', diarization: true, spk: 2, keywords: [
    '증권번호', '자동차보험', '대인배상', '대물배상', '자기신체사고', '자동차상해', '자기차량손해', '무보험차상해',
    '긴급출동', '마일리지', '블랙박스', '갱신', '만기', '보험료', '특약', '실손', '보장분석', '해지환급금', '납입기간',
    '운전자보험', '자차', '자손', '할인할증', '삼성화재', '현대해상', 'DB손해보험', 'KB손해보험', '메리츠화재',
    '한화손해보험', '롯데손해보험', '흥국화재', '하나손해보험', '캐롯손해보험', '다이렉트'] },
  meeting: { label: '회의', diarization: true, spk: 0, keywords: [] },
  lecture: { label: '강의', diarization: false, spk: 0, keywords: [] },
  sermon: { label: '말씀', diarization: false, spk: 0, keywords: [
    '창세기', '출애굽기', '레위기', '민수기', '신명기', '여호수아', '사사기', '룻기', '사무엘상', '사무엘하',
    '열왕기상', '열왕기하', '역대상', '역대하', '에스라', '느헤미야', '에스더', '욥기', '시편', '잠언', '전도서',
    '아가', '이사야', '예레미야', '예레미야애가', '에스겔', '다니엘', '호세아', '요엘', '아모스', '오바댜', '요나',
    '미가', '나훔', '하박국', '스바냐', '학개', '스가랴', '말라기', '마태복음', '마가복음', '누가복음', '요한복음',
    '사도행전', '로마서', '고린도전서', '고린도후서', '갈라디아서', '에베소서', '빌립보서', '골로새서',
    '데살로니가전서', '데살로니가후서', '디모데전서', '디모데후서', '디도서', '빌레몬서', '히브리서', '야고보서',
    '베드로전서', '베드로후서', '요한일서', '요한이서', '요한삼서', '유다서', '요한계시록', '할렐루야', '아멘'] },
};

/* ================= 처음 설정 ================= */

function setup() {
  const p = PropertiesService.getScriptProperties();
  const rootId = p.getProperty('ROOT_ID') || createFolder_(ROOT_NAME, null);
  const audioId = p.getProperty('AUDIO_ID') || createFolder_(AUDIO_NAME, rootId);
  const textId = p.getProperty('TEXT_ID') || createFolder_(TEXT_NAME, rootId);
  let key = p.getProperty('APP_KEY');
  if (!key) key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40);
  p.setProperties({ ROOT_ID: rootId, AUDIO_ID: audioId, TEXT_ID: textId, APP_KEY: key });

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processQueue')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processQueue').timeBased().everyMinutes(5).create();

  const vitoOk = vitoConfigured_() ? (testVito_() ? '정상' : '키 확인 필요 (로그 참고)') : '아직 입력 안 함';
  Logger.log('===== 설정 완료 =====');
  Logger.log('연결 키: ' + key);
  Logger.log('드라이브 폴더: 내 드라이브 > ' + ROOT_NAME + ' (' + AUDIO_NAME + ', ' + TEXT_NAME + ')');
  Logger.log('VITO 연결: ' + vitoOk);
  Logger.log('다음: 배포 → 새 배포 → 웹 앱(실행: 나, 액세스: 모든 사용자) → URL을 앱에 입력');
}

/** 연결 키를 바꾸고 싶을 때 (기존 기기는 새 키를 다시 입력해야 함) */
function resetKey() {
  PropertiesService.getScriptProperties().deleteProperty('APP_KEY');
  setup();
}

/* ================= 앱이 부르는 주소 ================= */

function doGet(e) {
  const p = PropertiesService.getScriptProperties();
  const q = (e && e.parameter) || {};
  if (!q.key || q.key !== p.getProperty('APP_KEY')) return json_({ ok: false, error: '연결 키가 맞지 않아요.' });

  if (q.action === 'ping') {
    return json_({ ok: true, vito: vitoConfigured_(), folder: ROOT_NAME });
  }
  if (q.action === 'token') {
    // 앱이 드라이브에 녹음을 직접 올리는 데 쓰는 1시간짜리 권한 (이 연결이 만든 파일만 다룰 수 있음)
    // textFolderId: 갤럭시 녹음 앱 등에서 받아쓴 글을 앱이 녹취록(md)으로 바로 저장할 때 사용
    return json_({ ok: true, token: ScriptApp.getOAuthToken(), audioFolderId: p.getProperty('AUDIO_ID'), textFolderId: p.getProperty('TEXT_ID') });
  }
  if (q.action === 'status') {
    const ids = String(q.ids || '').split(',').filter(Boolean).slice(0, 50);
    return json_({ ok: true, items: statusOf_(ids) });
  }
  if (q.action === 'run') {
    processQueue();
    return json_({ ok: true });
  }
  return json_({ ok: false, error: '알 수 없는 요청이에요.' });
}

/* ================= 5분마다 실행 ================= */

function processQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    if (!vitoConfigured_()) { Logger.log('VITO 키가 없어 건너뜀'); return; }
    checkSubmitted_();
    submitNew_();
  } finally {
    lock.releaseLock();
  }
}

/** 새로 올라온 녹음을 VITO에 보내기 */
function submitNew_() {
  const audioId = prop_('AUDIO_ID');
  const files = listFiles_(`'${audioId}' in parents and trashed=false and appProperties has { key='vn_status' and value='uploaded' }`);
  let sent = 0, bytes = 0;
  for (const f of files) {
    if (sent >= MAX_SUBMIT_PER_RUN) break;
    const size = Number(f.size || 0);
    if (size > MAX_SUBMIT_BYTES) {
      setProps_(f.id, { vn_status: 'failed', vn_err: '파일이 너무 커요(48MB 초과). 녹음을 나눠 주세요.' });
      continue;
    }
    if (bytes + size > MAX_SUBMIT_BYTES && sent > 0) break;
    const meta = metaOf_(f);
    const cfg = MODE[meta.mode] || MODE.lecture;
    try {
      const blob = driveFetch_('get', `files/${f.id}?alt=media`).getBlob().setName(f.name);
      const config = {
        model_name: 'sommers', language: 'ko',
        use_diarization: cfg.diarization,
        use_itn: true, use_disfluency_filter: true, use_profanity_filter: false,
        use_paragraph_splitter: true, paragraph_splitter: { max: 50 },
      };
      if (cfg.diarization) config.diarization = { spk_count: cfg.spk };
      if (cfg.keywords.length) config.keywords = cfg.keywords.slice(0, 100);
      const res = UrlFetchApp.fetch('https://openapi.vito.ai/v1/transcribe', {
        method: 'post', headers: { Authorization: 'Bearer ' + vitoToken_() },
        payload: { config: JSON.stringify(config), file: blob }, muteHttpExceptions: true,
      });
      const code = res.getResponseCode(), body = safeJson_(res.getContentText());
      if (code === 200 && body.id) {
        setProps_(f.id, { vn_status: 'submitted', vn_job: body.id, vn_err: '' });
        sent++; bytes += size;
      } else if (code === 429) {
        Logger.log('VITO 한도/동시처리 초과 — 다음 실행 때 다시 시도');
        break;
      } else {
        fail_(f, vitoError_(code, body));
      }
    } catch (err) {
      fail_(f, '보내지 못했어요: ' + err.message);
    }
  }
}

/** 보낸 녹음의 받아쓰기가 끝났는지 확인 */
function checkSubmitted_() {
  const audioId = prop_('AUDIO_ID');
  const files = listFiles_(`'${audioId}' in parents and trashed=false and appProperties has { key='vn_status' and value='submitted' }`);
  for (const f of files) {
    const job = (f.appProperties || {}).vn_job;
    if (!job) { setProps_(f.id, { vn_status: 'uploaded' }); continue; }
    const res = UrlFetchApp.fetch('https://openapi.vito.ai/v1/transcribe/' + job, {
      headers: { Authorization: 'Bearer ' + vitoToken_() }, muteHttpExceptions: true,
    });
    const code = res.getResponseCode(), body = safeJson_(res.getContentText());
    if (code === 410 || code === 404) { setProps_(f.id, { vn_status: 'uploaded', vn_job: '' }); continue; } // 결과 만료 → 다시 보냄
    if (code !== 200) continue;
    if (body.status === 'completed') {
      const meta = metaOf_(f);
      const md = buildMarkdown_(meta, f, (body.results && body.results.utterances) || []);
      const textId = uploadText_(md.name, md.text);
      setProps_(f.id, { vn_status: 'done', vn_text: textId, vn_err: '' });
      Logger.log('완료: ' + md.name);
    } else if (body.status === 'failed') {
      fail_(f, vitoError_(200, body));
    }
  }
}

/* ================= 녹취록 md 만들기 ================= */

function buildMarkdown_(meta, file, utts) {
  const cfg = MODE[meta.mode] || MODE.lecture;
  utts = utts.slice().sort((a, b) => a.start_at - b.start_at);
  const lines = [];
  const spks = new Set();
  if (cfg.diarization) {
    let cur = null;
    for (const u of utts) {
      const text = String(u.msg || '').trim(); if (!text) continue;
      spks.add(u.spk);
      if (cur && cur.spk === u.spk) cur.text += ' ' + text;
      else { if (cur) lines.push(cur); cur = { spk: u.spk, at: u.start_at, text }; }
    }
    if (cur) lines.push(cur);
  } else {
    for (const u of utts) { const text = String(u.msg || '').trim(); if (text) lines.push({ at: u.start_at, text }); }
  }
  const body = lines.map(l => `[${clock_(l.at)}] ` + (cfg.diarization ? `화자 ${Number(l.spk) + 1}: ` : '') + l.text).join('\n\n');
  const rec = new Date(meta.createdAt || file.createdTime || Date.now());
  const date = Utilities.formatDate(rec, 'Asia/Seoul', 'yyyy-MM-dd');
  const title = (meta.title || cfg.label + ' 녹음').replace(/[\r\n]+/g, ' ').trim();
  const fm = [
    '---',
    'app: voice-note',
    'id: ' + (meta.id || file.id),
    'mode: ' + (meta.mode || 'lecture'),
    'category: ' + cfg.label,
    'title: ' + JSON.stringify(title),
    'date: ' + date,
    'recorded_at: ' + rec.toISOString(),
    'duration: ' + clock_(meta.durationMs || 0),
    'speakers: ' + (cfg.diarization ? spks.size : 1),
    'engine: VITO sommers',
    'audio_file_id: ' + file.id,
    '---',
  ].join('\n');
  const text = `${fm}\n\n# ${title}\n\n${body || '(받아쓴 내용이 없어요. 녹음이 비어 있었을 수 있어요.)'}\n`;
  const safe = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').slice(0, 40).trim();
  return { name: `${date}_${cfg.label}_${safe}.md`, text };
}

function clock_(ms) {
  const s = Math.floor(Number(ms || 0) / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const two = n => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(x)}` : `${two(m)}:${two(x)}`;
}

/* ================= 상태 조회 (앱 화면용) ================= */

function statusOf_(recIds) {
  if (!recIds.length) return {};
  const audioId = prop_('AUDIO_ID');
  const files = listFiles_(`'${audioId}' in parents and trashed=false`, 200);
  const out = {};
  for (const f of files) {
    const a = f.appProperties || {};
    if (a.vn_rec && recIds.indexOf(a.vn_rec) >= 0) out[a.vn_rec] = { status: a.vn_status || 'uploaded', error: a.vn_err || '', textId: a.vn_text || '' };
  }
  return out;
}

/* ================= VITO ================= */

function vitoConfigured_() {
  return VITO_CLIENT_ID && VITO_CLIENT_SECRET && VITO_CLIENT_ID.indexOf('여기에') < 0 && VITO_CLIENT_SECRET.indexOf('여기에') < 0;
}

function vitoToken_() {
  const p = PropertiesService.getScriptProperties();
  const tok = p.getProperty('VITO_TOKEN'), exp = Number(p.getProperty('VITO_EXP') || 0);
  if (tok && Date.now() / 1000 < exp - 600) return tok;
  const res = UrlFetchApp.fetch('https://openapi.vito.ai/v1/authenticate', {
    method: 'post', payload: { client_id: VITO_CLIENT_ID, client_secret: VITO_CLIENT_SECRET }, muteHttpExceptions: true,
  });
  const body = safeJson_(res.getContentText());
  if (res.getResponseCode() !== 200 || !body.access_token) throw new Error('VITO 로그인 실패 — 키를 확인해 주세요 (' + res.getResponseCode() + ')');
  let e = Number(body.expire_at || 0);
  if (e > 1e12) e = e / 1000; // 밀리초로 올 경우
  if (!e) e = Date.now() / 1000 + 5 * 3600;
  p.setProperties({ VITO_TOKEN: body.access_token, VITO_EXP: String(e) });
  return body.access_token;
}

function testVito_() {
  try { vitoToken_(); return true; } catch (err) { Logger.log(err.message); return false; }
}

/** 편집기에서 직접 실행해 VITO 키를 확인할 때 */
function testVito() {
  Logger.log(vitoConfigured_() ? (testVito_() ? 'VITO 연결 정상' : 'VITO 키 확인 필요') : 'VITO 키를 먼저 붙여넣어 주세요');
}

function vitoError_(code, body) {
  const c = (body && (body.code || (body.error && body.error.code))) || '';
  const msg = { H0010: '지원하지 않는 녹음 형식이에요(webm 등). 아이폰이나 최신 크롬에서 다시 녹음해 주세요.',
    H0005: '파일이 너무 커요.', H0006: '녹음이 4시간을 넘어요.', A0001: 'VITO 사용량을 넘었어요. 결제 정보를 확인해 주세요.',
    H0002: 'VITO 키가 맞지 않아요.' }[c];
  return msg || ('받아쓰기 실패 (' + code + (c ? ' ' + c : '') + ')');
}

function fail_(f, message) {
  const tries = Number((f.appProperties || {}).vn_tries || 0) + 1;
  const permanent = /형식|너무 커요|4시간|키가/.test(message);
  setProps_(f.id, { vn_status: permanent || tries >= MAX_TRIES ? 'failed' : 'uploaded', vn_err: message.slice(0, 100), vn_tries: String(tries) });
  Logger.log('실패: ' + f.name + ' — ' + message);
}

/* ================= 드라이브 (REST, drive.file 권한) ================= */

function driveFetch_(method, path, body, base) {
  const res = UrlFetchApp.fetch((base || 'https://www.googleapis.com/drive/v3/') + path, {
    method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    contentType: 'application/json', payload: body ? JSON.stringify(body) : undefined, muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error('드라이브 오류 ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  return res;
}

function createFolder_(name, parentId) {
  const body = { name: name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  return JSON.parse(driveFetch_('post', 'files?fields=id', body).getContentText()).id;
}

function listFiles_(q, max) {
  const out = []; let token = '';
  do {
    const path = 'files?pageSize=100&orderBy=createdTime&fields=nextPageToken,files(id,name,size,mimeType,createdTime,description,appProperties)&q=' +
      encodeURIComponent(q) + (token ? '&pageToken=' + token : '');
    const r = JSON.parse(driveFetch_('get', path).getContentText());
    (r.files || []).forEach(f => out.push(f));
    token = r.nextPageToken;
  } while (token && out.length < (max || 100));
  return out;
}

function setProps_(id, props) {
  driveFetch_('patch', `files/${id}?fields=id`, { appProperties: props });
}

function uploadText_(name, text) {
  const boundary = 'vn' + Utilities.getUuid().replace(/-/g, '');
  const meta = { name: name, mimeType: 'text/markdown', parents: [prop_('TEXT_ID')] };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
  const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'post', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    contentType: 'multipart/related; boundary=' + boundary,
    payload: Utilities.newBlob(body).getBytes(), muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error('녹취록 저장 실패 ' + res.getResponseCode());
  return JSON.parse(res.getContentText()).id;
}

/* ================= 도우미 ================= */

function metaOf_(f) {
  const d = safeJson_(f.description || '');
  const a = f.appProperties || {};
  return { id: d.id || a.vn_rec, mode: d.mode || a.vn_mode || 'lecture', title: d.title || '', createdAt: d.createdAt || f.createdTime, durationMs: d.durationMs || 0 };
}

function prop_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('먼저 setup 을 실행해 주세요.');
  return v;
}

function safeJson_(s) { try { return JSON.parse(s); } catch (e) { return {}; } }

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
