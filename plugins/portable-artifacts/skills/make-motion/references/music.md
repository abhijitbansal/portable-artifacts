# Cutting to the user's music

Read this when the tempo `beats.mjs` prints is not the one you hear.

Check the `bpm` it prints against the track: it can be half, double or 2/3 of the tempo you hear. `--bpm 128` forces the grid at an exact tempo; for a tempo you know only roughly, give `--min-bpm` and `--max-bpm` from about 0.8 to 1.25 times it.

Exit 1 with `no steady beat found` means the track has no steady beat: let the narration set the cuts, or lower `--min-confidence` only if you can hear a beat.

Known misreads, each fixed one of those two ways: a kick on 1 and 3 from about 115 BPM (half), a slow groove with ghost notes below about 75 (double), bossa (half, 2/3 or double), polka (2/3), 6/8 (its eighth notes) and anything below 60 BPM (no beat). A reggae one-drop reads at double and a swing of 70 ms or more reads at half on the straight hits: keep those reads. Sparse clicks under heavy noise are refused: give `--bpm`. Narration can pass the gate: `--min-confidence 0.6` refuses it. No flag fixes a ritardando or a song that changes tempo.
