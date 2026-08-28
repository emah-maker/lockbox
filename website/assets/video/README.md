# How-it-works scrub video — asset spec

The real "How it works" scroll-scrubbed video has been generated and lives
in this folder. This file documents what's actually shipped and what
`js/scrollScrub.js` + `index.html` expect, so a future re-generation matches
what the section is built for.

## Files in this folder

| File | Purpose |
|---|---|
| `how-it-works.webm` | VP9/WebM source, listed first so it wins on browsers that support it. Portrait 720×1280, 3.7s, 24fps (88 frames), ~3.2 MB |
| `how-it-works.mp4`  | H.264/MP4 source, the fallback `<source>` and what iOS/Safari will actually play. Same 720×1280/3.7s/24fps/88-frame spec, ~2.7 MB |
| `how-it-works-poster.jpg` | `<video poster="...">` — the first frame, shown before the video is primed/scrubbed, and the only thing reduced-motion/static-fallback visitors who never trigger playback will see |
| `how-it-works-master.mp4` | The untrimmed 6s original the two shipped files were cut down from. **Reference only** — not linked from any HTML/CSS/JS, not to be shipped. Keep it around only so a future re-cut/re-encode has the source to work from. |

`index.html` references `how-it-works.webm`/`.mp4`/`-poster.jpg` by exact
relative path — no code changes are needed for wiring as long as those
three filenames stay put.

## What the footage shows

An overhead shot of the matte black lockbox, camera continuously pushing in
toward the small recessed display on the right side of its top face, ending
in a tight macro of that (intentionally dark/unlit) panel. The camera moves
for the entire 3.7s clip — there is no locked-off tail to rest on, so the
four step cards are cross-faded by scroll progress rather than mapped to
four held poses in the footage itself.

## Actual spec (what's shipped, and what any re-generation should match)

- **Duration:** 3.7 seconds, 24fps, 88 frames, every frame a keyframe.
  Shorter than the original 6–10s target this section was first drafted
  against — the section's scroll-track height (`css/scrollScrub.css`) and
  lerp factor (`js/scrollScrub.js`) have both been tuned against this
  shorter, continuous-push-in clip rather than the old four-beat
  assumption.
- **Dimensions:** 720×1280, **portrait** (9:16). This is a hard change from
  the section's original 16:9 layout — `css/scrollScrub.css` now sizes the
  video box off a 9:16 `aspect-ratio` and lays it out beside the step cards
  on desktop (>=900px) rather than above them, since a tall narrow video
  reads oddly stretched across a full-width row. Don't ship anything wider
  than tall; re-crop to 9:16 before encoding rather than changing the CSS.
- **File-size budget:** current files (~2.7 MB MP4 / ~3.2 MB WebM) load with
  `preload="auto"` once scrub mode engages, blocking on
  `loadedmetadata`/`readyState >= 2` before scrubbing starts. Keep a
  re-encode in the same ballpark — well under the ~8 MB / ~6 MB budget the
  original 16:9 spec allowed, since this clip is both shorter and
  narrower.
- **Audio:** none. The `<video>` element is always `muted` (required for
  inline/autoplay on iOS regardless), so there's nothing to bake in that
  depends on sound — no beat-synced cuts, no dialogue. Encoded with `-an`
  (no audio track at all) rather than a silent one, purely to save bytes.

## The critical part: re-encode for scrubbing, not playback

A normal export places keyframes every ~2–4 seconds. Seeking
(`video.currentTime = ...`) between keyframes forces the browser to decode
forward from the last keyframe, which is exactly what
`requestAnimationFrame`-driven scroll-scrubbing does dozens of times a
second — on sparse keyframes this looks like stutter/tearing instead of a
smooth scrub. The fix, already applied to both shipped files, is to force
**every frame to be a keyframe** so any seek lands on one directly.

To re-cut from `how-it-works-master.mp4` (or a fresh export), re-encode with:

**H.264 / MP4:**

```bash
ffmpeg -i how-it-works-master.mp4 \
  -vf "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:-1:-1:color=black" \
  -an \
  -c:v libx264 -preset slow -crf 20 \
  -g 1 -keyint_min 1 -sc_threshold 0 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  how-it-works.mp4
```

**VP9 / WebM:**

```bash
ffmpeg -i how-it-works-master.mp4 \
  -vf "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:-1:-1:color=black" \
  -an \
  -c:v libvpx-vp9 -crf 30 -b:v 0 \
  -g 1 -keyint_min 1 \
  how-it-works.webm
```

- `-g 1 -keyint_min 1` forces a keyframe on every single frame — this is
  the one setting that actually matters for scrub smoothness.
- `-sc_threshold 0` (H.264 only) stops libx264 from inserting *extra*
  scene-change keyframes that would otherwise interact oddly with `-g 1`.
- `-movflags +faststart` moves MP4's index atom to the front of the file so
  the browser can start reading/seeking before the whole file downloads.
- `-an` drops audio entirely (see the audio note above).

**Trade-off:** an all-keyframe encode is dramatically larger than a normal
export at the same CRF, because every frame is now stored at (near) full
quality instead of most frames being cheap deltas off a nearby keyframe.
This is the correct trade for a short (3.7s), small-frame (720×1280) clip —
it's why the duration and dimension budget above matter. Don't try to apply
this encode to a minute-long video; re-cut it shorter first.

## Poster frame

Extract the first frame:

```bash
ffmpeg -i how-it-works.mp4 -frames:v 1 -q:v 3 how-it-works-poster.jpg
```
