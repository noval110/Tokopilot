# ADR-0001 — Monorepo dan stack

**Status:** Accepted (baseline PRD §11.1, §20.1)

## Keputusan

Satu repository dengan tiga aplikasi independen: `frontend/` (React 19 + TS 6 + Vite 8 + Tailwind 4), `backend/` (Go 1.26 + Echo v5), `ai-service/` (Python 3.13 + FastAPI). Tanpa monorepo tool (Turborepo/Nx) — setiap aplikasi memakai toolchain bawaannya; skrip `scripts/check.*` menjalankan semuanya.

## Catatan versi

- **Echo v5** dipilih karena merupakan rilis stabil saat proyek dimulai. Signature handler `func(c *echo.Context) error`.
- **TypeScript 6.0**, bukan 7.0: `typescript-eslint` belum mendukung TS 7.
- **pnpm** untuk frontend (lockfile deterministik, install cepat).

## Konsekuensi

Tiga pipeline CI terpisah dalam satu workflow. Kontrak antar service didokumentasikan di `docs/api/`.
