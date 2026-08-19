# VanMoof SX3 Display — Image / Animation Format

**Status: VERIFIED WORKING.** The container layout was confirmed against
the firmware machine code (`Display_RenderFullImage` @ `0x0802f5c0`, pixel
index at `0x0802f650`, duration index at `0x0802f6c4`) and by decoding
every stock image plus a hand-supplied lightning frame on real hardware.
The practical, hobbyist-facing writeup of the format — container layout,
pixel-word formula, and a reference decoder — lives in `../guide/README.md`
section 4; this document keeps only the verification narrative and the
image catalogue pointer, so the two don't drift out of sync.

> **The single most important correction:** images are
> **FRAME-INTERLEAVED**, not row-sequential. An earlier version of this
> document described a row-sequential layout. That was wrong and
> scrambled every multi-frame animation. A single-frame image (the ship)
> happens to decode identically under both layouts, which masked the bug
> for a long time.

---

## 1. How the frame-interleaved bug was found

The firmware computes the pixel **word index** for a given relative row
and frame with an `mla` (multiply-accumulate) instruction at
`0x0802f650`, using `r6 = num_frames` as the multiplier:

```
pixelWord(relRow, frame) = num_frames * relRow + frame + num_frames + 3
```

The `num_frames * relRow` term is the detail that matters: consecutive
rows are **`num_frames` words apart**, i.e. all frames of a given row are
stored contiguously, with the frame axis as the *inner* (fastest)
dimension. A naive "frame base + row*4" decoder — which is what a
row-sequential reading of the layout would suggest — produces garbage for
any image with `num_frames > 1`.

Static (1-frame) images are the trap: with `num_frames = 1` the
interleaved and row-sequential formulas produce the same addresses, so a
decoder built and tested only against the ship icon looks correct and
then falls apart the moment it is pointed at an animation. That is
exactly what happened during the initial pass over this format, and why
the correction above is called out so prominently — the bug is invisible
until you test against a multi-frame image.

The exact formula, the row's bit-packing, and a working reference decoder
are in `../guide/README.md` section 4.

---

## 2. Cross-checking the image boundaries

Beyond decoding individual frames, the container's self-describing size
was used as an independent check on the whole extraction. Total size in
bytes equals the last valid pixel-word index plus one, times four:

```
maxWord     = num_frames*(graphic_rows-1) + (num_frames-1) + num_frames + 3
sizeInBytes = (maxWord + 1) * 4
```

Every extracted image was checked against this formula and confirmed to
abut the next exactly in flash — no gaps, no overlap — which is strong
evidence the header fields (`start_row`, `graphic_rows`, `num_frames`) are
being read correctly and the walker isn't drifting.

This check also caught a real error during testing: a hand-copied
lightning animation blob came out 656 bytes instead of the correct 652
(one word too long) and produced one corrupt frame at the end. Extracting
straight from the binary with the size formula above, rather than
copying byte ranges by hand, avoids this class of mistake entirely.

---

## 3. Image catalogue

**The image count in earlier notes (35) is stale.** That was the count
found by walking pointer references directly visible in
`Display_ContentController` and `Display_BatteryGaugeHandler`. A later,
more thorough extraction pass walked the container headers back-to-back
starting at the first known image address and self-describing size (§2)
rather than following only code-visible pointers — that pass found
**54 images total**, including a number that are only reached through
indexed lookups rather than direct pointer references.

The current, authoritative catalogue — all 54 images with their firmware
addresses, header fields, sizes, and both machine- and human-readable
names — lives in:

* `../editor/gallery/README.md` — how the catalogue was built and what's in it
* `../editor/gallery/firmware_gallery.json` — the full data, one entry
  per image (also consumed directly by the browser gallery/editor via
  `../editor/gallery/firmware_gallery.js`)

Do not treat any image list in this document as current; the JSON file is
regenerated whenever the extraction improves; this document is not.
