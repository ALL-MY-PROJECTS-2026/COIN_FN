# FN 루프 — UI 개선 플레이북 (어떻게 루프 돌며 UI를 개선할까)

> 조사: 트레이딩 대시보드 UX 모범사례 + 한국 정부 디자인표준(KRDS/KWCAG) + React 성능(2026-07 웹 조사).
> 목적: FN 루프가 매 사이클 "무엇을·어떻게" 개선할지 판단하는 기준·백로그.
> 원칙 충돌 시 우선순위: **정직·기능·접근성(관공서 톤) > 화려함**. 단 금융 컨벤션 1개(상승/하락 색)는 지킨다.

---

## 0. 디자인 노스스타 (한 줄)
"**관공서 업무화면처럼 절제됐지만, 트레이더가 한눈에 상태를 읽는 화면**" — KRDS의 평면·각짐·고대비·표중심을 따르되, 금융 대시보드의 정보위계(가격 크게·보조지표 작게)와 상승/하락 색 컨벤션만 차용.

---

## 1. 검증된 트레이딩 대시보드 UX 원칙

### 정보 위계 (Information Hierarchy)
- 실시간 가격·총자산·순손익은 **크고 고대비 타이포**로 최상단. 거래량·시가 등 보조지표는 **작고 옅게**. [extej][lollypop]
- 사용자가 "가장 중요한 것"을 즉시 구분하도록 폰트 크기·색·그룹핑으로 시각적 무게 배분. [wildnetedge]

### 색 컨벤션 (절대 어기지 말 것)
- 금융 플랫폼은 보편적으로 **상승/하락을 색으로 구분** — 미적 이유로도 어기면 신뢰 즉시 붕괴. [extej]
- ★ 한국 컨벤션: **상승=빨강, 하락=파랑**(서구 green/red의 반대). 국내 사용자 기준 이걸 따른다.
- 접근성: 색만으로 구분 금지 → **색 + 부호(+/−)·화살표 병기**(색맹 대응, KWCAG).

### 데이터 밀도 (Data Density)
- 밀도는 사용자에 따라 다름: Bloomberg류는 최대밀도, 리테일은 **점진적 공개(progressive disclosure) + 여백**. [medium-20][companionlink]
- 개인 봇 대시보드 = 리테일 쪽 → 핵심 지표 먼저, 상세는 접기/탭/드릴다운.

### 레이아웃 패턴
- **카드 기반**: 카드마다 하나의 지표/데이터셋, 카드 안 미니그래프로 추세 일별. [multipurposethemes]
- 단, KRDS 톤 유지 위해 카드는 **둥근모서리·그림자 없이 1px 실선 구획**으로.

### 사용자 컨트롤
- 명확한 내비/검색/클릭 요소로 섹션 이동. **대시보드 커스터마이즈**(원하는 정보 배치)는 통제감·몰입 향상. [multipurposethemes]

---

## 2. 한국 정부 디자인 표준 (KRDS / KWCAG) — eGov 후속

### KRDS (Korea Design System)
- 2025.1 범정부 UI/UX 디자인 시스템 정식공개 — **옛 전자정부 표준프레임워크 UI 가이드·부처별 가이드를 통합·승계**. 디자인 토큰/컴포넌트/마크업을 한 곳에서 버전관리. [krds][namu]
- → 우리 "eGov 스타일" 요구는 실질적으로 **KRDS 준수**로 해석. 토큰 기반·표준 컴포넌트·접근성 우선.

### KWCAG 접근성 (법적 기준)
- 텍스트-배경 **명도대비 4.5:1 이상**(매직넘버: 50=4.5:1, 70=7:1). [a11ykr][oh-my-design]
- 폼: `label` + `aria-describedby`로 명확 안내, 오류는 **구체적·접근가능한 메시지**. [a11ykr]
- 공공 수준 = WCAG 2.1 AA 동등 이상(장차법·KS X OT 0003). [uxkm]

### 우리 규칙으로 고정
- border-radius 0 지향(--r:0~2px), 그라디언트·글래스·네온·과한 그림자·이모지·일러스트 금지(안티-AI룩).
- 색·여백·테두리는 CSS 변수(토큰)만. 무채색 + 상승/하락색.

---

## 3. React / 기술 선택

### 차트
- **lightweight-charts**(TradingView) — 금융 특화, Canvas 렌더로 캔들·거래량 고성능. 트레이딩 차트 1순위. [openweb][syncfusion]
- 대안: react-financial-charts, Apache ECharts(유연·대규모). [querio][embeddable]

### 실시간 성능
- `React.memo`·`useCallback`으로 데이터 안 바뀐 자식 리렌더 차단. [openweb]
- 차트·무거운 분석 모듈은 **해당 화면 진입 시에만 lazy load**. [openweb]
- WS 업데이트는 상태 배칭/throttle로 과리렌더 방지.

---

## 4. FN 루프 운영 방식 (매 사이클 어떻게)

### 사이클 판단 순서
1. **백로그(§5)에서 1건 선택** — "지금 사용자가 못 쓰거나 헷갈리는 것"을 우선.
2. 산출물 유형 명시: A(구축) / B(스타일·접근성) / C(통합·반응형).
3. 구현 → 프리뷰 검증(mobile375·tablet768·desktop1280 + 다크/라이트).
4. **금지스타일 잔재 0**(radius·그림자·그라디언트) + **대비 4.5:1** + **상승/하락 색+부호** 확인.
5. FN.md 보고 + 커밋.

### "개선"의 정의 (무엇을 좋게 만드나)
- 읽는 속도(정보위계) · 오해 방지(색·부호·라벨) · 조작 안전(위험버튼 확인) · 접근성(대비·키보드·aria) · 반응형(모바일 사용성) · 성능(리렌더·로딩).
- ❌ 단순 "예뻐 보이려는" 장식 변경은 개선 아님(안티-AI룩 원칙).

---

## 5. UI 백로그 (이 앱 화면별 구체 개선 항목)

### 차트 영역
- [ ] lightweight-charts 캔들 + 거래량 + 지표 오버레이(이동평균·볼린저·RSI·MACD, 값은 BN)
- [ ] 매수/매도/손절 마커(▲▼✕, 색+글리프)
- [ ] 분/시/일봉 전환 탭(각진·표준 탭), 심볼 검색

### 포지션·자산 패널
- [ ] 총자산·순손익 **크게 고대비**, 보유코인 표(평단·수량·평가손익 색+부호)
- [ ] 실시간 손익률 갱신(throttle), 색맹 대응 부호 병기

### 컨트롤 바 (★안전)
- [ ] 자동매매 ON/OFF 토글 + **현재 모드(paper/live) 뚜렷한 배지**(live는 경고색)
- [ ] 수동 매수/매도 버튼(주문 전 확인 다이얼로그)
- [ ] **긴급 전체청산·킬스위치** — 위험버튼은 확인 2단계

### 로그·상태
- [ ] 거래 로그 표(시각·심볼·방향·체결가·손익), 모바일 전체폭 줄바꿈
- [ ] 봇 상태(연결·WS·마지막 신호·에러) 상태줄
- [ ] 백테스트 요약(승률·손익비·MDD, 비용 차감 명시)

### 공통
- [ ] 다크/라이트 토글(localStorage), 토큰 일관성
- [ ] 로딩/빈상태/에러 상태 카피(막연한 스피너 금지, 무슨 상태인지)
- [ ] 반응형: 사이드바 모바일 접기, 차트 풀폭, 터치타깃 ≥40px
- [ ] 접근성: 폼 label·aria, 대비 4.5:1, 키보드 이동/포커스

---

## 6. 체크리스트 (매 커밋 전)
- [ ] mobile/tablet/desktop + 다크/라이트 렌더 정상, 콘솔 에러 0
- [ ] border-radius·그림자·그라디언트·네온·이모지 잔재 0
- [ ] 텍스트 대비 ≥ 4.5:1
- [ ] 상승/하락 = 색(빨강/파랑) + 부호(+/−) 병기
- [ ] 위험 동작(청산·live 전환)에 확인 단계
- [ ] 신호/주문/계산은 BN API 결과 표시만(프론트 재구현 아님)
- [ ] FN.md에 검증 결과·미검증 항목 명기

---

## 참고 소스
- [extej] 크립토/금융 대시보드 UI/UX — https://medium.com/@extej/the-importance-of-intuitive-ui-ux-design-in-crypto-finance-dashboards-98be2b1a1f6f
- [lollypop] Trading App Design Guide 2026 — https://lollypop.design/blog/2026/june/trading-app-design/
- [wildnetedge] Fintech UX 대시보드 10 모범사례 — https://www.wildnetedge.com/blogs/fintech-ux-design-best-practices-for-financial-dashboards
- [multipurposethemes] 크립토 대시보드 설계 — https://multipurposethemes.com/blog/designing-a-modern-crypto-dashboard-key-features-and-best-practices/
- [companionlink] 크립토 봇 UI/UX 모범사례 — https://www.companionlink.com/blog/2025/01/crypto-bot-ui-ux-design-best-practices/amp/
- [krds] KRDS 범정부 디자인 시스템 — https://www.krds.go.kr/
- [oh-my-design] KRDS 색·타이포·토큰 — https://oh-my-design.kr/design-systems/krds
- [a11ykr] KWCAG 2.2 — https://a11ykr.github.io/kwcag22/
- [uxkm] KWCAG 접근성 — https://uxkm.io/accessibility/a11y/04-a11yCag/02-kwcag
- [openweb] 고성능 React 트레이딩 대시보드 — https://openwebsolutions.in/blog/high-performance-trading-dashboard-react-websockets/
- [syncfusion] React 주식 차트 라이브러리 — https://www.syncfusion.com/blogs/post/top-5-react-stock-charts-in-2026
- [querio] React 차트 라이브러리 2026 — https://querio.ai/articles/top-react-chart-libraries-data-visualization
