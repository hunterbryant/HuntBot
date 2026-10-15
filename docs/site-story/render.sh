#!/usr/bin/env bash
# Renders each diagram HTML to a 2x PNG for the "Building HuntBot" Prismic page.
# Usage: ./render.sh [chromium-binary]
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${1:-${CHROME:-chromium}}"
python3 build.py
for spec in hero:1200x630 system-map:1200x720 life-of-a-message:1200x960 timeline:1200x560; do
	name="${spec%%:*}"; size="${spec##*:}"; w="${size%x*}"; h="${size#*x}"
	# Headless Chrome eats part of the window height, so render taller and crop.
	"$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
		--window-size="$w,$((h + 200))" --screenshot="$PWD/$name.png" "file://$PWD/$name.html" 2>/dev/null
	python3 -c "from PIL import Image; im=Image.open('$name.png'); im.crop((0,0,$((w*2)),$((h*2)))).save('$name.png', optimize=True)"
	echo "rendered $name.png"
done
