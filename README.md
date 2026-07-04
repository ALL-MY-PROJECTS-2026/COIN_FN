# COIN_FN — 코인 자동매매 프론트엔드 (React · KRDS 스타일)

코인 자동매매 웹의 **프론트엔드**. React + Vite, 차트는 lightweight-charts.
백엔드([COIN_BN](https://github.com/ALL-MY-PROJECTS-2026/COIN_BN))와는 **별개 repo**이며 **비동기 REST/WebSocket**으로만 연결합니다.

## 🌐 배포 (GitHub Pages)
```
https://all-my-projects-2026.github.io/COIN_FN/
```

## 🔗 BN 연결
- BN 공개 URL은 [COIN_BN README](https://github.com/ALL-MY-PROJECTS-2026/COIN_BN#-공개-api-url-cloudflare-tunnel)의 Cloudflare Tunnel 주소를 사용.
- 현재 설정: `src/config.js`의 `BN_URL` (환경변수 `VITE_BN_URL`로 override 가능).
- BN 서버 재시작 시 URL이 바뀌므로 매 사이클 BN README 기준으로 갱신.

## 디자인 원칙 (UI_GUIDE.md)
- 한국 정부 표준 **KRDS**(전자정부 UI가이드 승계) 톤: 평면·각짐(border-radius 0)·1px 실선·무채색.
- **상승=빨강 / 하락=파랑**(한국식) + 부호(▲▼) 병기(색맹 대응).
- 안티-AI룩: 그라디언트·글래스·네온·이모지 금지. KWCAG 접근성.

## 현재 화면
- 실시간 캔들 차트(마켓·분봉 전환) + 거래량 · 현재가/등락 · BN 연결/모드 배지

## 로컬 실행
```bash
npm install
npm run dev      # http://localhost:5173/COIN_FN/
npm run build    # dist/
npm run deploy   # gh-pages 브랜치로 배포
```

## 구조
```
src/
├── main.jsx     엔트리
├── App.jsx      대시보드(헬스체크·캔들 로드·차트)
├── config.js    BN_URL (COIN_BN README 기준)
└── styles.css   KRDS 토큰(--r:0, 상승 빨강/하락 파랑)
```

> 작업 루프: [FN_LOOP_PROMPT.md](FN_LOOP_PROMPT.md) · UI 가이드: [UI_GUIDE.md](UI_GUIDE.md) · 이력: [작업완료보고.md](작업완료보고.md)
