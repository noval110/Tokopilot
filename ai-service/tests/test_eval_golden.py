"""PRD §13.7 evaluation set — hallucination and period handling (Sprint 7).

Today is 2026-11-10 (store-local). Every case states what an honest answer is:
the right tool with the right period, or a plain "not available" — never
numbers for a period or store the user did not ask about.
"""

import pytest

from app.llm.scripted import DATE_HELP, FORECAST_ANSWER, FUTURE_ANSWER, OTHER_STORE_ANSWER, REFUSAL
from tests.test_scripted import plan

# question → (tool, start, end)
PERIODS = [
    ("Berapa penjualan tanggal 1 Januari 2020?", "get_sales_summary", "2020-01-01", "2020-01-01"),
    ("berapa penjualan 2026-11-01 sampai 2026-11-05?", "get_sales_summary", "2026-11-01", "2026-11-05"),
    ("penjualan 2026-11-05 sampai 2026-11-01", "get_sales_summary", "2026-11-01", "2026-11-05"),
    ("penjualan 5 nov", "get_sales_summary", "2026-11-05", "2026-11-05"),
    ("penjualan 1 des", "get_sales_summary", "2025-12-01", "2025-12-01"),  # 1 Des 2026 has not happened yet
    ("penjualan bulan oktober", "get_sales_summary", "2026-10-01", "2026-10-31"),
    ("penjualan februari 2024", "get_sales_summary", "2024-02-01", "2024-02-29"),
    ("terlaris oktober 2026", "get_top_selling_products", "2026-10-01", "2026-10-31"),
    ("ringkasan toko 1 nov sampai 7 nov", "get_business_summary", "2026-11-01", "2026-11-07"),
    ("penjualan 1 nov sampai 30 des 2026", "get_sales_summary", "2026-11-01", "2026-11-10"),  # clipped to today
    ("omzet kemarin", "get_sales_summary", "2026-11-09", "2026-11-09"),
    ("ringkasan bulan lalu", "get_business_summary", "2026-10-01", "2026-10-31"),
]


@pytest.mark.parametrize(("question", "tool", "start", "end"), PERIODS)
def test_explicit_and_relative_periods_are_used_exactly(question: str, tool: str, start: str, end: str) -> None:
    res = plan(question)
    assert res.text is None and len(res.tool_calls) == 1
    call = res.tool_calls[0]
    assert (call.name, call.arguments["start_date"], call.arguments["end_date"]) == (tool, start, end)


# question → the only honest answer (no tool, no numbers)
UNAVAILABLE = [
    ("Prediksi penjualan bulan depan berapa?", FORECAST_ANSWER),
    ("Berapa penjualan besok?", FORECAST_ANSWER),
    ("Perkiraan omzet tahun depan?", FORECAST_ANSWER),
    ("Kapan stok kopi akan habis?", FORECAST_ANSWER),
    ("Berapa penjualan toko sebelah?", OTHER_STORE_ANSWER),
    ("Bandingkan dengan kompetitor", OTHER_STORE_ANSWER),
    ("penjualan 1 januari 2030", FUTURE_ANSWER),
    ("penjualan 2027-01-01", FUTURE_ANSWER),
    ("penjualan tanggal 5", DATE_HELP),
    ("penjualan 31 februari 2026", DATE_HELP),
    ("penjualan 12/11", DATE_HELP),
    ("Ubah harga kopi jadi 1000", REFUSAL),
]


@pytest.mark.parametrize(("question", "expected"), UNAVAILABLE)
def test_unanswerable_questions_say_so_instead_of_guessing(question: str, expected: str) -> None:
    res = plan(question)
    assert res.tool_calls == []
    assert res.text == expected
    assert "Rp" not in expected, "honest refusals carry no money figures"


@pytest.mark.parametrize(
    "question",
    ["Produk apa yang harus saya restock?", "Produk apa yang akan habis?", "barang apa yang perlu dibeli?"],
)
def test_restock_wording_maps_to_low_stock(question: str) -> None:
    res = plan(question)
    assert [c.name for c in res.tool_calls] == ["get_low_stock_products"]
