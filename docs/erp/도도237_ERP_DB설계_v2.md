---
title: 도도237 ERP DB 설계 v2
date: 2026-11-11
tags: [ERP, DB설계, 스키마, 아이코원API, n8n, SEO, GEO]
source: 노션 「견적 리뉴얼 DB」(399칸) · 「고객 DB | cer」 · 「도도237 DB 스키마 정리」 · 「데이터 조직도」, 구글 시트(직원별 NEW, 관리센터, 실적보고), 노션 「보험 비교 ERP 마스터 설계도」
excel: 도도237_ERP_DB설계_v2.xlsx (칸 178개 상세)
---

# 도도237 ERP DB 설계 v2

## 1. 한 줄 요약
직원마다 따로 적던 공책(구글 시트)을 **번호로 연결된 장부 13권**으로 바꾼다.
견적 칸은 노션 개발자가 만든 **아이코원 API 이름을 그대로** 쓴다.

## 2. 전 / 후 비교 (쉬운 설명)

| 항목 | 지금 (전) | 바뀐 뒤 (후) | 비유 |
|---|---|---|---|
| 고객 정보 | 직원 시트마다 이름·전화·주민번호를 또 적음 | 고객 명부에 1번, 나머지는 고객 번호만 | 출석부엔 한 번, 성적표엔 번호만 |
| 동명이인 | 「⚠️동명이인 경고」 칸으로 눈 확인 | 고유 번호(customer_id) | 김민준 두 명도 번호가 다름 |
| 차량 | 견적 줄마다 다시 적음 | 차량 등록부, 고객 1명이 여러 대 | 자전거 등록부 |
| 견적 조건 | 메모에 "대물5억 자상2억" 글로 | 담보별 칸 선택 (API 이름) | 메뉴판 체크 주문서 |
| 견적 결과 | 안내 문자 글 안에만 | 보험사 1곳 = 1줄 → 순위·평균 자동 | 일기장 대신 성적표 |
| 진행 상태 | 시트·노션 고객DB(11)·견적DB(7) 이름이 다 다름 | 11단계 하나로 통일 | 전교가 같은 신호등 색 |
| 만기 알림 | 사람이 기억 | D-7/3/1 자동 문자 + 기록 | 알람시계 |
| 정산 | 2%가 숫자로 박힘 | 직원·기간별 비율표 | 벽에 붙인 용돈 규칙 |
| 유입 경로 | 유입번호만 | 채널·utm·처음 본 페이지·AI검색 유입 | 어떤 길로 왔는지 알면 안내판 추가 |
| 개인정보 | 주민번호·계좌·카드·비밀번호가 그대로 | 주민번호·계좌 암호화, 카드·비밀번호 저장 금지 | 열쇠 달린 서랍 |
| 칸 개수 | 노션 견적DB 399칸(수식 151) | 필요한 칸만 178개 | 장난감 상자 정리 |

## 3. 테이블 13개

| 테이블 | 한 줄의 뜻 | 연결 |
|---|---|---|
| customers 고객 | 고객 1명 (계약자·피보험자 모두) | vehicles, quote_requests, contracts |
| vehicles 차량 | 차 1대 | customers, car_models |
| car_models 차명코드 | 개발원 차명코드 | vehicles |
| agents 직원·딜러 | 상담사·설계사·딜러 | commission_rates, quote_requests |
| intake_logs 유입 | 견적 요청 들어온 1건 (모홈·설문·검색…) | customers, agents |
| quote_requests 견적 요청 | 견적 1번 (운전범위·담보·할인·사고 = API 칸) | customers×2, vehicles, agents |
| quote_results 견적 결과 | 보험사 1곳 금액 | quote_requests, insurers |
| insurers 보험사 | 보험사 코드 | quote_results, contracts |
| contracts 계약 | 체결 1건 (증권번호) | quote_requests, settlements |
| commission_rates 정산 비율 | 직원·기간별 % | agents |
| settlements 정산 | 계약 1건 월 정산 (세금·불일치) | contracts, agents |
| message_logs 문자 | 견적안내·만기·후기 발송 기록 | customers |
| content_stats 마케팅 통계 | 익명 집계 (차종×연령대×운전범위) | quote_results 집계 |

```
intake_logs → customers ─┬─ vehicles ─ car_models
                         └─ quote_requests ─ quote_results ─ insurers
                                  └─ contracts ─ settlements ─ commission_rates
message_logs(고객·견적·계약)    content_stats(quote_results 익명 집계)
```

## 4. 견적 요청의 아이코원 API 칸 (노션 견적 리뉴얼 DB에서 가져옴)
- 운전자: carfamily(운전범위), carage(연령한정), lowestjumin, d_jumin, mate_jumin
- 차량: carcode, carname, caryear, cardate, carprice, car_kind, caruse, carnum1~4, lpg
- 담보: dambo1~7, mul_sago, goout1, goout_dist
- 사고·경력: halin, sago1, sago3, car_sago3, ss_sago3, special_code, traffic, guipcarrer, guipcarrer_car
- 할인: tmap_val, bbox, mile1, mile2, drate, drate_num, chung, gps, blue_link
- 기타: divide_num, agree_gb, agree_date, idate, todt, randomCompNum, ret_url

## 5. 진행 상태 통합
잠재고객 → 견적신청 → 보완 → 견적완료 → 안내완료 → (TODAY) → 가입대기 → 체결 → 체결_보완 / 보류 / 미체결
- 「TODAY」는 상태보다 "오늘 할 일" 표시로 바꾸는 것을 권장 (결정 필요)

## 6. 확인 필요 (노란 칸)
- 노션 견적결과 DB의 `dh / sd / dy / sy` 칸이 어느 보험사인지 (hd=현대, ss=삼성, db=DB 확정, lg=KB 추정)
- 운전범위 선택지가 노션 고객DB와 견적DB에서 다름 → 한 목록으로
- `ret_url`: n8n 대신 ERP 주소 사용 — 아이코원 API 계약(월 40만원) 후 확정
- 차명코드 분기별 갱신 방법

## 7. SEO · GEO 마케팅 적용
- **SEO** = 네이버·구글 검색에 잘 나오게 / **GEO** = ChatGPT·Gemini·Perplexity 같은 AI 답변에 우리 회사가 인용되게

| 구분 | 아이디어 | 쓰는 데이터 | 지킬 점 | 우선 |
|---|---|---|---|---|
| SEO | 차종별 보험료 페이지 | content_stats | 견적 30건 이상만 공개, 매달 갱신 | 높음 |
| GEO | AI가 인용할 통계 문장 ("견적 1,240건 분석: 평균 6.3만원 절약") | content_stats | 기준월·표본수·출처 표기 | 높음 |
| SEO+GEO | 약관·용어 Q&A | 노션 교육 자료실, 보험용어 DB | FAQ 구조화데이터, 작성자·검수일 | 높음 |
| GEO | 상담 녹취 → 자주 묻는 질문 | 녹음 노트 앱 녹취록 | 개인정보 제거 | 중간 |
| SEO | 차종 랜딩 /car/genesis-g80 | car_models | 표본 적으면 차종 묶음 | 중간 |
| 지역 | 지역 페이지 + 구글 비즈니스 프로필 | region_sido/sigungu | 건수 많은 지역만 | 중간 |
| 측정 | 글별 견적→체결률, AI 유입 집계 | intake_logs → contracts | utm·referrer 저장 | 높음 |
| 후기 | 체결 14일 후 후기 요청 | message_logs + 동의 | 동의 고객만, 가짜 후기 금지 | 중간 |
| 주의 | 보험 광고 규정 | — | 협회 광고심의 대상인지 게시 전 확인, 익명 집계만 | 필수 |

이를 위해 DB에 추가한 마케팅 칸: `customers.marketing_consent / marketing_consent_at / region_sido / region_sigungu`, `intake_logs.channel / utm_source / utm_campaign / landing_page / referrer`, `content_stats` 테이블 전체.
