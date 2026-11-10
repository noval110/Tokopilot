// Latency smoke test for NFR-08/09/10 against a running stack (default http://127.0.0.1:8080).
// Reads run against the seeded demo store (read-only); writes and AI run in a fresh "perf" store.
//   DEMO_EMAIL=… DEMO_PASSWORD=… node scripts/perf-smoke.mjs
// This is a local smoke measurement, not a production load test.
const API = process.env.API_URL ?? 'http://127.0.0.1:8080'
const ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'
const N = Number(process.env.PERF_N ?? 200)
const CONCURRENCY = Number(process.env.PERF_CONCURRENCY ?? 10)

class Session {
  cookies = new Map()
  async req(method, path, body) {
    const csrf = this.cookies.get('tp_csrf') ?? ''
    const res = await fetch(API + '/api/v1' + path, {
      method,
      headers: {
        'Content-Type': 'application/json', Origin: ORIGIN, 'X-CSRF-Token': csrf,
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';')
      const i = pair.indexOf('=')
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1))
    }
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }
}

const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]

async function measure(label, n, conc, fn, targetMs) {
  const times = []
  let errors = 0
  let next = 0
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next < n) {
      const i = next++
      const t0 = performance.now()
      const ok = await fn(i).catch(() => false)
      times.push(performance.now() - t0)
      if (!ok) errors++
    }
  }))
  times.sort((a, b) => a - b)
  const p95 = pct(times, 95)
  const row = { endpoint: label, n, p50_ms: Math.round(pct(times, 50)), p95_ms: Math.round(p95), max_ms: Math.round(times.at(-1)), errors, target_ms: targetMs, pass: errors === 0 && p95 < targetMs }
  results.push(row)
  return row
}

const results = []
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
const from30 = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(Date.now() - 29 * 864e5))

const demo = new Session()
const login = await demo.req('POST', '/auth/login', { email: process.env.DEMO_EMAIL, password: process.env.DEMO_PASSWORD })
if (login.status !== 200) throw new Error(`demo login failed (${login.status}) — set DEMO_EMAIL/DEMO_PASSWORD and run api seed-demo`)
const reads = [
  ['GET /products (list)', '/products?per_page=20', 700],
  ['GET /products?q= (search)', '/products?q=kopi&per_page=20', 700],
  ['GET /sales (history)', '/sales?per_page=20', 700],
  ['GET /inventory/movements', '/inventory/movements?per_page=20', 700],
  ['GET /dashboard/summary 30d', `/dashboard/summary?from=${from30}&to=${today}`, 1500],
  ['GET /dashboard/sales-trend 30d', `/dashboard/sales-trend?from=${from30}&to=${today}`, 1500],
  ['GET /dashboard/top-products 30d', `/dashboard/top-products?from=${from30}&to=${today}`, 1500],
  ['GET /reports/sales 30d', `/reports/sales?from=${from30}&to=${today}`, 1500],
]
for (const [label, path, target] of reads) {
  await measure(label, N, CONCURRENCY, async () => (await demo.req('GET', path)).status === 200, target)
}

// Writes in an isolated store so the demo data stays untouched.
const perf = new Session()
const stamp = Date.now()
await perf.req('POST', '/auth/register', { name: 'Perf', email: `perf+${stamp}@perf.test`, password: 'perf-password-123' })
await perf.req('POST', '/stores', { name: 'Toko Perf' })
const prod = (await perf.req('POST', '/products', { name: 'Barang Perf', unit: 'pcs', cost_price: 1000, selling_price: 2000, initial_stock: '100000', min_stock: '1' })).body
await measure('POST /sales (checkout)', N, CONCURRENCY, async (i) =>
  (await perf.req('POST', '/sales', { idempotency_key: `perf-${stamp}-${i}`, items: [{ product_id: prod.id, quantity: '1' }], discount_amount: 0, payment_method: 'CASH' })).status === 201, 700)

const conv = (await perf.req('POST', '/assistant/conversations')).body.id
const questions = ['Berapa penjualan hari ini?', 'Produk apa yang stoknya hampir habis?', 'Bagaimana kondisi toko minggu ini?', 'Berapa stok barang perf?', 'Produk apa yang paling laku minggu ini?']
await measure('POST assistant message (scripted)', 10, 2, async (i) =>
  (await perf.req('POST', `/assistant/conversations/${conv}/messages`, { content: questions[i % questions.length] })).status === 201, 15000)

console.table(results)
const failed = results.filter((r) => !r.pass)
console.log(failed.length ? `FAIL: ${failed.map((r) => r.endpoint).join(', ')}` : `PASS: all ${results.length} endpoints within target (local, concurrency ${CONCURRENCY})`)
process.exitCode = failed.length ? 1 : 0
