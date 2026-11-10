# ADR-0006 — Vendor dan model LLM

**Status:** Open — **belum diputuskan**. Sprint 6 berjalan dengan provider pengganti `scripted` (keputusan pemilik produk, 10 Nov 2026); hanya penggantian ke vendor sungguhan yang menunggu ADR ini.

Sesuai PRD §20.2, agent tidak memilih vendor. Yang sudah disiapkan:

- `LLM_PROVIDER=none` membuat AI service tetap bisa boot dan lulus health check.
- Arsitektur adapter: satu interface `LLMProvider` (`ai-service/app/llm/base.py`) dengan implementasi per vendor.
- `LLM_PROVIDER=scripted` (Sprint 6): adapter deterministik berbasis pola Bahasa Indonesia yang memakai tool sungguhan lewat jalur yang sama dengan vendor. Bukan model bahasa — hanya untuk demo, test end-to-end, dan sebagai pembanding golden set.
- Langkah menambahkan vendor: [api/assistant.md § Menambahkan vendor nanti](../api/assistant.md#menambahkan-vendor-nanti).

## Kriteria evaluasi (diusulkan)

1. Kualitas Bahasa Indonesia untuk percakapan operasional toko.
2. Keandalan tool calling (argumen JSON valid sesuai schema) — diukur dengan golden set Sprint 6.
3. Latensi p95 (target total jawaban < 15 detik, NFR-10).
4. Biaya per percakapan pada beban demo.
5. Kebijakan data: tidak dipakai untuk training, retensi, lokasi pemrosesan.

## Keputusan yang dibutuhkan dari pemilik produk

Daftar kandidat vendor yang boleh dievaluasi dan anggaran demo.
