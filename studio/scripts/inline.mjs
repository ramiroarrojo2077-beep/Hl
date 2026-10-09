// Genera dist/horizonte.html: un único archivo autocontenido (JS, CSS y favicon embebidos).
import { readFileSync, writeFileSync } from 'node:fs'

const dist = new URL('../dist/', import.meta.url)
const read = (p) => readFileSync(new URL(p.replace(/^\.?\//, ''), dist), 'utf8')
let html = read('index.html')
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, (_, src) =>
  `<script type="module">${read(src).replace(/<\/script/gi, '<\\/script')}</script>`)
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/, (_, href) => `<style>${read(href)}</style>`)
html = html.replace(/href="\.?\/favicon\.svg"/, () => `href="data:image/svg+xml,${encodeURIComponent(read('favicon.svg'))}"`)
writeFileSync(new URL('horizonte.html', dist), html)
console.log(`dist/horizonte.html ${(html.length / 1024).toFixed(0)} kB`)
