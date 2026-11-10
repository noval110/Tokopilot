import { ArrowDown, ArrowRight, Check, X } from 'lucide-react'
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router'
import heroLebar from '@/assets/photos/hero-lapak-lebar.webp'
import heroTegak from '@/assets/photos/hero-lapak-tegak.webp'
import pasarGading from '@/assets/photos/pasar-gading-surakarta.webp'
import pedagang from '@/assets/photos/pedagang-pasar-lampung.webp'
import pemilikLapak from '@/assets/photos/pemilik-lapak-bali.webp'
import { useCachedMe } from '@/app/session'
import { Logo } from '@/components/brand/Logo'
import { ButtonLink } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { motionAllowed, usePointerParallax, useScrollReveal } from '@/lib/motion'

const v = (vars: Record<string, string>) => vars as CSSProperties

const led = ['TOKO BUKA', 'KASIR CEPAT', 'STOK AMAN', 'TUNAI · QRIS · TRANSFER', 'OMZET HARIAN', 'TANYA PILOT', 'WIB · WITA · WIT']

const cannot = ['Mengubah harga atau stok', 'Menghapus nota', 'Menjalankan SQL bebas', 'Mengintip toko lain']

const stamps = [
  { stamp: 'Tidak bisa dihapus', tone: 'text-cabe-600', tilt: '-7deg', body: 'Setiap barang masuk dan keluar jadi baris baru di buku besar. Batal transaksi? Dibuat pembalikan, catatan aslinya tetap ada.' },
  { stamp: 'Satu nota', tone: 'text-daun-700', tilt: '5deg', body: 'Pelanggan buru-buru, tombol kepencet dua kali? Tetap satu nota, stok berkurang sekali.' },
  { stamp: 'AI cuma baca', tone: 'text-terpal-600', tilt: '-4deg', body: 'Pilot membaca lewat alat baca-saja yang diperiksa server. Ia tidak punya tombol untuk mengubah apa pun.' },
]

const credits = [
  { name: 'Polina Kuzovkova', href: 'https://unsplash.com/@p_kuzovkova' },
  { name: 'Devi Puspita Amartha Yahya', href: 'https://unsplash.com/@deviyahya' },
  { name: 'Anggit Rizkianto', href: 'https://unsplash.com/@anggit_mr' },
  { name: 'Prabu Panji', href: 'https://unsplash.com/@prabuuuuu' },
]

/** The rolling shutter goes up once per session: the shop opens. Decorative. */
function useShutter() {
  const [show, setShow] = useState(() => {
    if (!motionAllowed()) return false
    try {
      return sessionStorage.getItem('tp.shutter') !== '1'
    } catch {
      return true
    }
  })
  useEffect(() => {
    if (!show) return
    try {
      sessionStorage.setItem('tp.shutter', '1')
    } catch {
      /* private mode — it just plays again next time */
    }
    const t = setTimeout(() => setShow(false), 1700)
    return () => clearTimeout(t)
  }, [show])
  return show
}

function Shutter() {
  return (
    <div aria-hidden data-shutter className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <div
        className="absolute inset-0 border-b-4 border-ink-900 bg-[repeating-linear-gradient(180deg,#b9b2a6_0_18px,#a29a8d_18px_20px,#cfc8bc_20px_22px)]"
        style={{ animation: 'shutter-up 1.15s var(--ease-snap) 0.35s both' }}
      >
        <div className="absolute inset-x-0 bottom-6 mx-auto h-3 w-40 rounded-full border-2 border-ink-900 bg-ink-700" />
        <div className="sign absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-3 bg-cabe-600 px-8 py-3">
          <span className="font-sign text-5xl text-white">Buka!</span>
        </div>
      </div>
    </div>
  )
}

/** Marker underline that draws itself. */
function Scrawl({ className, d = 'M4 14C60 6 130 4 196 10s90 4 100-2' }: { className?: string; d?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 300 20" preserveAspectRatio="none" className={cn('pointer-events-none absolute', className)}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" className="animate-draw" style={v({ '--len': '320', '--d': 'calc(var(--intro, 0s) + 0.7s)' })} />
    </svg>
  )
}

/** A receipt that prints line by line, then gets stamped LUNAS. Illustrative. */
function PrintingReceipt({ className, start = 0.9 }: { className?: string; start?: number }) {
  const rows: Array<[string, string]> = [
    ['Kopi Gayo 250g  2×', '136.000'],
    ['Beras pandan  1,5 kg', '18.500'],
    ['Gula pasir 1kg', '17.500'],
    ['Diskon', '−5.000'],
  ]
  return (
    <div aria-hidden className={cn('animate-thud', className)} style={v({ '--d': `calc(var(--intro) + ${start + 1.6}s)`, '--tilt': '0deg' })}>
      <div className="relative w-60 rotate-[4deg] text-ink-900">
        <div className="animate-print receipt-edge border-2 border-b-0 border-ink-900 bg-white px-4 pt-4 shadow-lift" style={v({ '--d': `calc(var(--intro) + ${start}s)` })}>
          <div className="text-center">
            <div className="font-sign text-lg leading-none">Toko Contoh</div>
            <div className="mt-1 text-[0.6875rem] text-text-muted">TP-20261110-0012 · 08.14 WIB</div>
          </div>
          <div className="my-3 border-t-2 border-dashed border-ink-900/30" />
          <ul className="space-y-1.5 text-[0.8125rem]">
            {rows.map(([k, val]) => (
              <li key={k} className="flex justify-between gap-3"><span>{k}</span><span className="num font-semibold">{val}</span></li>
            ))}
          </ul>
          <div className="my-3 border-t-2 border-dashed border-ink-900/30" />
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">Total</span>
            <span className="num text-xl font-black">Rp 167.000</span>
          </div>
          <div className="mt-1 text-[0.75rem] text-text-muted">Bayar: QRIS</div>
          {/* Clear space for the stamp: a stamp must never cover an amount. */}
          <div className="mt-3 h-14 border-t-2 border-dashed border-ink-900/30 pt-2 text-[0.6875rem] text-text-subtle">terima kasih!</div>
        </div>
        <span className="animate-slam stamp absolute right-5 bottom-6 bg-white/80 text-lg text-daun-700" style={v({ '--d': `calc(var(--intro) + ${start + 1.55}s)`, '--stamp-tilt': '-12deg' })}>
          Lunas
        </span>
      </div>
    </div>
  )
}

/** A cardboard price tag hanging from the top of the hero on a string. */
function HangingTag({ className, rope, delay, swing, period, tone, children }: {
  className?: string
  rope: string
  delay: number
  swing: string
  period: string
  tone: string
  children: ReactNode
}) {
  return (
    <div className={cn('absolute top-0', className)}>
      <div className="animate-pop" style={v({ '--d': `calc(var(--intro) + ${delay}s)` })}>
        <div className="animate-swing flex flex-col items-center" style={v({ '--swing': swing, animationDuration: period })}>
          <span className={cn('w-0.5 bg-ink-900', rope)} />
          <div className={cn('relative -mt-1 rounded-sm border-2 border-ink-900 px-4 pt-5 pb-3 text-center shadow-lift', tone)}>
            <span className="absolute top-1.5 left-1/2 size-2.5 -translate-x-1/2 rounded-full border-2 border-ink-900 bg-paper-50" />
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ kicker, children, className, kickerClass = 'text-cabe-600' }: { kicker: string; children: ReactNode; className?: string; kickerClass?: string }) {
  return (
    <div className={cn('reveal', className)}>
      <p className={cn('scribble text-xl', kickerClass)}>{kicker}</p>
      <h2 className="font-sign mt-2 text-[2.6rem] leading-[1.05] font-normal tracking-normal sm:text-[3.6rem]">{children}</h2>
    </div>
  )
}

function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('eyebrow inline-flex items-center rounded-xs border-2 border-ink-900 bg-paper-50 px-2 py-0.5 text-[0.6875rem] text-ink-900', className)}>{children}</span>
}

/** A photo print taped to the board. */
function TapedPhoto({ src, alt, className, imgClassName, tilt = '-2deg' }: { src: string; alt: string; className?: string; imgClassName?: string; tilt?: string }) {
  return (
    <div className={cn('relative', className)} style={{ transform: `rotate(${tilt})` }}>
      <span className="tape -top-3 left-6 z-10 -rotate-6" aria-hidden />
      <span className="tape -top-3 right-6 z-10 rotate-3" aria-hidden />
      <img src={src} alt={alt} loading="lazy" className={cn('w-full border-[6px] border-white object-cover outline-2 outline-ink-900', imgClassName)} />
    </div>
  )
}

function LedBoard() {
  const row = () => (
    <ul aria-hidden className="flex shrink-0 items-center gap-10 pr-10">
      {led.map((t) => (
        <li key={t} className="led-text flex items-center gap-10 text-2xl whitespace-nowrap sm:text-3xl">
          {t}
          <span className="text-cabe-300">✦</span>
        </li>
      ))}
    </ul>
  )
  return (
    <div className="led-board relative border-y-4 border-ink-900 py-4">
      <p className="sr-only">Toko buka. Kasir cepat, stok aman, terima tunai, QRIS, dan transfer, omzet harian, tanya Pilot.</p>
      <div className="overflow-hidden">
        <div className="animate-marquee flex w-max">
          {row()}
          {row()}
        </div>
      </div>
    </div>
  )
}

function Sign({ className, tilt = '0deg', delay = 0, children }: { className?: string; tilt?: string; delay?: number; children: ReactNode }) {
  return (
    <article className={cn('reveal lift tilted sign relative overflow-hidden', className)} style={v({ '--tilt': tilt, '--d': `${delay}s` })}>
      {children}
    </article>
  )
}

function ChatDemo() {
  return (
    <figure aria-label="Contoh percakapan dengan Pilot" className="reveal tilted sign bg-white p-5 sm:p-6" style={v({ '--d': '0.1s', '--tilt': '1.5deg' })}>
      <div className="flex items-center justify-between border-b-2 border-ink-900 pb-3">
        <span className="font-sign text-2xl">Pilot</span>
        <Tag className="bg-daun-100">Baca-saja</Tag>
      </div>
      <div className="space-y-4 pt-5 text-[0.9375rem]">
        <p className="animate-pop ml-auto w-fit max-w-[85%] rounded-md rounded-br-xs border-2 border-ink-900 bg-daun-700 px-4 py-2.5 font-medium text-white" style={v({ '--d': '0.3s' })}>
          Barang apa yang paling laku minggu ini?
        </p>
        <div aria-hidden className="typing-bubble flex w-fit gap-1.5 rounded-md border-2 border-ink-900 bg-paper-100 px-4 py-3" style={v({ '--d': '0.7s' })}>
          {[0, 0.15, 0.3].map((d) => <span key={d} className="typing-dot size-2 rounded-full bg-ink-900" style={{ animationDelay: `${d}s` }} />)}
        </div>
        <div className="animate-pop max-w-[92%] rounded-md rounded-bl-xs border-2 border-ink-900 bg-paper-100 px-4 py-3 text-ink-900" style={v({ '--d': '1.75s' })}>
          <p className="font-semibold">Terlaris 4–10 Nov:</p>
          <ol className="mt-1.5 space-y-0.5">
            <li>1. Kopi Arabica Gayo: <span className="num font-bold">Rp 204.000</span></li>
            <li>2. Gula Pasir 1kg: <span className="num font-bold">Rp 122.500</span></li>
            <li>3. Telur Ayam: <span className="num font-bold">Rp 96.000</span></li>
          </ol>
          <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-xs border border-ink-900/30 bg-white px-2 py-0.5 text-[0.75rem] text-text-muted">
            Sumber: produk terlaris · data per 10 Nov, 19.49 WIB
          </span>
        </div>
      </div>
      <figcaption className="mt-4 text-[0.75rem] text-text-subtle">Contoh tampilan dengan data toko demo.</figcaption>
    </figure>
  )
}

export function LandingPage() {
  const root = useScrollReveal<HTMLDivElement>()
  const hero = usePointerParallax<HTMLElement>()
  const shutter = useShutter()
  // Someone coming back from the app goes straight to it; the page itself never calls the API.
  const me = useCachedMe()
  const app = me ? { to: me.membership ? '/dashboard' : '/onboarding/store', label: me.membership ? 'Ke dasbor' : 'Lanjut siapkan toko' } : null
  // While the shutter rolls up, the hero waits for it.
  const intro = v({ '--intro': shutter ? '1.1s' : '0s' })

  return (
    <div ref={root} className="min-h-dvh overflow-x-clip bg-paper-50 [background-image:var(--grain)]" style={intro}>
      {shutter && <Shutter />}

      {/* ——— Hero: the market itself is the backdrop ——— */}
      <section ref={hero} className="relative isolate overflow-hidden border-b-4 border-ink-900 bg-ink-900">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <picture>
            <source media="(max-width: 767px)" srcSet={heroTegak} />
            <img
              src={heroLebar}
              alt="Lapak sayur dan jajanan renceng yang tergantung di sebuah pasar di Indonesia"
              width={1800}
              height={1100}
              fetchPriority="high"
              className="animate-kenburns size-full object-cover object-[40%_50%]"
            />
          </picture>
          <div aria-hidden className="halftone absolute inset-0 opacity-50" />
          <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgb(29_23_18/0.45),rgb(29_23_18/0.08)_30%,rgb(29_23_18/0.1)_70%,rgb(29_23_18/0.55))]" />
        </div>

        <div aria-hidden className="awning animate-drop relative z-20 h-16 sm:h-[4.5rem]" style={v({ '--d': 'var(--intro)' })} />
        <header className="relative z-20 mx-auto -mt-1 flex h-20 max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
          <Link to="/" aria-label="TokoPilot, beranda" className="sign-sm bg-paper-50 px-3 py-1.5">
            <Logo />
          </Link>
          <nav aria-label="Navigasi situs" className="flex items-center gap-2 sm:gap-3">
            {[['#isi', 'Isi toko'], ['#mulai', 'Cara mulai'], ['#pilot', 'Tanya Pilot']].map(([href, label]) => (
              <a key={href} href={href} className="press hidden rounded-xs border-2 border-ink-900 bg-paper-50 px-3 py-1.5 text-sm font-bold text-ink-900 shadow-(--shadow-glow) md:block">
                {label}
              </a>
            ))}
            <ButtonLink to={app?.to ?? '/login'} variant="secondary" size="sm" className="ml-1">{app?.label ?? 'Masuk'}</ButtonLink>
          </nav>
        </header>

        <div className="relative z-10 mx-auto grid max-w-6xl gap-6 px-5 pt-2 pb-16 sm:px-8 lg:min-h-[44rem] lg:grid-cols-[minmax(0,35rem)_1fr] lg:gap-12 lg:pt-6 lg:pb-24">
          {/* The headline hangs from the awning on two ropes. */}
          <div className="depth-1">
            <div className="animate-drop" style={v({ '--d': 'calc(var(--intro) + 0.15s)' })}>
              <div className="animate-swing hover:[animation-play-state:paused]" style={v({ '--swing': '0.7deg' })}>
                <div aria-hidden className="flex justify-between px-14">
                  <span className="h-8 w-1 rounded-full bg-ink-900" />
                  <span className="h-8 w-1 rounded-full bg-ink-900" />
                </div>
                <div className="sign bg-kunyit-300 p-6 sm:p-9">
                  <p className="scribble text-lg text-cabe-800 sm:text-xl">buat warung, toko kelontong, sampai grosir kecil</p>
                  <h1 className="mt-3 text-[2.2rem] leading-[1.08] sm:text-[3.6rem]">
                    Warung buka, buku beres. Sekarang ada{' '}
                    <span className="painted relative inline-block whitespace-nowrap text-daun-700" style={v({ '--paint': 'var(--color-white)' })}>
                      kopilot.
                      <Scrawl className="-bottom-3 left-0 h-4 w-full text-cabe-600" />
                    </span>
                  </h1>
                  <p className="mt-7 text-[1.0625rem] leading-relaxed text-ink-800 sm:text-lg">
                    Catat jualan secepat ngitung kembalian. Stok berkurang sendiri, omzet terhitung sendiri. Kalau penasaran,
                    tinggal tanya pakai bahasa sehari-hari.
                  </p>
                  <div className="mt-8 flex flex-wrap items-center gap-5">
                    <ButtonLink to="/register" size="lg">
                      Buat akun toko <ArrowRight className="size-4" aria-hidden />
                    </ButtonLink>
                    <a href="#isi" className="inline-flex items-center gap-1.5 font-bold text-ink-900 decoration-cabe-600 decoration-[4px] underline-offset-[6px] hover:underline">
                      Lihat isinya <ArrowDown className="size-4" aria-hidden />
                    </a>
                  </div>
                  <ul className="mt-8 grid gap-2 border-t-2 border-dashed border-ink-900/25 pt-5 sm:grid-cols-3 sm:gap-3">
                    {['Stok tidak pernah minus', 'Klik dua kali tetap satu nota', 'AI tidak bisa mengubah data'].map((t) => (
                      <li key={t} className="flex items-start gap-2 text-[0.875rem] leading-snug font-semibold text-ink-900">
                        <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-xs border-2 border-ink-900 bg-white"><Check className="size-3 stroke-[3.5]" aria-hidden /></span>
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Things hanging around the stall — decorative, they move with the pointer at different depths. */}
          <div aria-hidden className="relative hidden lg:block">
            <div className="depth-3 absolute top-2 right-0">
              <div className="animate-pop" style={v({ '--d': 'calc(var(--intro) + 0.6s)', '--tilt': '4deg' })}>
                <div className="rounded-md border-4 border-ink-900 bg-led-board px-7 py-3 shadow-sign">
                  <span className="font-sign neon animate-flicker block text-[2.8rem] leading-none" style={v({ '--d': 'calc(var(--intro) + 0.6s)' })}>Buka</span>
                </div>
              </div>
            </div>

            <HangingTag className="depth-2 left-6" rope="h-24" delay={0.75} swing="7deg" period="3.4s" tone="bg-white">
              <span className="scribble block text-xl leading-tight text-daun-700">Sayur segar!</span>
              <span className="scribble block text-base leading-tight text-ink-800">petik pagi ini</span>
            </HangingTag>

            <HangingTag className="depth-3 left-[44%]" rope="h-40" delay={0.9} swing="5deg" period="4.1s" tone="bg-kunyit-300">
              <span className="scribble block text-lg leading-tight text-ink-900">Gula tinggal 7,</span>
              <span className="scribble block text-lg leading-tight text-cabe-800">kulakan!</span>
            </HangingTag>

            <HangingTag className="depth-2 top-56 right-0" rope="h-14" delay={1.05} swing="-6deg" period="3s" tone="bg-terpal-600">
              <span className="block text-[0.6875rem] font-black tracking-widest text-white">BAYAR PAKAI</span>
              <span className="font-sign block text-3xl leading-none text-white">QRIS</span>
            </HangingTag>

            <div className="depth-1 absolute right-10 bottom-0">
              <PrintingReceipt start={1.3} />
            </div>

            <div className="depth-2 absolute bottom-24 left-0">
              <div className="animate-pop rotate-[-4deg] rounded-xs border-2 border-ink-900 bg-paper-50 px-3 py-2 shadow-lift" style={v({ '--d': 'calc(var(--intro) + 3s)', '--tilt': '-4deg' })}>
                <span className="scribble block w-40 text-[1.05rem] leading-tight text-ink-900">nota jadi, stok langsung berkurang →</span>
              </div>
            </div>
          </div>

          {/* Phones: the neon sign and one tag sit under the board. */}
          <div aria-hidden className="order-first flex min-h-36 items-end justify-between gap-4 pt-2 lg:hidden">
            <div className="rotate-[-3deg] rounded-md border-4 border-ink-900 bg-led-board px-5 py-2 shadow-lift">
              <span className="font-sign neon animate-flicker block text-3xl leading-none">Buka</span>
            </div>
            <div className="animate-swing origin-top" style={v({ '--swing': '5deg' })}>
              <div className="rounded-sm border-2 border-ink-900 bg-terpal-600 px-4 py-2 text-center shadow-lift">
                <span className="block text-[0.625rem] font-black tracking-widest text-white">BAYAR PAKAI</span>
                <span className="font-sign block text-2xl leading-none text-white">QRIS</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <LedBoard />

      {/* ——— What's in the shop ——— */}
      <section id="isi" className="mx-auto max-w-6xl scroll-mt-6 px-5 pt-24 pb-24 sm:px-8">
        <SectionTitle kicker="isi tokonya">Semua yang dipakai tiap hari di warung.</SectionTitle>

        <div className="mt-14 grid gap-8 md:grid-cols-12">
          <Sign className="bg-daun-700 text-white md:col-span-7" tilt="-1deg">
            <div className="grid gap-6 p-6 sm:grid-cols-[1fr_13rem] sm:p-7">
              <div>
                <Tag>01 · Kasir</Tag>
                <h3 className="font-sign mt-4 text-[2.2rem] leading-none font-normal text-white">Ketuk, ketuk, lunas.</h3>
                <p className="mt-4 text-daun-50">Pilih barang, pilih tunai, QRIS, atau transfer. Nota jadi, stok berkurang. Harga dihitung server, jadi tidak ada salah hitung kembalian.</p>
                <ul className="mt-6 flex flex-wrap gap-2" aria-label="Metode bayar">
                  {['Tunai', 'QRIS', 'Transfer', 'Lainnya'].map((m, i) => (
                    <li key={m} className="tilted rounded-xs border-2 border-ink-900 bg-white px-3 py-1 text-sm font-bold text-ink-900 shadow-(--shadow-glow)" style={v({ '--tilt': `${[-3, 2, -1, 3][i]}deg` })}>{m}</li>
                  ))}
                </ul>
              </div>
              <TapedPhoto src={pedagang} alt="Pedagang di Pasar Gudang Lelang, Lampung, melayani pembeli di depan timbangan" imgClassName="aspect-[4/5]" tilt="3deg" />
            </div>
          </Sign>

          <Sign className="bg-kunyit-300 text-ink-900 md:col-span-5" tilt="1.5deg" delay={0.08}>
            <TapedPhoto src={pasarGading} alt="Pasar Gading di Surakarta dilihat dari atas: pedagang dan pembeli di antara lapak bumbu dan jajanan" className="mx-6 mt-8" imgClassName="aspect-[16/9]" tilt="-2deg" />
            <div className="p-6 sm:p-7">
              <Tag>02 · Kulakan</Tag>
              <h3 className="font-sign mt-4 text-[2rem] leading-none font-normal">Tahu kapan harus kulakan.</h3>
              <p className="mt-3 text-ink-800">Barang di bawah batas minimum langsung kelihatan. Barang masuk dan keluar tercatat di buku besar dan tidak bisa dihapus diam-diam.</p>
            </div>
          </Sign>

          <Sign className="bg-white text-ink-900 md:col-span-4" tilt="1deg" delay={0.04}>
            <div className="p-6 sm:p-7">
              <Tag className="bg-kunyit-100">03 · Omzet</Tag>
              <h3 className="font-sign mt-4 text-[2rem] leading-none font-normal">Omzet & untung, tanpa ngitung manual.</h3>
              <p className="mt-3 text-text-muted">Penjualan bersih, laba kotor, dan barang terlaris per hari, minggu, atau bulan.</p>
              <div aria-hidden className="mt-6 flex h-24 items-end gap-2 border-b-2 border-ink-900">
                {[34, 52, 41, 66, 48, 80, 58, 100].map((h, i) => (
                  <span key={i} className={cn('flex-1 rounded-t-[3px] border-2 border-b-0 border-ink-900', i === 7 ? 'bg-cabe-600' : 'bg-daun-500')} style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </Sign>

          <Sign className="bg-terpal-600 text-white md:col-span-4" tilt="-1.5deg" delay={0.1}>
            <TapedPhoto src={pemilikLapak} alt="Pemilik lapak kain di sebuah pasar di Bali tersenyum di depan dagangannya" className="mx-10 mt-8" imgClassName="aspect-[4/3] object-[50%_30%]" tilt="2deg" />
            <div className="p-6 sm:p-7">
              <Tag>04 · Juragan & karyawan</Tag>
              <h3 className="font-sign mt-4 text-[2rem] leading-none font-normal text-white">Karyawan jaga kasir, juragan pegang harga.</h3>
              <p className="mt-3 text-terpal-50">Staf bisa mencatat penjualan. Harga, stok masuk, dan pengaturan toko hanya untuk owner. Dijaga di server, bukan sekadar disembunyikan.</p>
            </div>
          </Sign>

          <Sign className="bg-cabe-600 text-white md:col-span-4" tilt="1.2deg" delay={0.16}>
            <ul aria-label="Satuan dan zona waktu" className="flex flex-wrap gap-2 border-b-2 border-ink-900 bg-cabe-800/30 p-6 pb-5">
              {['kg', 'pcs', 'botol', 'ons', 'WIB', 'WITA', 'WIT'].map((u, i) => (
                <li key={u} className="tilted rounded-xs border-2 border-ink-900 bg-paper-50 px-2.5 py-1 font-black text-ink-900" style={v({ '--tilt': `${[-4, 3, -2, 4, -3, 2, -1][i]}deg` })}>{u}</li>
              ))}
            </ul>
            <div className="p-6 sm:p-7">
              <Tag>05 · Indonesia banget</Tag>
              <h3 className="font-sign mt-4 text-[2rem] leading-none font-normal text-white">Rupiah tanpa koma.</h3>
              <p className="mt-3 text-cabe-50">Satuan kg, pcs, atau botol. Zona WIB, WITA, WIT. Nomor nota per hari sesuai jam tokomu.</p>
            </div>
          </Sign>
        </div>
      </section>

      {/* ——— How to start: printed as a receipt ——— */}
      <section id="mulai" className="scroll-mt-6 border-y-2 border-ink-900 bg-kunyit-300 py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 sm:px-8 lg:grid-cols-[1fr_24rem]">
          <SectionTitle kicker="cara mulai" kickerClass="text-cabe-800">Tiga baris di bon, lalu toko siap jualan.</SectionTitle>
          <div className="reveal relative mx-auto w-full max-w-sm" style={v({ '--d': '0.1s' })}>
            <div className="animate-print receipt-edge border-2 border-b-0 border-ink-900 bg-white px-6 pt-6 text-ink-900 shadow-sign" style={v({ '--d': '0.2s' })}>
              <div className="text-center">
                <div className="font-sign text-2xl leading-none">Bon Pendaftaran</div>
                <div className="mt-1 text-[0.75rem] text-text-muted">TokoPilot · untuk tokomu</div>
              </div>
              <div className="my-4 border-t-2 border-dashed border-ink-900/30" />
              <ol className="space-y-4">
                {[
                  ['Daftar & isi nama toko', 'Zona waktu dan alamat menyusul.'],
                  ['Masukkan barang & stok awal', 'Label rak langsung kelihatan.'],
                  ['Jualan di kasir', 'Dasbor terisi dengan sendirinya.'],
                ].map(([k, d], i) => (
                  <li key={k}>
                    <div className="flex items-baseline gap-2 font-bold">
                      <span className="num">{i + 1}.</span>
                      <span>{k}</span>
                      <span aria-hidden className="leader" />
                      <Check className="size-4 shrink-0 stroke-[3] text-daun-700" aria-hidden />
                    </div>
                    <p className="mt-0.5 pl-5 text-[0.875rem] text-text-muted">{d}</p>
                  </li>
                ))}
              </ol>
              <div className="my-4 border-t-2 border-dashed border-ink-900/30" />
              <div className="flex items-baseline justify-between">
                <span className="eyebrow">Total</span>
                <span className="font-bold">Toko siap jualan</span>
              </div>
              {/* Clear space for the stamp so it never covers a line. */}
              <div className="mt-4 h-16 border-t-2 border-dashed border-ink-900/30 pt-2 text-center text-[0.75rem] text-text-subtle">simpan bon ini</div>
            </div>
            <span className="animate-slam stamp absolute right-6 bottom-6 bg-white/80 text-2xl text-cabe-600" style={v({ '--d': '1.6s', '--stamp-tilt': '8deg' })}>
              Buka
            </span>
          </div>
        </div>
      </section>

      {/* ——— Ask Pilot ——— */}
      <section id="pilot" className="mx-auto grid max-w-6xl scroll-mt-6 items-center gap-14 px-5 py-24 sm:px-8 lg:grid-cols-2">
        <div>
          <SectionTitle kicker="asisten AI">Tanya Pilot.</SectionTitle>
          <p className="reveal mt-5 max-w-lg text-lg text-text-muted" style={v({ '--d': '0.05s' })}>
            Penasaran omzet minggu ini? Barang apa yang hampir habis? Tanya saja pakai bahasa sehari-hari. Setiap jawaban menyebut
            periode dan jam datanya.
          </p>
          <div className="reveal mt-8 max-w-md rounded-md border-2 border-dashed border-ink-900/40 p-5" style={v({ '--d': '0.12s' })}>
            <h3 className="scribble text-xl font-normal text-ink-900">Yang tidak bisa dilakukan Pilot:</h3>
            <ul className="mt-3 space-y-2">
              {cannot.map((c, i) => (
                <li key={c} className="flex items-center gap-3 text-[1.0625rem] text-ink-800">
                  <X className="size-5 shrink-0 stroke-[3] text-cabe-600" aria-hidden />
                  <span className="relative">
                    {c}
                    <span aria-hidden className="strike absolute top-1/2 left-0 h-0.5 w-full bg-cabe-600" style={v({ '--d': `${0.4 + i * 0.15}s` })} />
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[0.9375rem] text-text-muted">Bukan sekadar dilarang: alat untuk melakukannya memang tidak pernah dibuat.</p>
          </div>
        </div>
        <ChatDemo />
      </section>

      {/* ——— Stamped promises ——— */}
      <section className="border-t-2 border-ink-900 bg-white py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <SectionTitle kicker="janji yang dicap">Akurat dulu, pintar kemudian.</SectionTitle>
          <ul className="mt-14 grid gap-10 md:grid-cols-3">
            {stamps.map((s, i) => (
              <li key={s.stamp} className="reveal border-t-2 border-ink-900 pt-8" style={v({ '--d': `${i * 0.12}s` })}>
                <span className={cn('animate-slam stamp text-xl', s.tone)} style={v({ '--d': `${0.25 + i * 0.15}s`, '--stamp-tilt': s.tilt })}>{s.stamp}</span>
                <p className="mt-6 text-[1.0625rem] leading-relaxed text-ink-800">{s.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ——— Hanging BUKA sign ——— */}
      <section className="overflow-hidden px-5 pt-10 pb-28 sm:px-8">
        <div className="reveal mx-auto max-w-4xl">
          <div className="animate-swing" style={v({ '--swing': '1.2deg' })}>
            <div aria-hidden className="mx-auto flex w-2/3 justify-between">
              <span className="h-14 w-0.5 bg-ink-900" />
              <span className="h-14 w-0.5 bg-ink-900" />
            </div>
            <div className="sign bg-cabe-600 px-6 py-12 text-center sm:px-12">
              <h2 className="font-sign painted text-[2.6rem] leading-[1.05] font-normal tracking-normal text-white sm:text-6xl" style={v({ '--paint': 'var(--color-ink-900)' })}>
                Yuk, buka buku tokomu.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-lg text-white">Daftar, isi barang, dan catat jualan pertamamu hari ini.</p>
              <div className="mt-9 flex flex-wrap justify-center gap-4">
                <ButtonLink to="/register" size="lg" variant="on-dark">Mulai sekarang <ArrowRight className="size-4" aria-hidden /></ButtonLink>
                <ButtonLink to={app?.to ?? '/login'} size="lg" variant="secondary">{app?.label ?? 'Saya sudah punya akun'}</ButtonLink>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t-2 border-ink-900 bg-paper-100">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-10 sm:px-8 md:flex-row md:items-end md:justify-between">
          <div>
            <Logo />
            <p className="mt-3 text-[0.875rem] text-text-muted">Untuk UMKM Indonesia · © 2026 TokoPilot</p>
          </div>
          <p className="max-w-md text-[0.8125rem] text-text-subtle md:text-right">
            Foto oleh{' '}
            {credits.map((c, i) => (
              <span key={c.href}>
                <a href={c.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-text-muted underline-offset-2 hover:text-ink-900 hover:underline">{c.name}</a>
                {i < credits.length - 2 ? ', ' : i === credits.length - 2 ? ', dan ' : ''}
              </span>
            ))}{' '}
            di{' '}
            <a href="https://unsplash.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-text-muted underline-offset-2 hover:text-ink-900 hover:underline">Unsplash</a>.
          </p>
        </div>
      </footer>
    </div>
  )
}
