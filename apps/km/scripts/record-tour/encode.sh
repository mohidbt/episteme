#!/bin/bash
set -e
IN="$1"
OUT_BASE="${2%.webm}"
ffmpeg -i "$IN" -c:v libvpx-vp9 -b:v 1000k -vf "scale=1440:900,fps=24" -an -row-mt 1 -y "${OUT_BASE}.webm"
ffmpeg -i "${OUT_BASE}.webm" -ss 0.5 -vframes 1 -y "${OUT_BASE}.poster.jpg"
echo "wrote: ${OUT_BASE}.webm + ${OUT_BASE}.poster.jpg"
