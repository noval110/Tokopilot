import { AlertTriangle, CheckCircle2, CircleSlash, PackageSearch, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { Logo } from '@/components/brand/Logo'
import { Badge, Stamp } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Receipt, ReceiptRow } from '@/components/ui/Receipt'

const swatches: Array<{ group: string; items: Array<[string, string, string]> }> = [
  {
    group: 'Kertas & tinta',
    items: [
      ['paper-50', 'bg-paper-50', '#FFF8EC'],
      ['paper-100', 'bg-paper-100', '#FCEFD8'],
      ['paper-300', 'bg-paper-300', '#E8CFA3'],
      ['ink-900', 'bg-ink-900', '#1D1712'],
      ['ink-600', 'bg-ink-600', '#594C3F'],
    ],
  },
  {
    group: 'Daun: aksi & positif',
    items: [
      ['daun-100', 'bg-daun-100', '#D6F0DF'],
      ['daun-500', 'bg-daun-500', '#23915A'],
      ['daun-700', 'bg-daun-700', '#0F663E'],
      ['daun-800', 'bg-daun-800', '#0B5232'],
    ],
  },
  {
    group: 'Warna jalanan: papan, tenda, stempel (bukan status)',
    items: [
      ['kunyit-300', 'bg-kunyit-300', '#FFC629'],
      ['cabe-600', 'bg-cabe-600', '#D7261E'],
      ['terpal-600', 'bg-terpal-600', '#2F62D1'],
      ['jambu-200', 'bg-jambu-200', '#FFB8D1'],
      ['led-board', 'bg-led-board', '#1A1410'],
    ],
  },
  {
    group: 'Sinyal: hanya peringatan/error',
    items: [
      ['warn-50', 'bg-warn-50', '#FFF6EB'],
      ['warn-600', 'bg-warn-600', '#C2410C'],
      ['danger-50', 'bg-danger-50', '#FEF3F2'],
      ['danger-600', 'bg-danger-600', '#B42318'],
    ],
  },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-paper-300 py-10">
      <h2 className="eyebrow mb-6 text-text-subtle">{title}</h2>
      {children}
    </section>
  )
}

export function DesignSystemPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <Logo />
      <h1 className="mt-8 text-5xl font-extrabold">Buku Besar Modern</h1>
      <p className="mt-3 max-w-2xl text-text-muted">
        Referensi token dan komponen TokoPilot. Sumber kebenaran: <code className="num">src/styles/index.css</code>{' '}
        dan <code className="num">docs/design/ui-direction.md</code>. Halaman ini hanya tersedia di mode development.
      </p>

      <Section title="Warna">
        <div className="space-y-8">
          {swatches.map((g) => (
            <div key={g.group}>
              <h3 className="mb-3 text-sm font-semibold">{g.group}</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
                {g.items.map(([name, cls, hex]) => (
                  <div key={name} className="overflow-hidden rounded-sm ring-1 ring-paper-300">
                    <div className={`h-14 ${cls}`} />
                    <div className="bg-white px-2.5 py-2">
                      <div className="text-xs font-semibold">{name}</div>
                      <div className="num text-[0.6875rem] text-text-subtle">{hex}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Tipografi">
        <div className="space-y-6">
          <div>
            <div className="font-sign painted text-5xl">Warung buka, buku beres.</div>
            <div className="mt-1 text-xs text-text-subtle">font-sign · Shrikhand: huruf papan cat tangan, untuk judul halaman & momen besar</div>
          </div>
          <div>
            <div className="text-2xl font-bold">Schibsted Grotesk untuk judul kartu, label, tombol, dan paragraf.</div>
            <div className="mt-1 text-xs text-text-subtle">font-display / font-sans · grotesk berkarakter yang tetap mudah dibaca</div>
          </div>
          <div>
            <div className="scribble text-2xl text-cabe-600">gula tinggal 7, kulakan!</div>
            <div className="mt-1 text-xs text-text-subtle">.scribble · Permanent Marker: coretan spidol, hemat dipakai</div>
          </div>
          <div className="led-board inline-block rounded-sm px-4 py-2">
            <div className="led-text text-2xl">TOKO BUKA ✦ STOK AMAN</div>
          </div>
          <div>
            <div className="num text-2xl font-bold">Rp 1.250.000 · 12,5 kg · SKU KOP-250</div>
            <div className="mt-1 text-xs text-text-subtle">.num · angka lining proporsional untuk uang & kuantitas</div>
          </div>
        </div>
      </Section>

      <Section title="Tombol">
        <div className="flex flex-wrap items-center gap-3">
          <Button>
            <Plus className="size-4" aria-hidden /> Simpan produk
          </Button>
          <Button variant="secondary">Batal</Button>
          <Button variant="ghost">Lainnya</Button>
          <Button variant="danger">Void transaksi</Button>
          <Button disabled>Memproses…</Button>
          <span className="rounded-sm bg-ink-900 p-2">
            <Button variant="on-dark">Di atas navy</Button>
          </span>
        </div>
      </Section>

      <Section title="Status: teks + ikon, bukan warna saja">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="positive" icon={<CheckCircle2 className="size-3" aria-hidden />}>
            Stok aman
          </Badge>
          <Badge tone="warning" icon={<AlertTriangle className="size-3" aria-hidden />}>
            Stok rendah
          </Badge>
          <Badge tone="danger" icon={<CircleSlash className="size-3" aria-hidden />}>
            Habis
          </Badge>
          <Badge>Diarsipkan</Badge>
          <Badge tone="ink">Sprint 2</Badge>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-8">
          <Stamp tone="positive">Lunas</Stamp>
          <Stamp tone="danger" tilt={5}>
            Void
          </Stamp>
          <Stamp tone="ink" tilt={-2}>
            Arsip
          </Stamp>
        </div>
      </Section>

      <Section title="Nota & empty state">
        <div className="grid items-start gap-8 md:grid-cols-[18rem_1fr]">
          <Receipt>
            <div className="font-display font-bold">Contoh nota</div>
            <div className="num mb-3 text-[0.6875rem] text-text-subtle">Komponen · data contoh</div>
            <ReceiptRow label="Subtotal" value="Rp 50.000" muted />
            <ReceiptRow label="Diskon" value="−Rp 5.000" muted />
            <ReceiptRow label="Total" value="Rp 45.000" strong />
          </Receipt>
          <EmptyState icon={<PackageSearch className="size-5" aria-hidden />} title="Tidak ada produk stok rendah">
            Semua produk berada di atas stok minimum. Kosong di sini adalah kabar baik.
          </EmptyState>
        </div>
      </Section>
    </div>
  )
}
