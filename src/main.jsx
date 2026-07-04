import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// StrictMode 미사용: dev 이중 마운트가 lightweight-charts 인스턴스를 중복 생성/제거해
// 차트 churn·에러바운더리 플리커를 유발. 프로덕션 동작과 동일하게 단일 마운트로 렌더.
createRoot(document.getElementById('root')).render(<App />)
