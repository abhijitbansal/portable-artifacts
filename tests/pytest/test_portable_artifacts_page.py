"""Structure checks for the site: docs/index.html (cover plus five skill sheets) and
docs/gallery.html (the register). Stdlib only.

What these pin: the sheet order, the install copy-button contract in AGENTS.md, that every
local file the pages point at exists, that each spec's KB label and the register's plate count
are true, that spec lines and plate tags pair up, and that the old one-page anchors still land.
The capability counts on the sheets (chart kinds, shot kinds and so on) are not checked here.
"""
import json
import re
import struct
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote

import pytest

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
PAGE = DOCS / "index.html"
GALLERY = DOCS / "gallery.html"
PAGES = (PAGE, GALLERY)
PLUGIN_JSON = ROOT / "plugins" / "portable-artifacts" / ".claude-plugin" / "plugin.json"
SKILLS = ("make-motion", "make-explainer", "make-diagram", "make-dashboard", "make-scene")  # page order
SHEET_ORDER = ("reel", "films") + SKILLS + ("notes", "gallery")
EXAMPLES = (
    ROOT / "plugins" / "portable-artifacts" / "skills" / "make-motion"
    / "references" / "examples" / "v2"
)
GAL = "showcase/portable-artifacts/gallery"
# Each film folder under gallery/ keeps a copy of the film file it was rendered from.
FILM_SOURCES = {
    GAL + "/showreel/pro": "showreel-pro.json",
    GAL + "/showreel/viral": "showreel-viral.json",
    GAL + "/showreel/whats-new": "whats-new.json",
    GAL + "/looks/cosmos": "look-cosmos.json",
    GAL + "/looks/ledger": "gate-ledger.json",
    GAL + "/looks/poster": "look-poster.json",
    GAL + "/looks/keynote": "gate-keynote.json",
    GAL + "/looks/marker": "gate-marker.json",
}
# Ids the previous one-page site had; links to them must still land somewhere.
OLD_IDS = (
    "films", "quick-install", "skills", "details", "whats-new", "overview", "showcase",
    "showcase-motion", "showcase-dashboard", "gallery", "gallery-motion-1-4", "why",
    "install", "requirements", "usability", "security", "licences", "inventory",
    "gallery-dashboard", "gallery-motion", "gallery-explainer", "gallery-diagram",
    "gallery-scene", "film-whats-new", "film-pro", "film-viral", "featured-diagram", "whats-new-0-8-0",
    "clip-beats", "clip-promo", "clip-showcase-features",
)


class _Collect(HTMLParser):
    """Collects start tags as (tag, attrs dict) in document order."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags = []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))

    handle_startendtag = handle_starttag


def _tags(path):
    parser = _Collect()
    parser.feed(path.read_text(encoding="utf-8"))
    return parser.tags


def _text(path):
    return path.read_text(encoding="utf-8")


def _section(page, section_id):
    """Markup of the <section ... id="section_id" ...> block (non-greedy), or ''."""
    match = re.search(
        r'<section\b[^>]*\bid="%s"[^>]*>(.*?)</section>' % re.escape(section_id), page, re.S
    )
    return match.group(1) if match else ""


def _local(ref):
    """The docs-relative path a src/href points at, or None for remote, anchor or data refs."""
    if not ref or ref.startswith(("#", "data:", "mailto:", "javascript:")):
        return None
    parts = urlsplit(ref)
    if parts.scheme or parts.netloc:
        return None
    return unquote(parts.path) or None


def test_both_pages_exist_with_one_h1():
    for path in PAGES:
        assert path.is_file(), path
        assert len(re.findall(r"<h1\b", _text(path))) == 1, path.name


def test_reel_then_cover_then_five_sheets_then_notes_and_register_in_order():
    page = _text(PAGE)
    offsets = []
    for sheet_id in SHEET_ORDER:
        match = re.search(r'<section\b[^>]*\bid="%s"' % re.escape(sheet_id), page)
        assert match, f"missing <section id={sheet_id}>"
        offsets.append(match.start())
    assert offsets == sorted(offsets), "sheets are out of order"
    main_at = page.index('<main id="main">')
    first = re.compile(r'<section\b[^>]*\bid="([\w-]+)"').search(page, main_at)
    assert first and first.group(1) == "reel", "the reel band must be the first section in <main>"


def test_quick_install_copy_buttons_hold_one_command_without_comment():
    block = _section(_text(PAGE), "quick-install")
    buttons = re.findall(r'<button class="copy" type="button" data-copy="([^"]*)">', block)
    assert len(buttons) >= 3
    assert block.count('<div class="cl">') == len(buttons), "one .cl row per copy button"
    for cmd in buttons:
        assert "\n" not in cmd and "#" not in cmd, cmd
        assert cmd.startswith(("/plugin marketplace add ", "/plugin install ", "npx skills add ")), cmd
        assert "abhijitbansal/portable-artifacts" in cmd or cmd.startswith("/plugin install portable-artifacts@"), cmd


def test_every_local_src_href_and_poster_resolves():
    missing = []
    for path in PAGES:
        for tag, attrs in _tags(path):
            for key in ("src", "href", "poster", "data-full-film", "data-poster"):
                rel = _local(attrs.get(key))
                if rel and rel.endswith("/source.zip"):
                    continue  # built into _site at deploy by scripts/build_dashboard_gallery.py
                if rel and not (path.parent / rel).resolve().exists():
                    missing.append(f"{path.name}: <{tag} {key}={rel}>")
    assert not missing, "\n".join(missing)


def test_videos_are_muted_loops_with_poster_and_label_and_never_autoplay():
    videos = [a for t, a in _tags(PAGE) + _tags(GALLERY) if t == "video"]
    assert len(videos) == 3  # the reel, the cover plate, the make-motion plate
    for attrs in videos:
        assert "autoplay" not in attrs, "pa.js plays loops in view; never autoplay in markup"
        for key in ("muted", "playsinline", "poster", "aria-label"):
            assert key in attrs, key
        assert attrs.get("preload") in ("none", "metadata")
        assert (DOCS / attrs["src"]).stat().st_size < 2_000_000, "plate loops stay under 2 MB"


def test_scripts_and_styles_load_only_from_assets():
    for path in PAGES:
        for tag, attrs in _tags(path):
            if tag == "script" and "src" in attrs:
                assert attrs["src"].startswith("assets/"), attrs["src"]
            if tag == "link" and attrs.get("rel") == "stylesheet":
                assert attrs["href"].startswith("assets/"), attrs["href"]


def test_spec_lines_and_plate_tags_pair_up_on_every_sheet():
    page = _text(PAGE)
    for skill in SKILLS:
        sheet = _section(page, skill)
        assert "data-leader" in re.search(r'<section\b[^>]*\bid="%s"[^>]*>' % skill, page).group(0)
        spec = sorted(re.findall(r'<li tabindex="0" role="button" aria-pressed="false" data-tag="(\d+)"', sheet))
        tags = sorted(re.findall(r'<span class="tag" data-tag="(\d+)"', sheet))
        assert spec and spec == tags, f"{skill}: spec lines {spec} vs plate tags {tags}"


def test_spec_size_labels_match_the_linked_spec_files():
    page = _text(PAGE)
    for skill in SKILLS:
        head = re.search(
            r'<div class="spec-head"><span>([\w.]+) · ([\d.]+) KB</span><a href="([^"]+)">',
            _section(page, skill),
        )
        assert head, f"{skill}: no spec head"
        name, label, href = head.groups()
        spec = DOCS / href
        assert spec.name == name, f"{skill}: label says {name}, link is {spec.name}"
        assert label == f"{spec.stat().st_size / 1000:.1f}", f"{skill}: {label} KB vs {spec.stat().st_size} bytes"


def test_reel_loop_is_light_and_its_chapter_specs_exist():
    loop = DOCS / "media" / "reel-loop.mp4"
    assert loop.stat().st_size <= 2 * 1024 * 1024, f"{loop}: {loop.stat().st_size} bytes"
    reel = _section(_text(PAGE), "reel")
    assert 'data-full-film="showcase/portable-artifacts/gallery/showreel/reel/video.mp4"' in reel
    chapters = sorted((DOCS / GAL / "showreel" / "reel" / "chapters").glob("*.json"))
    assert len(chapters) >= 8, chapters
    for chapter in chapters:
        assert '"version": 2' in chapter.read_text(encoding="utf-8"), chapter


def test_title_block_revision_matches_plugin_version():
    version = json.loads(PLUGIN_JSON.read_text(encoding="utf-8"))["version"]
    assert f"<dt>Revision</dt><dd>{version}</dd>" in _text(PAGE)


def test_og_image_is_a_1200_by_630_png():
    data = (DOCS / "og.png").read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack(">II", data[16:24])
    assert (width, height) == (1200, 630)
    assert 'content="https://abhijitbansal.github.io/portable-artifacts/og.png"' in _text(PAGE)


def _legacy_table():
    script = (DOCS / "assets" / "pa.js").read_text(encoding="utf-8")
    table = re.search(r"const LEGACY = \{(.*?)\n  \};", script, re.S).group(1)
    pairs = re.findall(r'^\s*"?([\w-]+)"?:\s*(?:REPO \+ )?"([^"]+)"', table, re.M)
    return script, dict(pairs)


def test_old_anchors_still_land():
    page = _text(PAGE)
    script, legacy = _legacy_table()
    prefix_rule = 'startsWith("clip-")' in script
    for old in OLD_IDS:
        landed = f'id="{old}"' in page or old in legacy or (prefix_rule and old.startswith("clip-"))
        assert landed, f"#{old} lands nowhere"


def test_legacy_redirect_targets_exist():
    pages = {"": _text(PAGE), "gallery.html": _text(GALLERY)}
    _, legacy = _legacy_table()
    for old, target in legacy.items():
        if target.startswith(("http", "plugins/")):
            continue
        name, _, frag = target.partition("#")
        assert name in pages, f"#{old} -> {target}: unknown page"
        if frag:
            assert f'id="{frag}"' in pages[name], f"#{old} -> {target}: no such id"


def test_same_page_redirect_scrolls_to_its_target():
    script, _ = _legacy_table()
    # history.replaceState alone never scrolls; the redirect must move the view itself.
    assert re.search(r"replaceState\([^)]*\);\s*\n?\s*[^\n]*scrollIntoView", script), "same-page redirect does not scroll"


def test_register_groups_link_a_page_and_a_spec_for_every_plate():
    gallery = _text(GALLERY)
    for group in ("dashboards", "diagrams", "explainers", "films", "scenes"):
        block = _section(gallery, group)
        items = re.findall(r'<figure class="reg-item[^"]*">(.*?)</figure>', block, re.S)
        assert items, group
        for item in items:
            assert re.search(r'>spec</a>', item), f"{group}: a plate without its spec"
    count = len(re.findall(r'<figure class="reg-item', gallery))
    assert f"Register · {count} plates" in gallery


@pytest.mark.parametrize("folder,source", sorted(FILM_SOURCES.items()))
def test_gallery_film_files_match_the_examples(folder, source):
    copy = DOCS / folder / "film.json"
    assert copy.read_bytes() == (EXAMPLES / source).read_bytes(), f"{copy} drifted from {source}"


# Gallery outputs themselves (kept from the one-page site's tests).
SIMPLE_EXPLAINERS = (
    "explainer-page/index.html", "explainer-page/press/index.html", "explainer-page/poster/index.html",
    "explainer-deck/index.html", "explainer-deck-press/index.html", "explainer-deck-poster/index.html",
    "features-explainer/index.html", "features-explainer/press/index.html",
    "features-explainer/poster/index.html",
    "plan-page/index.html", "plan-page/brief/index.html",
)
VOICED_FILMS = ("showreel/pro", "showreel/viral", "showreel/reel", "looks/poster")


def test_each_gallery_explainer_has_the_simple_english_toggle():
    for name in SIMPLE_EXPLAINERS:
        built = DOCS / GAL / name
        assert built.is_file(), name
        assert "data-simple-toggle" in built.read_text(encoding="utf-8"), name


def test_gallery_films_stay_under_the_repo_size_warning():
    for video in (DOCS / GAL).glob("*/*/video.mp4"):
        assert video.stat().st_size <= 30 * 1024 * 1024, f"{video}: {video.stat().st_size} bytes"


def test_full_films_linked_with_sound_have_an_audio_stream():
    import shutil
    import subprocess
    ffprobe = shutil.which("ffprobe")
    if ffprobe is None:
        pytest.skip("ffprobe is not on PATH")
    for film in VOICED_FILMS:
        video = DOCS / GAL / film / "video.mp4"
        out = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "a", "-show_entries",
             "stream=codec_name", "-of", "csv=p=0", str(video)],
            capture_output=True, text=True, check=True,
        ).stdout.split()
        assert out, f"no audio stream in {video}"
