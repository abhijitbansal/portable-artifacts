"""Every relative image and link target in the root README and the plugin README must exist.

GitHub resolves these paths from the README's own folder, so a renamed or moved file under docs/img/ breaks the
rendered README silently. Absolute URLs, `#anchors` and `mailto:` links are skipped. Fenced code blocks are skipped
(their paths are examples). Stdlib only.
"""
import re
from pathlib import Path
from urllib.parse import unquote

import pytest

ROOT = Path(__file__).resolve().parents[2]
READMES = [ROOT / "README.md", ROOT / "plugins/portable-artifacts/README.md"]

FENCE = re.compile(r"^```.*?^```", re.M | re.S)
MD_TARGET = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HTML_TARGET = re.compile(r"""<(?:img|source)\b[^>]*?\bsrc=["']([^"']+)["']""", re.I)
HTML_IMG_TARGET = re.compile(r"""<img\b[^>]*?\bsrc=["']([^"']+)["']""", re.I)
SKIPPED_PREFIXES = ("http://", "https://", "#", "mailto:", "data:")


def _targets(text: str, *patterns: re.Pattern) -> list[str]:
    stripped = FENCE.sub("", text)
    found: list[str] = []
    for pattern in patterns:
        found += pattern.findall(stripped)
    return [t for t in found if not t.startswith(SKIPPED_PREFIXES)]


def _missing(readme: Path) -> list[str]:
    targets = _targets(readme.read_text(), MD_TARGET, HTML_TARGET)
    missing = []
    for target in targets:
        path = unquote(target.split("#", 1)[0].split("?", 1)[0])
        if path and not (readme.parent / path).resolve().exists():
            missing.append(target)
    return missing


@pytest.mark.parametrize("readme", READMES, ids=lambda p: str(p.relative_to(ROOT)))
def test_every_relative_asset_path_exists(readme: Path) -> None:
    assert readme.exists(), f"{readme} is missing"
    assert _missing(readme) == []


def test_plugin_readme_images_are_found_so_the_check_cannot_pass_vacuously() -> None:
    images = _targets((ROOT / "plugins/portable-artifacts/README.md").read_text(), HTML_IMG_TARGET)
    assert any("docs/img/portable-artifacts/" in image for image in images), images
