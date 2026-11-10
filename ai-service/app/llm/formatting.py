"""Indonesian formatting for answers. Numbers are rendered, never recomputed."""

import re
from datetime import date, datetime

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
_TZ_LABEL = {"Asia/Jakarta": "WIB", "Asia/Makassar": "WITA", "Asia/Jayapura": "WIT"}


def idr(amount: int | float) -> str:
    """136000 → 'Rp 136.000'. Amounts arrive as integer rupiah from tools."""
    n = int(amount)
    sign = "−" if n < 0 else ""
    return f"Rp {sign}{abs(n):,}".replace(",", ".")


def qty(value: str, unit: str | None = None) -> str:
    """NUMERIC text '1.500' → '1,5'; '12000.000' → '12.000'."""
    m = re.fullmatch(r"(-?)(\d+)(?:\.(\d+))?", str(value).strip())
    if not m:
        return str(value)
    sign, whole, frac = m.group(1), m.group(2), (m.group(3) or "").rstrip("0")
    grouped = f"{int(whole):,}".replace(",", ".")
    text = f"{sign}{grouped}{',' + frac if frac else ''}"
    return f"{text} {unit}" if unit else text


def day(d: str) -> str:
    x = date.fromisoformat(d)
    return f"{x.day} {_MONTHS[x.month - 1]} {x.year}"


def period(start: str, end: str) -> str:
    """'2026-11-04','2026-11-10' → '4–10 Nov 2026'."""
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    if a == b:
        return day(start)
    if (a.year, a.month) == (b.year, b.month):
        return f"{a.day}–{b.day} {_MONTHS[b.month - 1]} {b.year}"
    if a.year == b.year:
        return f"{a.day} {_MONTHS[a.month - 1]} s.d. {b.day} {_MONTHS[b.month - 1]} {b.year}"
    return f"{day(start)} s.d. {day(end)}"


def as_of(ts: str, timezone: str) -> str:
    """RFC3339 local timestamp → '10 Nov 2026, 15.20 WIB'."""
    try:
        t = datetime.fromisoformat(ts)
    except ValueError:
        return ts
    return f"{t.day} {_MONTHS[t.month - 1]} {t.year}, {t.hour:02d}.{t.minute:02d} {_TZ_LABEL.get(timezone, timezone)}"


def data_name(name: object, limit: int = 80) -> str:
    """Render untrusted store data (e.g. a product name) as inert quoted text."""
    s = " ".join(str(name).split())
    if len(s) > limit:
        s = s[: limit - 1] + "…"
    return f"“{s}”"
