#!/bin/bash

set -e

echo "============================================"
echo "  BiliBox Linux Build Script"
echo "============================================"
echo ""

# Set project root directory
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

# Keep a single Tauri build output directory.
TAURI_RELEASE_DIR="src-tauri/target/release"

# Clean previous dist_linux output
if [ -d "dist_linux" ]; then
    echo "Cleaning previous dist_linux directory..."
    rm -rf dist_linux
fi

# Create output directory structure
mkdir -p dist_linux
mkdir -p dist_linux/env
mkdir -p dist_linux/data/user
mkdir -p dist_linux/data/download

echo ""
echo "[1/4] Installing dependencies..."
npm install
npm --prefix frontend install

echo ""
echo "[2/4] Building frontend..."
npm run build

echo ""
echo "[3/4] Building Tauri application..."
npm run tauri build

echo ""
echo "[4/4] Copying build artifacts to dist_linux..."

# Copy standalone executable
if [ -f "$TAURI_RELEASE_DIR/bilibili-box" ]; then
    echo "  - Copying bilibili-box executable..."
    cp "$TAURI_RELEASE_DIR/bilibili-box" dist_linux/
    chmod +x dist_linux/bilibili-box
fi

# Copy shared libraries if they exist
if ls "$TAURI_RELEASE_DIR"/*.so 1> /dev/null 2>&1; then
    echo "  - Copying shared libraries..."
    cp "$TAURI_RELEASE_DIR"/*.so dist_linux/env/ 2>/dev/null || true
fi

# Copy WebKit/GTK runtime files if they exist
if ls "$TAURI_RELEASE_DIR"/libwebkit* 1> /dev/null 2>&1; then
    echo "  - Copying WebKit runtime files..."
    cp "$TAURI_RELEASE_DIR"/libwebkit* dist_linux/env/ 2>/dev/null || true
fi

echo ""
echo "============================================"
echo "  Build completed successfully!"
echo "  Output directory: dist_linux"
echo "============================================"
echo ""
echo "Directory structure:"
echo "  dist_linux/"
echo "  +-- bilibili-box          (executable)"
echo "  +-- env/                  (runtime dependencies)"
echo "  +-- data/"
echo "      +-- user/             (user data)"
echo "      +-- download/         (default download directory)"
echo ""

# List output files
echo "Generated files:"
ls -la dist_linux/
