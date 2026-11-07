// 녹음 모드 프리셋 — 앱(네이티브) 버전 src/modes.ts와 같은 내용
export type ModeId = 'consult' | 'meeting' | 'lecture' | 'sermon';

export interface ModeConfig {
  id: ModeId;
  label: string;
  mark: string; // 카드에 쓰는 한 글자 표시
  color: string;
  description: string;
  diarization: boolean;
  summarySections: string[];
  ragCollection: string;
  titleLabel: string;
  consentNotice?: string;
}

export const MODES: ModeConfig[] = [
  {
    id: 'consult',
    label: '상담',
    mark: '상',
    color: '#2563EB',
    description: '고객 대면 상담 · 화자분리',
    diarization: true,
    summarySections: ['고객 상황', '니즈 · 걱정', '안내한 내용', '약속 · 후속조치'],
    ragCollection: 'consult',
    titleLabel: '고객명 / 상담 제목',
    consentNotice: '고객에게 상담 내용이 녹음된다는 사실을 안내하셨나요?',
  },
  {
    id: 'meeting',
    label: '회의',
    mark: '회',
    color: '#059669',
    description: '여러 명 회의 · 화자분리',
    diarization: true,
    summarySections: ['할 일', '결정 사항', '논의 요약', '다음 일정'],
    ragCollection: 'meeting',
    titleLabel: '회의명',
    consentNotice: '참석자에게 회의가 녹음된다는 사실을 알리셨나요?',
  },
  {
    id: 'lecture',
    label: '강의',
    mark: '강',
    color: '#C2410C',
    description: '강의·세미나 정보수집 · 1인 화자',
    diarization: false,
    summarySections: ['3줄 요약', '챕터별 정리', '핵심 개념 · 용어', '적용 · 질문'],
    ragCollection: 'lecture',
    titleLabel: '강의 제목 / 강사',
    consentNotice: '강사에게 녹음 허락을 받으셨나요?',
  },
  {
    id: 'sermon',
    label: '말씀',
    mark: '말',
    color: '#7C3AED',
    description: '설교·말씀 정리 · 성경구절 인식',
    diarization: false,
    summarySections: ['본문과 주제', '말씀 흐름', '사례와 메시지', '핵심 문장', '적용과 기도제목'],
    ragCollection: 'sermon',
    titleLabel: '말씀 제목 / 본문',
  },
];

export const getMode = (id: ModeId): ModeConfig => MODES.find((m) => m.id === id) ?? MODES[0];
