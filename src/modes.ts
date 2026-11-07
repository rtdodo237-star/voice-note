// 녹음 모드 프리셋 — 엔진은 하나, 모드별로 설정만 바꾼다
import { RecordingPresets } from 'expo-audio';
import type { RecordingOptions } from 'expo-audio';

export type ModeId = 'consult' | 'meeting' | 'lecture' | 'sermon';
export type SecurityLevel = 'high' | 'medium' | 'low';

export interface ModeConfig {
  id: ModeId;
  label: string;
  emoji: string;
  color: string;
  description: string;
  diarization: boolean; // 화자분리 사용 여부 (후처리 변환 시 STT 옵션으로 전달)
  keywords: string[]; // STT 키워드 부스팅 사전
  summarySections: string[]; // LLM 요약 시 만들 항목 = md 섹션
  ragCollection: string; // RAG 벡터 저장소 컬렉션명
  security: SecurityLevel;
  consentNotice?: string; // 녹음 시작 전 확인 문구
}

// 성경 66권 (개역개정 표기) — 말씀 모드 키워드 부스팅용
const BIBLE_BOOKS = [
  '창세기', '출애굽기', '레위기', '민수기', '신명기', '여호수아', '사사기', '룻기',
  '사무엘상', '사무엘하', '열왕기상', '열왕기하', '역대상', '역대하', '에스라', '느헤미야',
  '에스더', '욥기', '시편', '잠언', '전도서', '아가', '이사야', '예레미야', '예레미야애가',
  '에스겔', '다니엘', '호세아', '요엘', '아모스', '오바댜', '요나', '미가', '나훔', '하박국',
  '스바냐', '학개', '스가랴', '말라기',
  '마태복음', '마가복음', '누가복음', '요한복음', '사도행전', '로마서', '고린도전서',
  '고린도후서', '갈라디아서', '에베소서', '빌립보서', '골로새서', '데살로니가전서',
  '데살로니가후서', '디모데전서', '디모데후서', '디도서', '빌레몬서', '히브리서', '야고보서',
  '베드로전서', '베드로후서', '요한일서', '요한이서', '요한삼서', '유다서', '요한계시록',
];

const INSURANCE_TERMS = [
  '증권번호', '자동차보험', '대인배상', '대물배상', '자기신체사고', '자동차상해',
  '자기차량손해', '무보험차상해', '긴급출동', '마일리지 특약', '블랙박스 할인', '갱신',
  '만기', '보험료', '특약', '실손', '보장분석', '해지환급금', '납입기간',
  '삼성화재', '현대해상', 'DB손해보험', 'KB손해보험', '메리츠화재', '한화손해보험',
  '롯데손해보험', '흥국화재', '하나손해보험', '캐롯손해보험',
];

export const MODES: ModeConfig[] = [
  {
    id: 'consult',
    label: '상담',
    emoji: '🤝',
    color: '#2563EB',
    description: '고객 대면 상담 · 화자분리',
    diarization: true,
    keywords: INSURANCE_TERMS,
    summarySections: ['고객 니즈', '안내한 내용', '약속사항', '후속조치'],
    ragCollection: 'consult',
    security: 'high',
    consentNotice: '고객에게 상담 내용이 녹음된다는 사실을 안내하셨나요?',
  },
  {
    id: 'meeting',
    label: '회의',
    emoji: '👥',
    color: '#059669',
    description: '여러 명 회의 · 화자분리',
    diarization: true,
    keywords: [],
    summarySections: ['결정사항', '액션아이템', '보류 안건'],
    ragCollection: 'meeting',
    security: 'medium',
    consentNotice: '참석자에게 회의가 녹음된다는 사실을 알리셨나요?',
  },
  {
    id: 'lecture',
    label: '강의',
    emoji: '🎓',
    color: '#D97706',
    description: '강의·세미나 정보수집 · 1인 화자',
    diarization: false,
    keywords: [],
    summarySections: ['3줄 요약', '챕터별 정리', '핵심 개념·용어', '내 질문·메모'],
    ragCollection: 'lecture',
    security: 'low',
    consentNotice: '강사에게 녹음 허락을 받으셨나요?',
  },
  {
    id: 'sermon',
    label: '말씀',
    emoji: '📖',
    color: '#7C3AED',
    description: '설교·말씀 정리 · 성경구절 인식',
    diarization: false,
    keywords: BIBLE_BOOKS,
    summarySections: ['본문', '핵심 메시지', '적용점', '묵상 질문'],
    ragCollection: 'sermon',
    security: 'low',
  },
];

export const getMode = (id: ModeId): ModeConfig =>
  MODES.find((m) => m.id === id) ?? MODES[0];

// 음성 녹음용 설정: 모노 + 문서 폴더 저장(앱 캐시 정리로 지워지지 않음) + 음량 측정
export const VOICE_RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 96000,
  isMeteringEnabled: true,
  directory: 'document',
};

// 백그라운드(화면 꺼짐) 녹음 — 개발 빌드(EAS Build)에서 동작. Expo Go에서는 화면이 켜져 있어야 함
export const ENABLE_BACKGROUND_RECORDING = true;
