"""Validate permanent public URLs and homepage invariants before deployment."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]


def require_file(relative_path: str) -> str:
    path = ROOT / relative_path
    if not path.is_file():
        raise AssertionError(f"Required public path is missing: {relative_path}")
    return path.read_text(encoding="utf-8", errors="strict") if path.suffix != ".pdf" else ""


def require_text(content: str, expected: str, label: str) -> None:
    if expected not in content:
        raise AssertionError(f"Required content is missing from {label}: {expected}")


def main() -> int:
    homepage = require_file("index.html")
    speed_detector = require_file("speeddetector/index.html")
    iscc_page = require_file("papers/xun2026efficient/index.html")
    require_file("papers/files/xun2026efficient-iscc-accepted-2026-04.pdf")

    require_text(speed_detector, "https://gist.github.com/a6d2106a840433eefcb42edc29fe9d27", "speeddetector/index.html")
    require_text(iscc_page, "/papers/files/xun2026efficient-iscc-accepted-2026-04.pdf", "papers/xun2026efficient/index.html")
    require_text(homepage, "/papers/xun2026efficient/", "index.html")
    require_text(homepage, "10.1109/TCOMM.2026.3738510", "index.html")
    require_text(homepage, "data-lang=\"en\"", "index.html")
    require_text(homepage, "Pengcheng Laboratory", "index.html")
    require_text(homepage, "张金钡教授", "index.html")

    print("Site contract passed: permanent URLs and homepage invariants are intact.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as error:
        print(f"Site contract failed: {error}", file=sys.stderr)
        raise SystemExit(1)
