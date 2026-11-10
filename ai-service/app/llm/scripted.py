"""Deterministic stand-in provider (ADR-0006: no vendor chosen yet).

It behaves like a well-behaved tool-calling model so the whole pipeline
(allowlist, Go-side execution, tenant scope, error handling) can be built and
tested end to end. It is code, not a language model: it cannot be talked into
anything, and every number it says is copied from a tool result.
"""

import json
import re
from datetime import date, timedelta
from itertools import count
from typing import Any

from app.llm.base import LLMResult, ProposedToolCall
from app.llm.formatting import as_of, data_name, idr, period, qty
from app.schemas.chat import ChatContext, ChatMessage, ToolDef

_ids = count(1)

MUTATION = re.compile(
    r"\b(ubah|ganti|hapus|tambahkan|tambah|kurangi|naikkan|turunkan|set|update|edit|buatkan|buat|batalkan|void|"
    r"arsipkan|transfer|kirim|bayar|reset)\b.*\b(harga|stok|produk|transaksi|nota|akun|pengaturan|toko|staf|password|data)\b"
)
LOW_STOCK = re.compile(
    r"hampir habis|mau habis|akan habis|stok (rendah|menipis|minim|kritis)|menipis|restock|perlu (dibeli|dipesan|diisi)"
    r"|kehabisan|stok minimum|yang habis"
)
# Questions the data cannot answer honestly: the future, or another store.
FORECAST = re.compile(
    r"prediksi|perkiraan|ramal|proyeksi|forecast|bulan depan|minggu depan|pekan depan|tahun depan|besok|lusa"
    r"|kapan\b.*\bhabis"
)
OTHER_STORE = re.compile(r"toko (lain|sebelah|tetangga|orang|pesaing|kompetitor)|kompetitor|pesaing|cabang lain")
_MONTHS = {
    "januari": 1,
    "jan": 1,
    "februari": 2,
    "feb": 2,
    "maret": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "mei": 5,
    "juni": 6,
    "jun": 6,
    "juli": 7,
    "jul": 7,
    "agustus": 8,
    "agu": 8,
    "agt": 8,
    "september": 9,
    "sep": 9,
    "oktober": 10,
    "okt": 10,
    "november": 11,
    "nov": 11,
    "desember": 12,
    "des": 12,
}
_MONTH_RE = "|".join(sorted(_MONTHS, key=len, reverse=True))
_ISO_DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_DAY_MONTH = re.compile(rf"\b(\d{{1,2}})\s+({_MONTH_RE})\b(?:\s+(\d{{4}}))?")
_MONTH_YEAR = re.compile(rf"\b(?:bulan\s+)?({_MONTH_RE})\b(?:\s+(\d{{4}}))?")
_DATEISH = re.compile(r"\btanggal\b|\btgl\b|\d{1,2}[/.]\d{1,2}")
TOP = re.compile(r"terlaris|paling (laku|laris|banyak terjual)|best ?seller|produk (top|unggulan)|laku keras")
BUSINESS = re.compile(
    r"kondisi toko|keadaan toko|ringkasan|rangkuman|performa|kinerja|bagaimana (toko|bisnis|usaha)|overview|gambaran"
)
SALES = re.compile(r"penjualan|omzet|omset|pendapatan|pemasukan|transaksi|jualan|terjual berapa")
STOCK = re.compile(r"\b(stok|stoknya|sisa|persediaan)\b")

_FILLER = {
    "berapa",
    "stok",
    "stoknya",
    "sisa",
    "persediaan",
    "produk",
    "barang",
    "untuk",
    "masih",
    "ada",
    "yang",
    "dong",
    "ya",
    "kah",
    "saat",
    "ini",
    "sekarang",
    "cek",
    "lihat",
    "tolong",
    "coba",
    "apa",
    "aja",
    "saja",
    "di",
    "toko",
    "kita",
    "saya",
    "tersedia",
    "punya",
    "jumlah",
}

HELP = (
    "Saya bisa membantu membaca data toko, misalnya:\n"
    "• produk yang hampir habis\n"
    "• stok produk tertentu (sebutkan nama atau SKU)\n"
    "• penjualan hari ini, minggu ini, atau bulan ini\n"
    "• produk terlaris\n"
    "• ringkasan kondisi toko"
)

REFUSAL = (
    "Saya hanya bisa membaca data toko. Saya tidak dapat mengubah harga, stok, transaksi, akun, atau pengaturan. "
    "Untuk perubahan, gunakan menu Produk, Inventaris, atau Kasir."
)


FORECAST_ANSWER = (
    "Saya hanya membaca data yang sudah tercatat, jadi tidak dapat memprediksi penjualan atau kapan stok habis. "
    "Yang bisa saya tampilkan: stok saat ini, produk yang hampir habis, dan penjualan pada periode yang sudah lewat."
)
OTHER_STORE_ANSWER = "Saya hanya dapat membaca data tokomu sendiri. Data toko lain tidak tersedia untuk saya."
DATE_HELP = (
    "Tanggalnya belum dapat saya pahami. Tulis lengkap, misalnya “1 Nov 2026”, “2026-11-01 sampai 2026-11-05”, "
    "atau “bulan Oktober 2026”."
)
FUTURE_ANSWER = "Periode itu belum terjadi. Saya hanya membaca data yang sudah tercatat, bukan prediksi."


def _safe_date(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _explicit_period(text: str, today: date) -> tuple[str, str] | str | None:
    """Explicit dates in the question → (start, end); an answer string when they cannot be
    used honestly; None when the question names no date at all."""
    days: list[date | None] = [_safe_date(int(y), int(m), int(d)) for y, m, d in _ISO_DATE.findall(text)]
    rest = _ISO_DATE.sub(" ", text)
    for d, mon, y in _DAY_MONTH.findall(rest):
        year = int(y) if y else today.year
        candidate = _safe_date(year, _MONTHS[mon], int(d))
        if candidate and not y and candidate > today:
            candidate = _safe_date(year - 1, _MONTHS[mon], int(d))
        days.append(candidate)
    rest = _DAY_MONTH.sub(" ", rest)
    if None in days:
        return DATE_HELP
    found = [d for d in days if d is not None]
    if not found:
        month = _MONTH_YEAR.search(rest)
        if month and (month.group(2) or "bulan" in month.group(0)):
            year = int(month.group(2)) if month.group(2) else today.year
            first = date(year, _MONTHS[month.group(1)], 1)
            if not month.group(2) and first > today:
                first = first.replace(year=year - 1)
            nxt = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
            found = [first, nxt - timedelta(days=1)]
        elif _DATEISH.search(rest):
            return DATE_HELP
        else:
            return None
    start, end = min(found), max(found)
    if start > today:
        return FUTURE_ANSWER
    return start.isoformat(), min(end, today).isoformat()


def _period(text: str, today: date, default: str) -> tuple[str, str] | str:
    explicit = _explicit_period(text, today)
    if explicit is not None:
        return explicit
    start, end, _ = _resolve_period(text, today, default)
    return start, end


def _resolve_period(text: str, today: date, default: str) -> tuple[str, str, str]:
    """Relative Indonesian period → (start, end, label). Dates are store-local."""
    rules: list[tuple[str, str]] = [
        (r"hari ini|tadi", "today"),
        (r"kemarin", "yesterday"),
        (r"minggu lalu|pekan lalu", "last_week"),
        (r"minggu ini|pekan ini|seminggu|7 hari", "7d"),
        (r"bulan lalu", "last_month"),
        (r"bulan ini", "month"),
        (r"30 hari|sebulan", "30d"),
    ]
    key = next((k for pat, k in rules if re.search(pat, text)), default)
    if key == "today":
        return today.isoformat(), today.isoformat(), "hari ini"
    if key == "yesterday":
        y = today - timedelta(days=1)
        return y.isoformat(), y.isoformat(), "kemarin"
    if key == "last_week":
        return (
            (today - timedelta(days=13)).isoformat(),
            (today - timedelta(days=7)).isoformat(),
            "7 hari sebelumnya",
        )
    if key == "month":
        return today.replace(day=1).isoformat(), today.isoformat(), "bulan ini"
    if key == "last_month":
        last = today.replace(day=1) - timedelta(days=1)
        return last.replace(day=1).isoformat(), last.isoformat(), "bulan lalu"
    if key == "30d":
        return (today - timedelta(days=29)).isoformat(), today.isoformat(), "30 hari terakhir"
    return (today - timedelta(days=6)).isoformat(), today.isoformat(), "7 hari terakhir"


def _product_query(text: str) -> str:
    words = re.findall(r"[\w.\-/]+", text)
    return " ".join(w for w in words if w not in _FILLER).strip()


def _call(name: str, args: dict[str, Any]) -> LLMResult:
    return LLMResult(tool_calls=[ProposedToolCall(id=f"call_{next(_ids)}", name=name, arguments=args)])


class ScriptedProvider:
    name = "scripted"

    async def complete(self, messages: list[ChatMessage], tools: list[ToolDef], context: ChatContext) -> LLMResult:
        last = messages[-1]
        if last.role == "tool":
            return LLMResult(text=_compose(messages, context))
        if last.role != "user" or not last.content:
            return LLMResult(text=HELP)
        return self._plan(last.content, {t.name for t in tools}, context)

    def _plan(self, raw: str, allowed: set[str], context: ChatContext) -> LLMResult:
        text = " ".join(raw.lower().split())
        today = date.fromisoformat(context.today)
        if MUTATION.search(text):
            return LLMResult(text=REFUSAL)

        def want(name: str, args: dict[str, Any]) -> LLMResult:
            return _call(name, args) if name in allowed else LLMResult(text=HELP)

        def ranged(name: str, default: str, extra: dict[str, Any] | None = None) -> LLMResult:
            p = _period(text, today, default)
            if isinstance(p, str):
                return LLMResult(text=p)
            return want(name, {"start_date": p[0], "end_date": p[1], **(extra or {})})

        if OTHER_STORE.search(text):
            return LLMResult(text=OTHER_STORE_ANSWER)
        if FORECAST.search(text):
            return LLMResult(text=FORECAST_ANSWER)
        if LOW_STOCK.search(text):
            return want("get_low_stock_products", {"limit": 10})
        if TOP.search(text):
            return ranged("get_top_selling_products", "7d", {"limit": 5})
        if BUSINESS.search(text):
            return ranged("get_business_summary", "7d")
        if SALES.search(text):
            return ranged("get_sales_summary", "today")
        if STOCK.search(text):
            q = _product_query(text)
            if not q:
                return LLMResult(text="Produk apa yang ingin dicek stoknya? Sebutkan nama atau SKU-nya.")
            return want("get_product_stock", {"query": q[:100]})
        return LLMResult(text=HELP)


def _tool_outputs(messages: list[ChatMessage]) -> list[tuple[str, dict[str, Any]]]:
    """Tool results since the latest user message, parsed as data."""
    out: list[tuple[str, dict[str, Any]]] = []
    for m in reversed(messages):
        if m.role == "user":
            break
        if m.role == "tool":
            try:
                payload = json.loads(m.content or "{}")
            except json.JSONDecodeError:
                payload = {"error": "hasil alat tidak terbaca"}
            out.append(
                (
                    m.name or "",
                    payload if isinstance(payload, dict) else {"error": "hasil alat tidak terbaca"},
                )
            )
    return list(reversed(out))


def _compose(messages: list[ChatMessage], ctx: ChatContext) -> str:
    parts = []
    for name, data in _tool_outputs(messages):
        if "error" in data:
            parts.append(f"Maaf, data belum dapat diambil ({data['error']}). Saya tidak akan menebak angkanya.")
            continue
        composer = _COMPOSERS.get(name)
        parts.append(composer(data, ctx) if composer else "Data diterima, tetapi jenisnya tidak dikenali.")
    return "\n\n".join(parts) if parts else HELP


def _when(data: dict[str, Any], ctx: ChatContext) -> str:
    return as_of(str(data.get("as_of", "")), ctx.timezone)


def _low_stock(d: dict[str, Any], ctx: ChatContext) -> str:
    products = d.get("products", [])
    if not products:
        return f"Semua produk aktif berada di atas stok minimum (data per {_when(d, ctx)})."
    total = d.get("total_low_stock", len(products))
    lines = [f"Ada {total} produk dengan stok di bawah atau sama dengan minimum (data per {_when(d, ctx)}):"]
    for p in products:
        tag = ", habis" if p.get("status") == "OUT" else ""
        lines.append(
            f"• {data_name(p['name'])}: sisa {qty(p['current_stock'], p.get('unit'))} (min. {qty(p['min_stock'])}){tag}"
        )
    if total > len(products):
        lines.append(f"…dan {total - len(products)} produk lainnya. Lihat menu Inventaris.")
    return "\n".join(lines)


def _product_stock(d: dict[str, Any], ctx: ChatContext) -> str:
    products, q = d.get("products", []), data_name(d.get("query", ""))
    if not products:
        return f"Tidak ada produk aktif yang cocok dengan {q}. Coba nama lain atau SKU-nya."
    if len(products) == 1:
        p = products[0]
        sku = f" ({p['sku']})" if p.get("sku") else ""
        status = {"OK": "aman", "LOW": "stok rendah", "OUT": "habis"}.get(p.get("status", ""), "")
        return (
            f"Stok {data_name(p['name'])}{sku}: {qty(p['current_stock'], p.get('unit'))}, "
            f"minimum {qty(p['min_stock'])}, {status}. Data per {_when(d, ctx)}."
        )
    lines = [f"Ada {d.get('match_count', len(products))} produk yang cocok dengan {q}. Maksudnya yang mana?"]
    for p in products:
        lines.append(f"• {data_name(p['name'])}: {qty(p['current_stock'], p.get('unit'))}")
    return "\n".join(lines)


def _sales(d: dict[str, Any], ctx: ChatContext) -> str:
    per = period(d["period"]["from"], d["period"]["to"])
    n = int(d.get("transaction_count", 0))
    tail = f" Data per {_when(d, ctx)}."
    if n == 0:
        return f"Belum ada penjualan lunas pada {per}.{tail}"
    text = (
        f"Penjualan {per}: bersih {idr(d['net_sales'])} dari {n} transaksi "
        f"(kotor {idr(d['gross_sales'])}, diskon {idr(d['discount_total'])}). "
        f"Rata-rata {idr(d['avg_transaction_value'])} per transaksi."
    )
    voided = int(d.get("voided_count", 0))
    if voided:
        text += f" {voided} transaksi void tidak dihitung."
    return text + tail


def _top(d: dict[str, Any], ctx: ChatContext) -> str:
    per = period(d["period"]["from"], d["period"]["to"])
    products = d.get("products", [])
    if not products:
        return f"Belum ada produk terjual pada {per}, jadi belum ada produk terlaris."
    lines = [f"Produk terlaris {per} (menurut penjualan per produk sebelum diskon transaksi):"]
    for p in products:
        sold = qty(p["quantity_sold"], p.get("unit"))
        lines.append(f"{p['rank']}. {data_name(p['product_name'])}: {sold}, {idr(p['revenue'])}")
    lines.append(f"Data per {_when(d, ctx)}.")
    return "\n".join(lines)


def _business(d: dict[str, Any], ctx: ChatContext) -> str:
    per = period(d["period"]["from"], d["period"]["to"])
    n = int(d.get("transaction_count", 0))
    lines = [f"Ringkasan toko {per}:"]
    lines.append(f"• Penjualan bersih {idr(d['net_sales'])} dari {n} transaksi.")
    cmp = d.get("comparison") or {}
    prev = cmp.get("previous_period") or {}
    pct = cmp.get("net_sales_change_pct")
    if pct is None:
        lines.append(
            f"• Belum ada pembanding: tidak ada penjualan pada {period(prev['from'], prev['to'])}."
            if prev
            else "• Belum ada pembanding."
        )
    else:
        arah = "naik" if pct > 0 else "turun" if pct < 0 else "sama dengan"
        pct_txt = f"{abs(pct):.1f}".replace(".", ",")
        prev_label = period(prev["from"], prev["to"])
        lines.append(f"• {arah.capitalize()} {pct_txt}% dibanding {prev_label} ({idr(cmp['previous_net_sales'])}).")
    lines.append(f"• Stok: {d.get('low_stock_count', 0)} produk perlu restock, {d.get('out_of_stock_count', 0)} habis.")
    top = d.get("top_products") or []
    if top:
        lines.append("• Terlaris: " + ", ".join(data_name(p["product_name"]) for p in top) + ".")
    lines.append(f"Data per {_when(d, ctx)}. Ini ringkasan data tercatat, bukan prediksi.")
    return "\n".join(lines)


_COMPOSERS = {
    "get_low_stock_products": _low_stock,
    "get_product_stock": _product_stock,
    "get_sales_summary": _sales,
    "get_top_selling_products": _top,
    "get_business_summary": _business,
}
