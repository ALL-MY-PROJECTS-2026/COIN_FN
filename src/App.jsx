import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart } from 'lightweight-charts'
import { BN_URL } from './config.js'

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
  const [err, setErr] = useState('')

  const elRef = useRef(null)
  const chartRef = useRef(null)
  const sRef = useRef({}) // series refs

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
      const [ind, sig] = await Promise.all([
        fetch(`${BN_URL}/api/indicators?${q}`).then((r) => { if (!r.ok) throw new Error(`BN ${r.status}`); return r.json() }),
        fetch(`${BN_URL}/api/signals?${q}`).then((r) => r.ok ? r.json() : { signals: [] }),
      ])
      const candles = ind.candles || []
      if (candles.length === 0) { setData({ candles: [], indicators: null }); setSignals([]); setStatus('empty'); return }
      setData({ candles, indicators: ind.indicators })
      setSignals(sig.signals || [])
      setStatus('ok')
    } catch (e) {
      setErr(String(e.message || e)); setStatus('error')
    }
  }, [market, unit])

  useEffect(() => { load() }, [load])

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
    return () => { chart.remove(); chartRef.current = null; sRef.current = {} }
  }, [theme])

  // 데이터 → 차트
  useEffect(() => {
    const s = sRef.current
    const { candles, indicators } = data
    if (!s.candle || candles.length === 0) return
    const t = (c) => Math.floor(c.timestamp / 1000)
    s.candle.setData(candles.map((c) => ({ time: t(c), open: c.open, high: c.high, low: c.low, close: c.close })))
    s.vol.setData(candles.map((c) => ({ time: t(c), value: c.volume, color: c.close >= c.open ? UP : DOWN })))
    const line = (arr) => arr ? candles.map((c, i) => ({ time: t(c), value: arr[i] })).filter((p) => p.value != null) : []
    s.ema20.setData(show.ema20 && indicators ? line(indicators.ema20) : [])
    s.ema50.setData(show.ema50 && indicators ? line(indicators.ema50) : [])
    s.vwap.setData(show.vwap && indicators ? line(indicators.vwap) : [])
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
  const chg = last && prev ? last.close - prev.close : 0
  const chgPct = last && prev ? (chg / prev.close) * 100 : 0
  const up = chg >= 0
  const rsi = ind?.rsi14?.filter((v) => v != null).slice(-1)[0]

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">COIN <span className="tag">자동매매 · 교육용</span></div>
        <div className="status">
          <span className={`badge ${health ? 'on' : 'off'}`}>BN {health ? '연결' : '끊김'}</span>
          <span className="badge">stage: {health?.stage ?? '-'}</span>
          <span className={`badge ${health?.mode === 'live' ? 'live' : ''}`}>{health?.mode ?? '-'}</span>
          <button className="btn icon" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '다크' : '라이트'}</button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
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
            <div className="last" style={{ color: up ? UP : DOWN }}>{last ? fmt(last.close) : '-'} <span className="won">KRW</span></div>
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

          <div className="panels">
            <div className="panel">
              <div className="panel-h">지표 요약</div>
              <table className="kv"><tbody>
                <tr><th>RSI(14)</th><td>{rsi ?? '-'}</td></tr>
                <tr><th>EMA20</th><td>{fmt(ind?.ema20?.slice(-1)[0])}</td></tr>
                <tr><th>EMA50</th><td>{fmt(ind?.ema50?.slice(-1)[0])}</td></tr>
                <tr><th>VWAP</th><td>{fmt(ind?.vwap?.slice(-1)[0])}</td></tr>
              </tbody></table>
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
