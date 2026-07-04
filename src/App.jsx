import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createChart } from 'lightweight-charts'
import { BN_URL } from './config.js'

// 업비트가 지원하는 분봉 단위 (BN /api/candles 계약)
const UNITS = [1, 3, 5, 15, 60, 240]
const MARKETS = ['KRW-BTC', 'KRW-ETH', 'KRW-XRP', 'KRW-SOL']

// KRDS 톤 + 한국식 상승=빨강/하락=파랑
const UP = '#c0392b'   // 상승 빨강
const DOWN = '#1f5fbf' // 하락 파랑

function fmtKRW(n) {
  if (n == null || Number.isNaN(n)) return '-'
  return n.toLocaleString('ko-KR')
}

export default function App() {
  const [market, setMarket] = useState('KRW-BTC')
  const [unit, setUnit] = useState(5)
  const [status, setStatus] = useState('loading') // loading | ok | empty | error
  const [health, setHealth] = useState(null)
  const [candles, setCandles] = useState([])
  const [err, setErr] = useState('')

  const chartElRef = useRef(null)
  const chartRef = useRef(null)
  const candleSeriesRef = useRef(null)
  const volSeriesRef = useRef(null)

  // BN 헬스체크 (연결 상태 배지)
  useEffect(() => {
    let alive = true
    fetch(`${BN_URL}/health`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => alive && setHealth(j))
      .catch(() => alive && setHealth(null))
    return () => { alive = false }
  }, [])

  // 캔들 로드 (비동기: loading/ok/empty/error 4상태)
  const loadCandles = useCallback(async () => {
    setStatus('loading')
    setErr('')
    try {
      const url = `${BN_URL}/api/candles?market=${market}&unit=${unit}&count=200`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`BN ${res.status}`)
      const data = await res.json()
      const list = data.candles || []
      if (list.length === 0) { setCandles([]); setStatus('empty'); return }
      setCandles(list)
      setStatus('ok')
    } catch (e) {
      setErr(String(e.message || e))
      setStatus('error')
    }
  }, [market, unit])

  useEffect(() => { loadCandles() }, [loadCandles])

  // 차트 1회 생성
  useEffect(() => {
    if (!chartElRef.current || chartRef.current) return
    const chart = createChart(chartElRef.current, {
      layout: { background: { color: '#ffffff' }, textColor: '#333333', fontFamily: 'inherit' },
      grid: { vertLines: { color: '#eeeeee' }, horzLines: { color: '#eeeeee' } },
      rightPriceScale: { borderColor: '#cccccc' },
      timeScale: { borderColor: '#cccccc', timeVisible: true },
      autoSize: true,
    })
    const candleSeries = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN,
      wickUpColor: UP, wickDownColor: DOWN,
    })
    const volSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' }, priceScaleId: '',
    })
    volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volSeriesRef.current = volSeries
    return () => { chart.remove(); chartRef.current = null }
  }, [])

  // 데이터 → 차트 반영
  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return
    const cd = candles.map((c) => ({
      time: Math.floor(c.timestamp / 1000),
      open: c.open, high: c.high, low: c.low, close: c.close,
    }))
    const vd = candles.map((c) => ({
      time: Math.floor(c.timestamp / 1000),
      value: c.volume,
      color: c.close >= c.open ? UP : DOWN,
    }))
    candleSeriesRef.current.setData(cd)
    volSeriesRef.current.setData(vd)
    chartRef.current?.timeScale().fitContent()
  }, [candles])

  const last = candles[candles.length - 1]
  const prev = candles[candles.length - 2]
  const change = last && prev ? last.close - prev.close : 0
  const changePct = last && prev ? (change / prev.close) * 100 : 0
  const up = change >= 0

  const connected = !!health
  const mode = health?.mode ?? '-'

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">COIN · 자동매매 대시보드</div>
        <div className="status">
          <span className={`badge ${connected ? 'on' : 'off'}`}>
            BN {connected ? '연결됨' : '끊김'}
          </span>
          <span className={`badge mode ${mode === 'live' ? 'live' : ''}`}>모드: {mode}</span>
        </div>
      </header>

      <section className="controls">
        <label>마켓
          <select value={market} onChange={(e) => setMarket(e.target.value)}>
            {MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>분봉
          <select value={unit} onChange={(e) => setUnit(Number(e.target.value))}>
            {UNITS.map((u) => <option key={u} value={u}>{u}분</option>)}
          </select>
        </label>
        <button onClick={loadCandles} className="btn">새로고침</button>
      </section>

      <section className="price">
        <div className="pair">{market}</div>
        <div className="last" style={{ color: up ? UP : DOWN }}>
          {last ? fmtKRW(last.close) : '-'} <span className="won">KRW</span>
        </div>
        <div className="chg" style={{ color: up ? UP : DOWN }}>
          {last && prev ? `${up ? '▲' : '▼'} ${up ? '+' : ''}${fmtKRW(Math.round(change))} (${changePct.toFixed(2)}%)` : ''}
        </div>
      </section>

      <section className="chart-wrap">
        {status === 'loading' && <div className="overlay">불러오는 중…</div>}
        {status === 'error' && <div className="overlay err">BN 연결 오류: {err}</div>}
        {status === 'empty' && <div className="overlay">데이터 없음(휴장/빈 응답)</div>}
        <div ref={chartElRef} className="chart" />
      </section>

      <footer className="foot">
        데이터: 업비트(BN 경유) · 교육·정보용 · 실주문 미구현(paper) · BN {BN_URL.replace('https://', '')}
      </footer>
    </div>
  )
}
