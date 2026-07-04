import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart } from 'lightweight-charts'
import { BN_URL, BN_WS } from './config.js'

const UNITS = [1, 3, 5, 15, 60, 240]
const MARKETS = ['KRW-BTC', 'KRW-ETH', 'KRW-XRP', 'KRW-SOL', 'KRW-DOGE']

// 한국식 캔들: 상승=빨강 / 하락=파랑
const UP = '#c0392b'
const DOWN = '#1f5fbf'
// 신호 마커(행동): 매수=초록 / 매도=빨강 (참고 UI 컨벤션)
const BUY = '#15a34a'
const SELL = '#dc2626'
// 지표선
const C_EMA20 = '#e08e0b'
const C_EMA50 = '#7c3aed'
const C_VWAP = '#0891b2'

const fmt = (n) => (n == null || Number.isNaN(n) ? '-' : Number(n).toLocaleString('ko-KR'))

// 히스토리 병합: 최신 fetch로 꼬리 갱신 / 과거 청크 앞에 붙이기 (candles+indicators 동시)
function mergeTail(hist, recent) {
  if (!hist || !hist.candles.length) return recent
  if (!recent || !recent.candles.length) return hist
  const cut = recent.candles[0].timestamp
  const keep = []
  for (let i = 0; i < hist.candles.length; i++) if (hist.candles[i].timestamp < cut) keep.push(i)
  const pick = (arr) => (arr ? keep.map((i) => arr[i]) : [])
  const candles = keep.map((i) => hist.candles[i]).concat(recent.candles)
  const ind = {}
  for (const k of Object.keys(recent.ind || {})) ind[k] = pick(hist.ind && hist.ind[k]).concat(recent.ind[k])
  return { candles, ind }
}
// 자동매매 조건 라벨(BN strategy 응답 키 → 한글)
const CONDLABEL = {
  rsi_oversold: 'RSI과매도', bb_lower: '볼린저하단', vol_confirm: '거래량', stoch_oversold: '스토캐과매도', macd_golden: 'MACD골든', adx_trend: 'ADX추세',
  rsi_overbought: 'RSI과매수', stoch_overbought: '스토캐과매수', macd_dead: 'MACD데드', bb_upper: '볼린저상단',
}

export default function App() {
  const [market, setMarket] = useState('KRW-BTC')
  const [unit, setUnit] = useState(5)
  const [theme, setTheme] = useState(() => localStorage.getItem('coin_theme') || 'light')
  const [show, setShow] = useState({ ema20: true, ema50: true, vwap: false, bb: false })
  const [strategy, setStrategy] = useState(null)
  const [paper, setPaper] = useState(null)
  const [book, setBook] = useState(null)
  const [trades, setTrades] = useState([])
  const [status, setStatus] = useState('loading')
  const [health, setHealth] = useState(null)
  const [data, setData] = useState({ candles: [], indicators: null })
  const [signals, setSignals] = useState([])
  const [backtest, setBacktest] = useState(null)
  const [regime, setRegime] = useState(null)
  const [err, setErr] = useState('')
  const [live, setLive] = useState(null)      // {price} 실시간 체결가
  const [liveOn, setLiveOn] = useState(false) // WS 연결 여부

  const elRef = useRef(null)
  const rsiElRef = useRef(null)
  const macdElRef = useRef(null)
  const chartRef = useRef(null)
  const sRef = useRef({}) // series refs
  const subRef = useRef({}) // 서브차트(RSI·MACD)
  const barRef = useRef(null) // 형성 중 마지막 봉 {time,open,high,low,close}
  const reqRef = useRef(0) // 최신 로드 요청 id(마켓 전환 레이스 방지)
  const fitKeyRef = useRef('') // fitContent는 마켓/분봉 변경 시에만(주기갱신 시 줌 유지)
  const histRef = useRef({ candles: [], ind: null, key: '' }) // 전체 히스토리(300봉)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('coin_theme', theme)
  }, [theme])

  // BN 헬스체크
  useEffect(() => {
    let alive = true
    fetch(`${BN_URL}/health`).then((r) => r.json()).then((j) => alive && setHealth(j)).catch(() => alive && setHealth(null))
    return () => { alive = false }
  }, [])

  // 페이퍼 계정 폴링(자동매매가 30초마다 갱신 → 20초 폴)
  useEffect(() => {
    let alive = true
    const pull = () => fetch(`${BN_URL}/api/paper`).then((r) => r.ok ? r.json() : null).then((j) => alive && setPaper(j)).catch(() => {})
    pull()
    const id = setInterval(pull, 20000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  // 지표+신호 로드 (비동기 병렬, 4상태)
  const load = useCallback(async () => {
    const myReq = ++reqRef.current       // 이번 요청 id
    barRef.current = null                // 새 데이터 도착 전까지 WS 실시간 갱신 보류(교차오염 방지)
    setStatus('loading'); setErr('')
    try {
      const q = `market=${market}&unit=${unit}&count=200`
      const [ind, sig, bt, rg, st] = await Promise.all([
        fetch(`${BN_URL}/api/indicators?market=${market}&unit=${unit}&count=300`).then((r) => { if (!r.ok) throw new Error(`BN ${r.status}`); return r.json() }),
        fetch(`${BN_URL}/api/strategy-signals?${q}`).then((r) => r.ok ? r.json() : { signals: [] }),
        fetch(`${BN_URL}/api/backtest?${q}`).then((r) => r.ok ? r.json() : { backtest: null }),
        fetch(`${BN_URL}/api/regime?${q}`).then((r) => r.ok ? r.json() : null),
        fetch(`${BN_URL}/api/strategy?${q}`).then((r) => r.ok ? r.json() : null),
      ])
      if (reqRef.current !== myReq) return  // 뒤늦게 온 이전 마켓 응답 무시(레이스 방지)
      const candles = ind.candles || []
      if (candles.length === 0) { setData({ candles: [], indicators: null }); setSignals([]); setBacktest(null); setRegime(null); setStrategy(null); setStatus('empty'); return }
      histRef.current = { candles, ind: ind.indicators, key: `${market}_${unit}` }
      setData({ candles, indicators: ind.indicators })
      setSignals(sig.signals || [])
      setBacktest(bt.backtest || null)
      setRegime(rg)
      setStrategy(st)
      setStatus('ok')
    } catch (e) {
      if (reqRef.current !== myReq) return
      setErr(String(e.message || e)); setStatus('error')
    }
  }, [market, unit])

  useEffect(() => { load() }, [load])

  // 호가 폴링(선택 마켓, 4초) — 업비트 호가/매수·매도벽
  useEffect(() => {
    let alive = true
    const pull = () => {
      fetch(`${BN_URL}/api/orderbook?market=${market}`).then((r) => r.ok ? r.json() : null).then((j) => alive && setBook(j)).catch(() => {})
      fetch(`${BN_URL}/api/trades?market=${market}&count=15`).then((r) => r.ok ? r.json() : null).then((j) => alive && setTrades(j?.trades || [])).catch(() => {})
    }
    pull()
    const id = setInterval(pull, 4000)
    return () => { alive = false; clearInterval(id) }
  }, [market])

  // 실시간 WebSocket — 형성 중 마지막 봉을 체결가로 갱신
  useEffect(() => {
    setLive(null); setLiveOn(false)
    let ws
    let closed = false
    try {
      ws = new WebSocket(`${BN_WS}/ws/ticker?market=${market}`)
    } catch { return }
    const bucketSec = unit * 60
    ws.onopen = () => !closed && setLiveOn(true)
    ws.onclose = () => !closed && setLiveOn(false)
    ws.onerror = () => !closed && setLiveOn(false)
    let lastLive = 0
    ws.onmessage = (ev) => {
      if (closed) return
      let m
      try { m = JSON.parse(ev.data) } catch { return }
      const price = m.price
      if (price == null) return
      const now = (m.ts ?? 0) || performance.now()
      if (now - lastLive > 500) { lastLive = now; setLive({ price }) } // React 리렌더 스로틀
      const cs = sRef.current.candle
      const bar = barRef.current
      if (!cs || !bar) return
      const tsSec = Math.floor((m.ts ?? Date.now()) / 1000)
      const bucket = Math.floor(tsSec / bucketSec) * bucketSec
      let next
      if (bucket > bar.time) {
        next = { time: bucket, open: price, high: price, low: price, close: price }
      } else {
        next = { time: bar.time, open: bar.open, high: Math.max(bar.high, price), low: Math.min(bar.low, price), close: price }
      }
      barRef.current = next
      try { cs.update(next) } catch { /* 차트 재생성 타이밍 무시 */ }
    }
    return () => { closed = true; try { ws && ws.close() } catch { /* noop */ } }
  }, [market, unit])

  // 주기적 지표 갱신(8초) — 최근 200봉으로 꼬리 갱신(과거 히스토리는 유지), 줌 유지
  useEffect(() => {
    let alive = true
    const my = reqRef.current
    const key = `${market}_${unit}`
    const tick = async () => {
      try {
        const ind = await fetch(`${BN_URL}/api/indicators?market=${market}&unit=${unit}&count=200`).then((r) => (r.ok ? r.json() : null))
        if (!alive || !ind || reqRef.current !== my || histRef.current.key !== key) return
        const recent = { candles: ind.candles || [], ind: ind.indicators }
        if (!recent.candles.length) return
        const merged = mergeTail(histRef.current, recent)
        histRef.current = { ...histRef.current, candles: merged.candles, ind: merged.ind }
        setData({ candles: merged.candles, indicators: merged.ind }) // setData가 표시범위 자동 유지
      } catch { /* noop */ }
    }
    const id = setInterval(tick, 8000)
    return () => { alive = false; clearInterval(id) }
  }, [market, unit])

  // 차트 생성 (테마 변경 시 재생성)
  useEffect(() => {
    if (!elRef.current) return
    const dark = theme === 'dark'
    const chart = createChart(elRef.current, {
      layout: { background: { color: dark ? '#161b22' : '#ffffff' }, textColor: dark ? '#e6edf3' : '#333', fontFamily: 'inherit' },
      grid: { vertLines: { color: dark ? '#222833' : '#eef1f5' }, horzLines: { color: dark ? '#222833' : '#eef1f5' } },
      rightPriceScale: { borderColor: dark ? '#2a313c' : '#d0d0d0', minimumWidth: 88 },
      timeScale: { borderColor: dark ? '#2a313c' : '#d0d0d0', timeVisible: true },
      autoSize: true,
    })
    const candle = chart.addCandlestickSeries({ upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN })
    const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' })
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })
    const ema20 = chart.addLineSeries({ color: C_EMA20, lineWidth: 1 })
    const ema50 = chart.addLineSeries({ color: C_EMA50, lineWidth: 1 })
    const vwap = chart.addLineSeries({ color: C_VWAP, lineWidth: 1, lineStyle: 2 })
    const bbU = chart.addLineSeries({ color: '#9aa4b2', lineWidth: 1 })
    const bbM = chart.addLineSeries({ color: '#9aa4b2', lineWidth: 1, lineStyle: 2 })
    const bbL = chart.addLineSeries({ color: '#9aa4b2', lineWidth: 1 })
    chartRef.current = chart
    sRef.current = { candle, vol, ema20, ema50, vwap, bbU, bbM, bbL }

    // 서브차트: RSI · MACD (메인과 시간축 동기)
    const mkSub = (el) => createChart(el, {
      layout: { background: { color: dark ? '#161b22' : '#ffffff' }, textColor: dark ? '#8b949e' : '#666', fontFamily: 'inherit' },
      grid: { vertLines: { color: dark ? '#222833' : '#eef1f5' }, horzLines: { color: dark ? '#222833' : '#eef1f5' } },
      rightPriceScale: { borderColor: dark ? '#2a313c' : '#d0d0d0', minimumWidth: 88 },
      timeScale: { borderColor: dark ? '#2a313c' : '#d0d0d0', timeVisible: true },
      crosshair: { horzLine: { visible: false } }, // 세로선만(가로선 잔상 방지)
      // autoSize는 서브차트 초기 사이징에 실패(canvas 버퍼 300x150 고정) → 아래 수동 리사이즈 사용
    })
    const rsiChart = mkSub(rsiElRef.current)
    const rsiLine = rsiChart.addLineSeries({ color: '#8b5cf6', lineWidth: 1 })
    rsiLine.createPriceLine({ price: 70, color: UP, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '70' })
    rsiLine.createPriceLine({ price: 30, color: DOWN, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '30' })
    const macdChart = mkSub(macdElRef.current)
    const macdHist = macdChart.addHistogramSeries({})
    const macdLine = macdChart.addLineSeries({ color: '#2563eb', lineWidth: 1 })
    const macdSig = macdChart.addLineSeries({ color: '#e08e0b', lineWidth: 1 })
    subRef.current = { rsiChart, macdChart, rsiLine, macdHist, macdLine, macdSig }
    if (import.meta.env.DEV) window.__charts = { chart, rsiChart, macdChart }

    // 서브차트 수동 리사이즈: 컨테이너 실측 크기로 canvas 버퍼를 맞춤(autoSize 대체)
    const sizeSub = () => {
      for (const [el, c] of [[rsiElRef.current, rsiChart], [macdElRef.current, macdChart]]) {
        if (!el || !c) continue
        const w = Math.floor(el.clientWidth), h = Math.floor(el.clientHeight)
        if (w > 0 && h > 0) { try { c.resize(w, h) } catch { /* noop */ } }
      }
    }
    const subRO = new ResizeObserver(sizeSub)
    if (rsiElRef.current) subRO.observe(rsiElRef.current)
    if (macdElRef.current) subRO.observe(macdElRef.current)
    requestAnimationFrame(sizeSub)  // 초기 강제 사이징(레이아웃 확정 후)

    // 시간축(가로 스크롤·줌) 동기화 — 어느 차트를 조작해도 3개가 같이 움직임
    const allCharts = [chart, rsiChart, macdChart]
    const syncRange = (src) => (r) => {
      if (!r) return
      for (const c of allCharts) {
        if (c === src) continue
        try { c.timeScale().setVisibleLogicalRange(r) } catch { /* noop */ }
      }
    }
    for (const c of allCharts) c.timeScale().subscribeVisibleLogicalRangeChange(syncRange(c))

    // 크로스헤어(세로선) 동기화 — 한 차트에 마우스 올리면 3개에 같은 시각 세로선
    const pairs = [[chart, candle], [rsiChart, rsiLine], [macdChart, macdHist]]
    const syncCross = (src) => (param) => {
      for (const [c, series] of pairs) {
        if (c === src) continue
        if (param.time === undefined || !param.point) { try { c.clearCrosshairPosition() } catch { /* noop */ } continue }
        try { c.setCrosshairPosition(0, param.time, series) } catch { /* noop */ }
      }
    }
    for (const [c] of pairs) c.subscribeCrosshairMove(syncCross(c))

    return () => {
      subRO.disconnect()
      chart.remove(); rsiChart.remove(); macdChart.remove()
      chartRef.current = null; sRef.current = {}; subRef.current = {}
    }
  }, [theme])

  // 데이터 → 차트
  useEffect(() => {
    const s = sRef.current
    const { candles, indicators } = data
    if (!s.candle || candles.length === 0) return
    const t = (c) => Math.floor(c.timestamp / 1000)
    s.candle.setData(candles.map((c) => ({ time: t(c), open: c.open, high: c.high, low: c.low, close: c.close })))
    const lc = candles[candles.length - 1]
    barRef.current = { time: t(lc), open: lc.open, high: lc.high, low: lc.low, close: lc.close }
    s.vol.setData(candles.map((c) => ({ time: t(c), value: c.volume, color: c.close >= c.open ? UP : DOWN })))
    const line = (arr) => arr ? candles.map((c, i) => ({ time: t(c), value: arr[i] })).filter((p) => p.value != null) : []
    s.ema20.setData(show.ema20 && indicators ? line(indicators.ema20) : [])
    s.ema50.setData(show.ema50 && indicators ? line(indicators.ema50) : [])
    s.vwap.setData(show.vwap && indicators ? line(indicators.vwap) : [])
    s.bbU.setData(show.bb && indicators ? line(indicators.bbUpper) : [])
    s.bbM.setData(show.bb && indicators ? line(indicators.bbMid) : [])
    s.bbL.setData(show.bb && indicators ? line(indicators.bbLower) : [])

    // 서브차트: RSI · MACD
    // ★ 전체 캔들 시간대를 whitespace(값 없는 시간점)로 채워 시간축을 메인과 동일하게 →
    //   워밍업으로 앞부분 값이 없어도 세 패널의 시간 범위가 일치해 세로선이 정렬됨.
    const ws = (arr) => candles.map((c, i) => (arr[i] == null ? { time: t(c) } : { time: t(c), value: arr[i] }))
    const wsHist = (arr) => candles.map((c, i) => (arr[i] == null ? { time: t(c) } : { time: t(c), value: arr[i], color: arr[i] >= 0 ? UP : DOWN }))
    const sub = subRef.current
    if (sub.rsiLine && indicators) {
      sub.rsiLine.setData(ws(indicators.rsi14))
      sub.macdHist.setData(wsHist(indicators.macdHist))
      sub.macdLine.setData(ws(indicators.macd))
      sub.macdSig.setData(ws(indicators.macdSignal))
    }
    // 마켓/분봉 바뀔 때만 전체 히스토리 맞춤(fit). 갱신 시엔 setData가 표시범위 자동 유지
    const fitKey = `${market}_${unit}`
    if (fitKeyRef.current !== fitKey) {
      chartRef.current?.timeScale().fitContent()
      subRef.current.rsiChart?.timeScale().fitContent()
      subRef.current.macdChart?.timeScale().fitContent()
      fitKeyRef.current = fitKey
    }
  }, [data, show, market, unit])

  // 마커 전용 효과(신호·페이퍼 체결) — 무거운 전체 redraw 없이 setMarkers만(렌더 최적화)
  useEffect(() => {
    const s = sRef.current
    if (!s.candle) return
    const strat = signals.map((m) => ({
      time: Math.floor(m.timestamp / 1000),
      position: m.type === 'buy' ? 'belowBar' : 'aboveBar',
      color: m.type === 'buy' ? BUY : SELL,
      shape: m.type === 'buy' ? 'arrowUp' : 'arrowDown',
      text: '신호',
    }))
    const pm = []
    if (paper) {
      for (const t of (paper.trades || [])) {
        if (t.market !== market) continue
        if (t.entryTs) pm.push({ time: Math.floor(t.entryTs / 1000), position: 'belowBar', color: BUY, shape: 'circle', text: '체결매수' })
        if (t.exitTs) pm.push({ time: Math.floor(t.exitTs / 1000), position: 'aboveBar', color: SELL, shape: 'circle', text: `체결매도 ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct}%` })
      }
      for (const p of (paper.positions || [])) {
        if (p.market !== market || !p.entryTs) continue
        pm.push({ time: Math.floor(p.entryTs / 1000), position: 'belowBar', color: BUY, shape: 'circle', text: '체결매수(보유중)' })
      }
    }
    try { s.candle.setMarkers([...strat, ...pm].sort((a, b) => a.time - b.time)) } catch { /* noop */ }
  }, [signals, paper, market, data, theme])

  const candles = data.candles
  const ind = data.indicators
  const last = candles[candles.length - 1]
  const prev = candles[candles.length - 2]
  // 로딩 중(마켓 전환 직후)엔 실시간가 미사용 — 이전 마켓 캔들과 섞여 튀는 것 방지
  const curPrice = (status === 'ok' && live?.price != null) ? live.price : last?.close
  const chg = curPrice != null && prev ? curPrice - prev.close : 0
  const chgPct = curPrice != null && prev ? (chg / prev.close) * 100 : 0
  const up = chg >= 0
  const rsi = ind?.rsi14?.filter((v) => v != null).slice(-1)[0]

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">COIN <span className="tag">자동매매 · 교육용</span></div>
        <div className="status">
          <span className={`badge ${health ? 'on' : 'off'}`}>BN {health ? '연결' : '끊김'}</span>
          <span className={`badge ${liveOn ? 'on' : 'off'}`}>{liveOn ? '● 실시간' : '○ 실시간'}</span>
          <span className="badge">stage: {health?.stage ?? '-'}</span>
          <span className={`badge ${health?.mode === 'live' ? 'live' : ''}`}>{health?.mode ?? '-'}</span>
          <button className="btn icon" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '다크' : '라이트'}</button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          {regime && (
            <div className="regime-card">
              <div className="rg-title">시장국면</div>
              <div className={`rg-label rg-${regime.regime}`}>{regime.label}</div>
              <div className="rg-adx">ADX {regime.adx ?? '-'}</div>
              <div className="rg-rec">{regime.recommend}</div>
            </div>
          )}
          {paper && (
            <div className="regime-card">
              <div className="rg-title">페이퍼 계정 <span style={{ color: paper.halted ? SELL : (paper.autotrader?.running ? BUY : 'var(--muted)') }}>{paper.halted ? '■ 낙폭정지' : (paper.autotrader?.running ? '● 자동' : '○ 정지')}</span></div>
              <div className="rg-label" style={{ color: paper.totalReturnPct >= 0 ? UP : DOWN, fontSize: 16 }}>
                {paper.totalReturnPct >= 0 ? '+' : ''}{paper.totalReturnPct}%
              </div>
              <div className="rg-adx">평가 {fmt(paper.equity)}원 <span style={{ color: 'var(--muted)', fontWeight: 400 }}>낙폭 {paper.drawdownPct}%</span></div>
              <div className="rg-rec">실현 {fmt(paper.realizedPnl)} · 미실현 {fmt(paper.unrealizedPnl)} · {paper.tradeCount}거래</div>
              {paper.risk && (
                <div className="rg-rec" style={{ marginTop: 3 }}>리스크: 손절 {paper.risk.stopPct}% · 트레일 {paper.risk.trailPct}% · 익절 {paper.risk.targetPct}% · 정지 {paper.risk.maxDdPct}%</div>
              )}
              {paper.positions?.length > 0 && (
                <div className="rg-rec" style={{ marginTop: 3 }}>보유: {paper.positions.map((p) => `${p.market.replace('KRW-', '')} ${p.unrealizedPct}% (손절 ${fmt(p.stop)})`).join(', ')}</div>
              )}
            </div>
          )}
          <div className="side-title">관심종목</div>
          <ul className="watchlist">
            {MARKETS.map((m) => (
              <li key={m} className={`wl-item ${m === market ? 'sel' : ''}`} onClick={() => setMarket(m)}>{m}</li>
            ))}
          </ul>
          <div className="side-title">지표</div>
          <div className="toggles">
            {[['ema20', 'EMA20', C_EMA20], ['ema50', 'EMA50', C_EMA50], ['vwap', 'VWAP', C_VWAP], ['bb', '볼린저밴드', '#9aa4b2']].map(([k, label, c]) => (
              <label key={k} className="tg"><input type="checkbox" checked={show[k]} onChange={() => setShow((s) => ({ ...s, [k]: !s[k] }))} /><span className="dot" style={{ background: c }} />{label}</label>
            ))}
          </div>
        </aside>

        <main className="main">
          <div className="pricebar">
            <div className="pair">{market}</div>
            <div className="last" style={{ color: up ? UP : DOWN }}>{curPrice != null ? fmt(curPrice) : '-'} <span className="won">KRW</span></div>
            <div className="chg" style={{ color: up ? UP : DOWN }}>{last && prev ? `${up ? '▲' : '▼'} ${up ? '+' : ''}${fmt(Math.round(chg))} (${chgPct.toFixed(2)}%)` : ''}</div>
            <div className="spacer" />
            <div className="units">
              {UNITS.map((u) => <button key={u} className={`btn u ${u === unit ? 'sel' : ''}`} onClick={() => setUnit(u)}>{u}분</button>)}
              <button className="btn" onClick={load}>새로고침</button>
            </div>
          </div>

          <div className="chart-wrap">
            {status === 'loading' && <div className="overlay">불러오는 중…</div>}
            {status === 'error' && <div className="overlay err">BN 오류: {err}</div>}
            {status === 'empty' && <div className="overlay">데이터 없음</div>}
            <div ref={elRef} className="chart" />
          </div>

          <div className="subpane">
            <div className="sub-h"><span className="dot" style={{ background: '#8b5cf6' }} />RSI(14)</div>
            <div ref={rsiElRef} className="sub-chart" />
          </div>
          <div className="subpane">
            <div className="sub-h"><span className="dot" style={{ background: '#2563eb' }} />MACD <span className="dot" style={{ background: '#e08e0b' }} />Signal <span className="mut">(12·26·9)</span></div>
            <div ref={macdElRef} className="sub-chart" />
          </div>

          <div className="panels">
            <div className="panel">
              <div className="panel-h">자동매매 판정 <span className="cnt">{strategy?.mode ?? '-'}</span></div>
              {strategy?.ready ? (
                <div className="strat">
                  <div className={`strat-decide d-${strategy.decision}`}>
                    {strategy.decision === 'buy' ? '▲ 매수' : strategy.decision === 'sell' ? '▼ 매도' : '― 보류'}
                  </div>
                  <div className="mut" style={{ padding: '2px 10px' }}>
                    매수({strategy.buy.logic}): {Object.entries(strategy.buy.conditions).map(([k, v]) => `${CONDLABEL[k] || k} ${v ? '✓' : '·'}`).join(' · ') || '조건 없음'}
                  </div>
                  <div className="mut" style={{ padding: '2px 10px' }}>
                    매도({strategy.sell.logic}): {Object.entries(strategy.sell.conditions).map(([k, v]) => `${CONDLABEL[k] || k} ${v ? '✓' : '·'}`).join(' · ') || '조건 없음'}
                  </div>
                  <div className="mut" style={{ padding: '4px 10px', borderTop: '1px solid var(--panel2)' }}>RSI {strategy.values.rsi} · ADX {strategy.values.adx} · Stoch {strategy.values.stochK} · 거래량 {strategy.values.volRatio}배</div>
                </div>
              ) : (<div className="empty" style={{ padding: 12 }}>{strategy?.reason ?? '-'}</div>)}
            </div>
            <div className="panel">
              <div className="panel-h">거래 대시보드 <span className="cnt">{paper?.mode ?? '-'}</span></div>
              {paper ? (
                <div>
                  <table className="kv"><tbody>
                    <tr><th>평가금액</th><td>{fmt(paper.equity)}원</td></tr>
                    <tr><th>총수익률</th><td style={{ color: paper.totalReturnPct >= 0 ? UP : DOWN }}>{paper.totalReturnPct >= 0 ? '+' : ''}{paper.totalReturnPct}%</td></tr>
                    <tr><th>실현손익</th><td style={{ color: paper.realizedPnl >= 0 ? UP : DOWN }}>{fmt(paper.realizedPnl)}원</td></tr>
                    <tr><th>승률 · 거래수</th><td>{paper.winRate != null ? `${paper.winRate}% (${paper.byMarket?.reduce((s, b) => s + b.wins, 0) ?? 0}승 ${paper.tradeCount - (paper.byMarket?.reduce((s, b) => s + b.wins, 0) ?? 0)}패)` : '청산 전'} · {paper.tradeCount}건</td></tr>
                  </tbody></table>
                  {paper.equityHist?.length > 1 && (() => {
                    const h = paper.equityHist, W = 240, H = 44, base = 1000000;
                    const ys = h.map(p => p.equity), lo = Math.min(base, ...ys), hi = Math.max(base, ...ys), rng = hi - lo || 1;
                    const x = i => (i / (h.length - 1)) * W, y = v => H - ((v - lo) / rng) * H;
                    const d = h.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.equity).toFixed(1)}`).join(' ');
                    const last = ys[ys.length - 1], up = last >= base;
                    return (
                      <div style={{ padding: '4px 10px 8px' }}>
                        <div className="panel-sub" style={{ padding: '2px 0', border: 0 }}>자산 추이 ({h.length}포인트 · 5분)</div>
                        <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', height: 44 }}>
                          <line x1="0" y1={y(base)} x2={W} y2={y(base)} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" />
                          <path d={d} fill="none" stroke={up ? UP : DOWN} strokeWidth="1.5" />
                        </svg>
                      </div>
                    );
                  })()}
                  <div className="panel-sub">현재 보유 (뭘 샀나)</div>
                  {paper.positions?.length > 0 ? (
                    <div className="log">
                      {paper.positions.map((p, i) => (
                        <div key={i} className="log-row">
                          <span className="lt">{p.market.replace('KRW-', '')}</span>
                          <span className="lr">진입 {fmt(p.entry)}</span>
                          <span className="lp" style={{ color: p.unrealizedPct >= 0 ? UP : DOWN }}>{p.unrealizedPct >= 0 ? '+' : ''}{p.unrealizedPct}%</span>
                        </div>
                      ))}
                    </div>
                  ) : (<div className="empty" style={{ padding: 8 }}>보유 없음</div>)}
                  {paper.byMarket?.length > 0 && (
                    <>
                      <div className="panel-sub">종목별 집계</div>
                      <div className="log">
                        {paper.byMarket.map((b, i) => (
                          <div key={i} className="log-row"><span className="lt">{b.market.replace('KRW-', '')}</span><span className="lr">{b.count}거래 · {b.wins}승</span><span className="lp" style={{ color: b.pnl >= 0 ? UP : DOWN }}>{fmt(b.pnl)}원</span></div>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="panel-sub">매매 로그 (매수·매도 전체{paper.eventCount ? ` · ${paper.eventCount}건` : ''})</div>
                  {paper.events?.length > 0 ? (
                    <div className="log">
                      {paper.events.slice().reverse().map((e, i) => (
                        <div key={i} className="log-row">
                          <span className="ly" style={{ color: e.type === 'buy' ? UP : DOWN }}>{e.type === 'buy' ? '매수' : '매도'}</span>
                          <span className="lt">{e.market.replace('KRW-', '')}</span>
                          <span className="lr">{e.ts ? new Date(e.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : ''}{e.reason ? ` ${e.reason}` : ''}</span>
                          <span className="lp">{fmt(e.price)}{e.type === 'sell' && e.pnl != null ? <span style={{ color: e.pnl >= 0 ? UP : DOWN }}> {e.pnl >= 0 ? '+' : ''}{fmt(e.pnl)}</span> : ''}</span>
                        </div>
                      ))}
                    </div>
                  ) : (<div className="empty" style={{ padding: 10 }}>매매 기록 없음</div>)}
                  <div className="panel-sub">거래 내역 (청산 완료)</div>
                  {paper.trades?.length > 0 ? (
                    <div className="log">
                      {paper.trades.slice().reverse().map((t, i) => (
                        <div key={i} className="log-row">
                          <span className="lt">{t.market.replace('KRW-', '')}</span>
                          <span className="lr">{fmt(t.entry)}→{fmt(t.exit)}</span>
                          <span className="lp" style={{ color: t.pnl >= 0 ? UP : DOWN }}>{t.pnl >= 0 ? '+' : ''}{fmt(t.pnl)}원 ({t.pnlPct >= 0 ? '+' : ''}{t.pnlPct}%)</span>
                        </div>
                      ))}
                    </div>
                  ) : (<div className="empty" style={{ padding: 10 }}>아직 청산된 거래 없음 (보유 중이거나 대기)</div>)}
                </div>
              ) : (<div className="empty" style={{ padding: 12 }}>-</div>)}
            </div>
            <div className="panel">
              <div className="panel-h">최근 체결 <span className="cnt">업비트</span></div>
              <div className="log">
                {trades.length === 0 && <div className="empty">-</div>}
                {trades.slice(0, 8).map((t, i) => (
                  <div key={i} className="log-row">
                    <span className="lt">{(t.time || '').slice(0, 8)}</span>
                    <span className="lp" style={{ color: t.side === 'bid' ? UP : DOWN }}>{fmt(t.price)}</span>
                    <span className="lr" style={{ textAlign: 'right' }}>{Number(t.volume).toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel">
              <div className="panel-h">호가 <span className="cnt">업비트</span></div>
              {book?.units?.length ? (
                <div className="book">
                  {book.units.slice(0, 5).reverse().map((u, i) => (
                    <div key={`a${i}`} className="book-row"><span className="bk-p" style={{ color: UP }}>{fmt(u.ask_price)}</span><span className="bk-s ask">{u.ask_size.toFixed(3)}</span></div>
                  ))}
                  {book.units.slice(0, 5).map((u, i) => (
                    <div key={`b${i}`} className="book-row"><span className="bk-p" style={{ color: DOWN }}>{fmt(u.bid_price)}</span><span className="bk-s bid">{u.bid_size.toFixed(3)}</span></div>
                  ))}
                </div>
              ) : (<div className="empty" style={{ padding: 12 }}>-</div>)}
            </div>
            <div className="panel">
              <div className="panel-h">지표 요약</div>
              <table className="kv"><tbody>
                <tr><th>RSI(14)</th><td>{rsi ?? '-'}</td></tr>
                <tr><th>ADX(14)</th><td>{ind?.adx14?.filter((v) => v != null).slice(-1)[0] ?? '-'}</td></tr>
                <tr><th>스토캐스틱 %K/%D</th><td>{ind?.stochK?.filter((v) => v != null).slice(-1)[0] ?? '-'} / {ind?.stochD?.filter((v) => v != null).slice(-1)[0] ?? '-'}</td></tr>
                <tr><th>EMA20</th><td>{fmt(ind?.ema20?.slice(-1)[0])}</td></tr>
                <tr><th>EMA50</th><td>{fmt(ind?.ema50?.slice(-1)[0])}</td></tr>
                <tr><th>VWAP</th><td>{fmt(ind?.vwap?.slice(-1)[0])}</td></tr>
              </tbody></table>
            </div>
            <div className="panel">
              <div className="panel-h">백테스트 <span className="cnt">비용차감</span></div>
              {backtest && backtest.trades > 0 ? (
                <table className="kv"><tbody>
                  <tr><th>거래수</th><td>{backtest.trades}</td></tr>
                  <tr><th>승률</th><td>{backtest.winRatePct}%</td></tr>
                  <tr><th>총수익</th><td style={{ color: backtest.totalReturnPct >= 0 ? UP : DOWN }}>{backtest.totalReturnPct >= 0 ? '+' : ''}{backtest.totalReturnPct}%</td></tr>
                  <tr><th>손익비(PF)</th><td>{backtest.profitFactor ?? '-'}</td></tr>
                  <tr><th>MDD</th><td style={{ color: DOWN }}>{backtest.maxDrawdownPct}%</td></tr>
                </tbody></table>
              ) : (
                <div className="empty" style={{ padding: 14 }}>{backtest ? `왕복거래 없음 (신호 매수/${backtest.buySignals} 매도/${backtest.sellSignals})` : '-'}</div>
              )}
            </div>
            <div className="panel grow">
              <div className="panel-h">신호 로그 <span className="cnt">{signals.length}</span></div>
              <div className="log">
                {signals.length === 0 && <div className="empty">신호 없음</div>}
                {signals.slice().reverse().slice(0, 8).map((m, i) => (
                  <div key={i} className="log-row">
                    <span className="lt">{m.time.slice(5, 16).replace('T', ' ')}</span>
                    <span className="ly" style={{ color: m.type === 'buy' ? BUY : SELL }}>{m.type === 'buy' ? '▲매수' : '▼매도'}</span>
                    <span className="lp">{fmt(m.price)}</span>
                    <span className="lr">{m.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>

      <footer className="foot">데이터: 업비트(BN 경유) · 신호는 교육용 평균회귀(수익 보장 아님) · paper · BN {BN_URL.replace('https://', '')}</footer>
    </div>
  )
}
