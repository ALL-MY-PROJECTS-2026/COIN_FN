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

export default function App() {
  const [market, setMarket] = useState('KRW-BTC')
  const [unit, setUnit] = useState(5)
  const [theme, setTheme] = useState(() => localStorage.getItem('coin_theme') || 'light')
  const [show, setShow] = useState({ ema20: true, ema50: true, vwap: false })
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

  // 지표+신호 로드 (비동기 병렬, 4상태)
  const load = useCallback(async () => {
    setStatus('loading'); setErr('')
    try {
      const q = `market=${market}&unit=${unit}&count=200`
      const [ind, sig, bt, rg] = await Promise.all([
        fetch(`${BN_URL}/api/indicators?${q}`).then((r) => { if (!r.ok) throw new Error(`BN ${r.status}`); return r.json() }),
        fetch(`${BN_URL}/api/signals?${q}`).then((r) => r.ok ? r.json() : { signals: [] }),
        fetch(`${BN_URL}/api/backtest?${q}`).then((r) => r.ok ? r.json() : { backtest: null }),
        fetch(`${BN_URL}/api/regime?${q}`).then((r) => r.ok ? r.json() : null),
      ])
      const candles = ind.candles || []
      if (candles.length === 0) { setData({ candles: [], indicators: null }); setSignals([]); setBacktest(null); setRegime(null); setStatus('empty'); return }
      setData({ candles, indicators: ind.indicators })
      setSignals(sig.signals || [])
      setBacktest(bt.backtest || null)
      setRegime(rg)
      setStatus('ok')
    } catch (e) {
      setErr(String(e.message || e)); setStatus('error')
    }
  }, [market, unit])

  useEffect(() => { load() }, [load])

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
    ws.onmessage = (ev) => {
      if (closed) return
      let m
      try { m = JSON.parse(ev.data) } catch { return }
      const price = m.price
      if (price == null) return
      setLive({ price })
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

  // 차트 생성 (테마 변경 시 재생성)
  useEffect(() => {
    if (!elRef.current) return
    const dark = theme === 'dark'
    const chart = createChart(elRef.current, {
      layout: { background: { color: dark ? '#161b22' : '#ffffff' }, textColor: dark ? '#e6edf3' : '#333', fontFamily: 'inherit' },
      grid: { vertLines: { color: dark ? '#222833' : '#eef1f5' }, horzLines: { color: dark ? '#222833' : '#eef1f5' } },
      rightPriceScale: { borderColor: dark ? '#2a313c' : '#d0d0d0' },
      timeScale: { borderColor: dark ? '#2a313c' : '#d0d0d0', timeVisible: true },
      autoSize: true,
    })
    const candle = chart.addCandlestickSeries({ upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN })
    const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' })
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })
    const ema20 = chart.addLineSeries({ color: C_EMA20, lineWidth: 1 })
    const ema50 = chart.addLineSeries({ color: C_EMA50, lineWidth: 1 })
    const vwap = chart.addLineSeries({ color: C_VWAP, lineWidth: 1, lineStyle: 2 })
    chartRef.current = chart
    sRef.current = { candle, vol, ema20, ema50, vwap }

    // 서브차트: RSI · MACD (메인과 시간축 동기)
    const mkSub = (el) => createChart(el, {
      layout: { background: { color: dark ? '#161b22' : '#ffffff' }, textColor: dark ? '#8b949e' : '#666', fontFamily: 'inherit' },
      grid: { vertLines: { color: dark ? '#222833' : '#eef1f5' }, horzLines: { color: dark ? '#222833' : '#eef1f5' } },
      rightPriceScale: { borderColor: dark ? '#2a313c' : '#d0d0d0' },
      timeScale: { borderColor: dark ? '#2a313c' : '#d0d0d0', timeVisible: true },
      autoSize: true,
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

    const sync = (r) => {
      if (!r) return
      try { rsiChart.timeScale().setVisibleLogicalRange(r); macdChart.timeScale().setVisibleLogicalRange(r) } catch { /* noop */ }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(sync)

    return () => {
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

    // 서브차트: RSI · MACD
    const sub = subRef.current
    if (sub.rsiLine && indicators) {
      sub.rsiLine.setData(line(indicators.rsi14))
      sub.macdHist.setData(candles.map((c, i) => ({ time: t(c), value: indicators.macdHist[i], color: indicators.macdHist[i] >= 0 ? UP : DOWN })).filter((p) => p.value != null))
      sub.macdLine.setData(line(indicators.macd))
      sub.macdSig.setData(line(indicators.macdSignal))
      sub.rsiChart.timeScale().fitContent()
      sub.macdChart.timeScale().fitContent()
    }
    // 신호 마커
    s.candle.setMarkers(signals.map((m) => ({
      time: Math.floor(m.timestamp / 1000),
      position: m.type === 'buy' ? 'belowBar' : 'aboveBar',
      color: m.type === 'buy' ? BUY : SELL,
      shape: m.type === 'buy' ? 'arrowUp' : 'arrowDown',
      text: m.type === 'buy' ? '매수' : '매도',
    })))
    chartRef.current?.timeScale().fitContent()
  }, [data, signals, show])

  const candles = data.candles
  const ind = data.indicators
  const last = candles[candles.length - 1]
  const prev = candles[candles.length - 2]
  const curPrice = live?.price ?? last?.close   // 실시간 체결가 우선
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
          <div className="side-title">관심종목</div>
          <ul className="watchlist">
            {MARKETS.map((m) => (
              <li key={m} className={`wl-item ${m === market ? 'sel' : ''}`} onClick={() => setMarket(m)}>{m}</li>
            ))}
          </ul>
          <div className="side-title">지표</div>
          <div className="toggles">
            {[['ema20', 'EMA20', C_EMA20], ['ema50', 'EMA50', C_EMA50], ['vwap', 'VWAP', C_VWAP]].map(([k, label, c]) => (
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
              <div className="panel-h">지표 요약</div>
              <table className="kv"><tbody>
                <tr><th>RSI(14)</th><td>{rsi ?? '-'}</td></tr>
                <tr><th>ADX(14)</th><td>{ind?.adx14?.filter((v) => v != null).slice(-1)[0] ?? '-'}</td></tr>
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
                {signals.slice().reverse().map((m, i) => (
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
