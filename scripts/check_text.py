"""Fail on invisible characters in source files.

Editors and tools occasionally write a raw byte where an escape was meant
(a backspace for regex \\b, a no-break space for \\u00a0, a BOM for \\uFEFF).
Such files look right and behave wrong, and linters do not catch them.
Intentional characters must be written as escapes in source code.
"""

import re
import subprocess
import sys
from pathlib import Path

TEXT_SUFFIXES = {
    ".go", ".py", ".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".json", ".sql", ".md", ".yml", ".yaml",
    ".toml", ".ps1", ".sh", ".example", ".txt",
}
# NBSP, zero-width space/joiners, word joiner, BOM, line/paragraph separators.
INVISIBLE = {0x00A0: "NO-BREAK SPACE", 0x200B: "ZERO WIDTH SPACE", 0x200C: "ZWNJ", 0x200D: "ZWJ",
             0x2060: "WORD JOINER", 0xFEFF: "BOM", 0x2028: "LINE SEPARATOR", 0x2029: "PARAGRAPH SEPARATOR"}


def files(root: Path) -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=root, capture_output=True, text=True, check=True,
    ).stdout.splitlines()
    return [root / f for f in out if Path(f).suffix in TEXT_SUFFIXES or Path(f).name == ".env.example"]


# User-facing copy must not use em dashes (they read as machine-written prose).
# Applies to UI source and assistant answers; code comments are exempt.
EM_DASH = "—"
EM_DASH_SCOPES = ("frontend/src/", "ai-service/app/")
COMMENT_LINE = ("//", "*", "/*", "{/*", "#", '"""')
INLINE_COMMENT = re.compile(r"\s(//|\{/\*|#)\s")  # " // ", " {/* ", " # " (not URLs like https://)


def em_dash_problems(rel: str, text: str) -> list[str]:
    if not rel.startswith(EM_DASH_SCOPES) or ".test." in rel:
        return []
    out = []
    for lineno, line in enumerate(text.splitlines(), 1):
        if line.strip().startswith(COMMENT_LINE):
            continue
        code = INLINE_COMMENT.split(line, maxsplit=1)[0]
        if EM_DASH in code:
            out.append(f"{rel}:{lineno}: em dash in user-facing text; rewrite the sentence")
    return out


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    problems = []
    for path in files(root):
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            problems.append(f"{path.relative_to(root)}: not valid UTF-8")
            continue
        problems.extend(em_dash_problems(str(path.relative_to(root)).replace("\\", "/"), text))
        for lineno, line in enumerate(text.splitlines(), 1):
            for col, ch in enumerate(line, 1):
                cp = ord(ch)
                if (cp < 0x20 and ch not in "\t\r") or cp == 0x7F:
                    problems.append(f"{path.relative_to(root)}:{lineno}:{col}: control character U+{cp:04X}")
                elif cp in INVISIBLE:
                    problems.append(f"{path.relative_to(root)}:{lineno}:{col}: {INVISIBLE[cp]} (U+{cp:04X}) — use an escape")
    for p in problems:
        print(p)
    print(f"text check: {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
