// FN 배포 스크립트 — OneDrive 폴더 안에서 rollup이 dist를 못 써서(파일 잠금→exit127)
// 빌드가 조용히 실패하는 문제를 회피. OS 임시폴더(OneDrive 밖)에 빌드 후 gh-pages 배포.
import { build } from 'vite'
import { execSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const out = path.join(os.tmpdir(), 'coin_fn_dist')
const msg = process.argv[2] || 'deploy'

console.log('빌드(OneDrive 밖):', out)
await build({ build: { outDir: out, emptyOutDir: true } })
fs.writeFileSync(path.join(out, '.nojekyll'), '')  // GitHub Pages Jekyll 비활성
console.log('gh-pages 배포...')
execSync(`npx gh-pages -d "${out}" -b gh-pages --dotfiles -m "${msg}"`, { stdio: 'inherit' })
console.log('배포 완료 →', out)
