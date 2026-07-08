// BN(COIN_BN) 공개 API URL.
// 출처: COIN_BN repo README의 "공개 API URL (Cloudflare Tunnel)".
// BN 서버 재시작 시 URL이 바뀌므로 매 사이클 README 기준으로 갱신한다.
// 로컬 개발 시 VITE_BN_URL 환경변수로 override 가능.
export const BN_URL =
  import.meta.env.VITE_BN_URL ||
  'https://ali-president-persian-well.trycloudflare.com'

// WebSocket URL (https→wss, http→ws)
export const BN_WS = BN_URL.replace(/^http/, 'ws')
