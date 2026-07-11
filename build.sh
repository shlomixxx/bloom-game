#!/bin/bash
# BLOOM build script — concatenates src/*.js → public/app.js
# The source files are numbered to ensure correct load order.
# All files share the same IIFE closure (01-constants.js opens it, 99-close.js closes it).
#
# Usage:
#   ./build.sh          # build app.js + app.css
#   ./build.sh --watch  # rebuild on file change (requires fswatch or inotifywait)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR/src"
CSS_DIR="$SCRIPT_DIR/public/css"
OUT_JS="$SCRIPT_DIR/public/app.js"
OUT_CSS="$SCRIPT_DIR/public/styles.css"

# ── JS: concatenate src/*.js → public/app.js ──
echo "Building app.js..."
cat "$SRC_DIR"/[0-9]*.js > "$OUT_JS"
JS_LINES=$(wc -l < "$OUT_JS")
echo "  → $OUT_JS ($JS_LINES lines)"

# ── CSS: concatenate css/*.css → public/styles.css ──
echo "Building styles.css..."
cat "$CSS_DIR"/base.css "$CSS_DIR"/home.css "$CSS_DIR"/home-v2.css "$CSS_DIR"/screens.css "$CSS_DIR"/viral.css "$CSS_DIR"/tiles-aurora.css "$CSS_DIR"/boards.css "$CSS_DIR"/bottom-nav.css "$CSS_DIR"/discovery.css "$CSS_DIR"/social.css "$CSS_DIR"/dark.css "$CSS_DIR"/v2-mechanics.css > "$OUT_CSS"
CSS_LINES=$(wc -l < "$OUT_CSS")
echo "  → $OUT_CSS ($CSS_LINES lines)"

echo "Done ✓"

# ── Optional watch mode ──
if [ "$1" = "--watch" ]; then
  echo ""
  echo "Watching for changes in src/ and public/css/..."
  if command -v fswatch &>/dev/null; then
    fswatch -o "$SRC_DIR" "$CSS_DIR" | while read; do
      echo ""
      echo "Change detected, rebuilding..."
      cat "$SRC_DIR"/[0-9]*.js > "$OUT_JS"
      cat "$CSS_DIR"/base.css "$CSS_DIR"/home.css "$CSS_DIR"/home-v2.css "$CSS_DIR"/screens.css "$CSS_DIR"/viral.css "$CSS_DIR"/tiles-aurora.css "$CSS_DIR"/boards.css "$CSS_DIR"/bottom-nav.css "$CSS_DIR"/discovery.css "$CSS_DIR"/social.css "$CSS_DIR"/dark.css "$CSS_DIR"/v2-mechanics.css > "$OUT_CSS"
      echo "Done ✓ ($(date +%H:%M:%S))"
    done
  else
    echo "⚠ fswatch not found. Install with: brew install fswatch"
    echo "  Or run ./build.sh manually after each change."
  fi
fi
