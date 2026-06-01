#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$PROJECT_ROOT"

OUTPUT_DIR="dist_macos"
TAURI_RELEASE_DIR="src-tauri/target/release"
ICON_SOURCE="icon.png"
REFRESH_ICONS=false

if [[ "${1:-}" == "--refresh-icons" ]]; then
    REFRESH_ICONS=true
    shift
fi
if [[ "$#" -gt 0 ]]; then
    echo "ERROR: Usage: ./build-macos.sh [--refresh-icons]" >&2
    exit 1
fi

fail() {
    echo "ERROR: $1" >&2
    exit 1
}

copy_runtime_tool() {
    local tool_name="$1"
    local tool_source=""
    local candidate
    for candidate in \
        "$PROJECT_ROOT/env/$tool_name" \
        "$PROJECT_ROOT/env/bin/$tool_name" \
        "$PROJECT_ROOT/env/ffmpeg/bin/$tool_name"; do
        if [[ -f "$candidate" ]]; then
            tool_source="$candidate"
            break
        fi
    done
    if [[ -z "$tool_source" ]]; then
        tool_source="$(command -v "$tool_name" || true)"
    fi
    [[ -n "$tool_source" && -f "$tool_source" ]] ||
        fail "$tool_name was not found. Put it in env/ or add it to PATH before building."
    echo "  - Copying $tool_name from $tool_source"
    install -m 755 "$tool_source" "$OUTPUT_DIR/env/$tool_name"

    local tool_dir
    local runtime_libraries=()
    tool_dir="$(dirname "$tool_source")"
    shopt -s nullglob
    runtime_libraries=("$tool_dir"/*.dylib)
    shopt -u nullglob
    if ((${#runtime_libraries[@]})); then
        cp -p "${runtime_libraries[@]}" "$OUTPUT_DIR/env/"
    fi
}

echo "============================================"
echo "  BiliBox macOS Build Script"
echo "============================================"
echo
echo "Target architecture: $(uname -m)"

echo
echo "[1/5] Installing locked dependencies..."
[[ -f "package-lock.json" ]] || fail "package-lock.json was not found."
[[ -f "frontend/package-lock.json" ]] || fail "frontend/package-lock.json was not found."
npm ci --no-audit --no-fund
npm --prefix frontend ci --no-audit --no-fund

echo
if $REFRESH_ICONS; then
    echo "[2/5] Regenerating application icons from $ICON_SOURCE..."
    [[ -f "$ICON_SOURCE" ]] || fail "$ICON_SOURCE was not found."
    npm run tauri -- icon "$ICON_SOURCE"
    rm -rf "src-tauri/icons/ios" "src-tauri/icons/android"
else
    echo "[2/5] Using committed application icons."
    [[ -f "src-tauri/icons/icon.icns" ]] ||
        fail "macOS icon was not found. Run ./build-macos.sh --refresh-icons."
fi

echo
echo "[3/5] Building frontend..."
npm run build

echo
echo "[4/5] Building Tauri application..."
npm run tauri -- build

echo
echo "[5/5] Preparing portable package in $OUTPUT_DIR..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/env" "$OUTPUT_DIR/data/guest/cache" "$OUTPUT_DIR/data/guest/download"
if [[ -f "THIRD_PARTY_NOTICES.md" ]]; then
    install -m 644 "THIRD_PARTY_NOTICES.md" "$OUTPUT_DIR/THIRD_PARTY_NOTICES.md"
fi

[[ -f "$TAURI_RELEASE_DIR/bilibili-box" ]] ||
    fail "Tauri executable not found in $TAURI_RELEASE_DIR."
install -m 755 "$TAURI_RELEASE_DIR/bilibili-box" "$OUTPUT_DIR/bilibili-box"

shopt -s nullglob
tauri_libraries=("$TAURI_RELEASE_DIR"/*.dylib)
shopt -u nullglob
if ((${#tauri_libraries[@]})); then
    cp -p "${tauri_libraries[@]}" "$OUTPUT_DIR/env/"
fi

if [[ -d "$PROJECT_ROOT/env" ]]; then
    cp -R "$PROJECT_ROOT/env/." "$OUTPUT_DIR/env/"
fi
copy_runtime_tool "ffmpeg"
copy_runtime_tool "ffprobe"

echo
echo "============================================"
echo "  Build completed successfully."
echo "  Output directory: $OUTPUT_DIR"
echo "============================================"
echo
echo "Generated files:"
ls -la "$OUTPUT_DIR"
