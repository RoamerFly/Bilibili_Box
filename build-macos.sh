#!/bin/bash

set -e

echo "============================================"
echo "  BiliBox macOS Build Script"
echo "============================================"
echo ""

# Set project root directory
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

# Keep a single Tauri build output directory.
TAURI_RELEASE_DIR="src-tauri/target/release"

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    ARCH_SUFFIX="aarch64"
    echo "Building for Apple Silicon (ARM64)"
else
    ARCH_SUFFIX="x86_64"
    echo "Building for Intel Mac (x86_64)"
fi

# Clean previous dist_macos output
if [ -d "dist_macos" ]; then
    echo "Cleaning previous dist_macos directory..."
    rm -rf dist_macos
fi

# Create output directory structure
mkdir -p dist_macos
mkdir -p dist_macos/env
mkdir -p dist_macos/data/user
mkdir -p dist_macos/data/download

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
echo "[4/4] Copying build artifacts to dist_macos..."

# Copy standalone executable (if not using app bundle)
if [ -f "$TAURI_RELEASE_DIR/bilibili-box" ]; then
    echo "  - Copying bilibili-box executable..."
    cp "$TAURI_RELEASE_DIR/bilibili-box" dist_macos/
    chmod +x dist_macos/bilibili-box
fi

# Copy shared libraries if they exist
if ls "$TAURI_RELEASE_DIR"/*.dylib 1> /dev/null 2>&1; then
    echo "  - Copying dynamic libraries..."
    cp "$TAURI_RELEASE_DIR"/*.dylib dist_macos/env/ 2>/dev/null || true
fi

echo ""
echo "============================================"
echo "  Build completed successfully!"
echo "  Output directory: dist_macos"
echo "============================================"
echo ""
echo "Directory structure:"
echo "  dist_macos/"
echo "  +-- bilibili-box          (executable)"
echo "  +-- env/                  (runtime dependencies)"
echo "  +-- data/"
echo "      +-- user/             (user data)"
echo "      +-- download/         (default download directory)"
echo ""

# List output files
echo "Generated files:"
ls -la dist_macos/
