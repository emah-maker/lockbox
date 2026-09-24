# README graphics sources

`banner.png`, `stats.png` and `steps.png` are rendered from these HTML files,
using the website's palette and fonts. To regenerate one (from this folder),
render at 2x with any headless Chrome:

```bash
chrome --headless --hide-scrollbars --force-device-scale-factor=2 \
  --virtual-time-budget=8000 --window-size=1280,520 \
  --screenshot=../banner.png banner.html   # stats: 1280,170 · steps: 1280,300
```

`override.gif` is `website/assets/video/screen/override-loop.webm` converted
with ffmpeg (15 fps, 240 px wide, 64-colour palette).
