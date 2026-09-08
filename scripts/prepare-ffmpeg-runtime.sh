#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ENV_DIR="$PROJECT_ROOT/env"
PLATFORM="${1:-}"
TEMP_DIR="$(mktemp -d)"

cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

download() {
    local url="$1"
    local destination="$2"
    echo "Downloading $url"
    curl --fail --location --retry 3 --retry-all-errors --output "$destination" "$url"
}

verify_tool() {
    local tool="$1"
    [[ -x "$ENV_DIR/$tool" ]] || {
        echo "ERROR: $tool was not prepared in $ENV_DIR." >&2
        exit 1
    }
    "$ENV_DIR/$tool" -version | head -n 1
}

mkdir -p "$ENV_DIR"

case "$PLATFORM" in
    linux-x64)
        archive_name="ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz"
        base_url="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
        archive="$TEMP_DIR/$archive_name"
        download "$base_url/$archive_name" "$archive"
        download "$base_url/checksums.sha256" "$TEMP_DIR/checksums.sha256"
        (
            cd "$TEMP_DIR"
            grep -E "[ *]$archive_name\$" checksums.sha256 | sha256sum --check -
        )
        mkdir -p "$TEMP_DIR/expanded"
        tar -xf "$archive" -C "$TEMP_DIR/expanded"
        ffmpeg_source="$(find "$TEMP_DIR/expanded" -type f -path '*/bin/ffmpeg' -print -quit)"
        ffprobe_source="$(find "$TEMP_DIR/expanded" -type f -path '*/bin/ffprobe' -print -quit)"
        [[ -n "$ffmpeg_source" && -n "$ffprobe_source" ]] || {
            echo "ERROR: FFmpeg executables were not found in $archive_name." >&2
            exit 1
        }
        install -m 755 "$ffmpeg_source" "$ENV_DIR/ffmpeg"
        install -m 755 "$ffprobe_source" "$ENV_DIR/ffprobe"
        license_source="$(find "$TEMP_DIR/expanded" -type f \( -name LICENSE -o -name LICENSE.txt \) -print -quit)"
        if [[ -n "$license_source" ]]; then
            install -m 644 "$license_source" "$ENV_DIR/FFmpeg-LICENSE.txt"
        fi
        ;;
    macos-arm64|macos-x64)
        if [[ "$PLATFORM" == "macos-arm64" ]]; then
            architecture="arm64"
        else
            architecture="amd64"
        fi
        base_url="https://ffmpeg.martin-riedl.de/redirect/latest/macos/$architecture/release"
        for tool in ffmpeg ffprobe; do
            archive="$TEMP_DIR/$tool.zip"
            download "$base_url/$tool.zip" "$archive"
            resolved_url="$(curl --fail --location --range 0-0 --output /dev/null --write-out '%{url_effective}' "$base_url/$tool.zip")"
            download "$resolved_url.sha256" "$TEMP_DIR/$tool.zip.sha256"
            (
                cd "$TEMP_DIR"
                shasum -a 256 --check "$tool.zip.sha256"
            )
            unzip -p "$archive" "$tool" > "$ENV_DIR/$tool"
            chmod 755 "$ENV_DIR/$tool"
        done
        ;;
    *)
        echo "ERROR: Usage: ./scripts/prepare-ffmpeg-runtime.sh linux-x64|macos-arm64|macos-x64" >&2
        exit 1
        ;;
esac

download "https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.1/COPYING.GPLv3" \
    "$ENV_DIR/FFmpeg-GPL-3.0.txt"
verify_tool ffmpeg
verify_tool ffprobe
