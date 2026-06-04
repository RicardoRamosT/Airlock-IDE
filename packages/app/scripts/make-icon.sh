#!/usr/bin/env bash
# Regenerate build/icon.png, the .iconset sizes, build/icon-512.png (dev dock),
# and build/icon.icns from build/icon.svg. Replace icon.svg to rebrand.
set -euo pipefail
cd "$(dirname "$0")/.."
npx electron scripts/render-icon.cjs
cd build
rm -rf icon.iconset && mkdir icon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s icon.png --out "icon.iconset/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d icon.png --out "icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
cp "icon.iconset/icon_512x512.png" icon-512.png
iconutil -c icns icon.iconset -o icon.icns
echo "icon.icns + icon-512.png regenerated"
