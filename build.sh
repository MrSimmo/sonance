#!/bin/bash
# Sonance — Build Script
# Packages the app into Sonance.wgt for Samsung Tizen TV deployment
set -e

cd "$(dirname "$0")"

OUTPUT="Sonance.wgt"

echo "============================================"
echo "  Sonance — Build .wgt Package"
echo "============================================"
echo ""

# Remove old build
rm -f "$OUTPUT"

# Create .wgt (zip archive) with only app files
zip -r "$OUTPUT" \
    config.xml \
    icon.png \
    index.html \
    css/ \
    js/ \
    -x "*.DS_Store" \
    -x "__MACOSX/*" \
    -x "*.git*"

echo ""
echo "Built: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
echo ""

# Verify contents
echo "Contents:"
unzip -l "$OUTPUT" | grep -v "^Archive\|^  Length\|^ ---\|^$" | grep -v " files$" | awk '{print "  " $4}'
echo ""

# Count files
FILE_COUNT=$(unzip -l "$OUTPUT" | grep -c "\.")
echo "Total files: $FILE_COUNT"
echo ""

echo "Deploy with Jellyfin2Samsung:"
echo "  1. Enable Developer Mode on TV"
echo "  2. Open Jellyfin2Samsung"
echo "  3. Go to Settings → select custom .wgt"
echo "  4. Select Sonance.wgt"
echo "  5. Install to TV"
echo ""
echo "============================================"
