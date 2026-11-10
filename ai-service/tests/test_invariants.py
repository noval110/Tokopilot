"""Guards for PRD §11.3 / §13.4: the AI service must never reach the business database."""

import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN = (
    "psycopg",
    "asyncpg",
    "sqlalchemy",
    "sqlmodel",
    "pg8000",
    "databases",
    "tortoise",
    "peewee",
)


def test_no_database_drivers_in_dependencies() -> None:
    project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    deps = list(project["dependencies"])
    for extra in project.get("optional-dependencies", {}).values():
        deps.extend(extra)
    names = [d.split("[")[0].split(">")[0].split("=")[0].split("<")[0].strip().lower() for d in deps]
    leaked = [n for n in names if any(n.startswith(f) for f in FORBIDDEN)]
    assert not leaked, f"AI service must not depend on database drivers: {leaked}"


def test_no_database_imports_in_source() -> None:
    offenders = []
    for path in (ROOT / "app").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for mod in FORBIDDEN:
            if f"import {mod}" in text or f"from {mod}" in text:
                offenders.append(f"{path.relative_to(ROOT)}: {mod}")
    assert not offenders, offenders


def test_settings_have_no_database_url() -> None:
    from app.core.config import Settings

    assert not any("database" in f or "dsn" in f for f in Settings.model_fields)
