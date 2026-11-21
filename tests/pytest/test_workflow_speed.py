"""CI wall time is set by the slowest job. make-motion's suite (about 2,300 s of tests, 830 s wall on one runner in
the run of 2026-11-21) is split into shards, and a newer push to a PR cancels the run it replaces. Stdlib only."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / ".github/workflows/test.yml").read_text()
MOTION_SHARDS = 4


def _matrix_rows():
    return re.findall(r"^\s+- \{ name: '?([^,']+)'?, dir: ([\w/-]+)(?:, shard: (\d+)/(\d+))? \}", WORKFLOW, re.M)


def test_make_motion_runs_as_four_shards_that_cover_every_file():
    rows = [r for r in _matrix_rows() if r[1] == "skills/make-motion"]
    assert len(rows) == MOTION_SHARDS, rows
    assert sorted(int(r[2]) for r in rows) == list(range(1, MOTION_SHARDS + 1))
    assert {int(r[3]) for r in rows} == {MOTION_SHARDS}
    assert all(r[0] == f"make-motion {r[2]}/{r[3]}" for r in rows), "the check name carries the shard"


def test_every_make_motion_shard_turns_a_missing_browser_or_ffmpeg_into_a_failure():
    for flag in ("PA_REQUIRE_RENDER", "PA_REQUIRE_BROWSER"):
        line = re.search(rf"^\s+{flag}: (.+)$", WORKFLOW, re.M).group(1)
        assert "startsWith(matrix.name, 'make-motion')" in line, f"{flag} must apply to every make-motion shard: {line}"


def test_a_newer_push_to_a_pull_request_cancels_the_run_it_replaces():
    block = re.search(r"^concurrency:\n((?:  .+\n)+)", WORKFLOW, re.M)
    assert block, "no top-level concurrency block"
    assert "github.event.pull_request.number" in block.group(1)
    assert re.search(r"cancel-in-progress: \$\{\{ github.event_name == 'pull_request' \}\}", block.group(1)), \
        "cancel only superseded PR runs, never a push to main"
