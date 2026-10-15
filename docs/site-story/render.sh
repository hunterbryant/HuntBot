#!/usr/bin/env bash
# Renders each diagram HTML to a 2x PNG for the "Building HuntBot" Prismic page.
# Usage: ./render.sh [chromium-binary]
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${1:-${CHROME:-chromium}}"
python3 build.py
for file in *.html; do
	name="${file%.html}"
	# Size comes from the <svg width/height> that build.py writes.
	read -r w h < <(python3 -c "import re,sys; m=re.search(r'<svg width=\"(\d+)\" height=\"(\d+)\"', open(sys.argv[1]).read()); print(m[1], m[2])" "$file")
	# Headless Chrome eats part of the window height, so render taller and crop.
	"$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
		--window-size="$w,$((h + 200))" --screenshot="$PWD/$name.png" "file://$PWD/$file" 2>/dev/null
	python3 -c "from PIL import Image; im=Image.open('$name.png'); im.crop((0,0,$((w*2)),$((h*2)))).save('$name.png', optimize=True)"
	echo "rendered $name.png (${w}x${h})"
done
