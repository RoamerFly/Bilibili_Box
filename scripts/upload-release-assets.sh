#!/usr/bin/env bash

set -euo pipefail

asset_dir="${1:-release-assets}"
tag_name="${TAG_NAME:?TAG_NAME is required}"
release_repository="${PUBLIC_RELEASE_REPOSITORY:?PUBLIC_RELEASE_REPOSITORY is required}"
key="${TAURI_UPDATER_PRIVATE_KEY_VALUE:-${TAURI_SIGNING_PRIVATE_KEY_VALUE:-}}"
password="${TAURI_UPDATER_PRIVATE_KEY_PASSWORD_VALUE:-${TAURI_SIGNING_PRIVATE_KEY_PASSWORD_VALUE:-}}"

[[ -d "$asset_dir" ]] || {
    echo "ERROR: Release asset directory does not exist: $asset_dir" >&2
    exit 1
}
[[ -n "$key" ]] || {
    echo "ERROR: Missing updater signing private key." >&2
    exit 1
}

key_path="$(mktemp)"
cleanup() {
    rm -f "$key_path"
}
trap cleanup EXIT
printf '%s' "$key" > "$key_path"
chmod 600 "$key_path"

shopt -s nullglob
assets=("$asset_dir"/*)
[[ "${#assets[@]}" -gt 0 ]] || {
    echo "ERROR: No release assets found in $asset_dir." >&2
    exit 1
}

for asset in "${assets[@]}"; do
    case "$asset" in
        *.sig|*.json) continue ;;
    esac
    echo "Signing $(basename "$asset")"
    npx --yes @tauri-apps/cli@2 signer sign \
        --private-key-path "$key_path" \
        --password "$password" \
        "$asset"
done

echo "Uploading ${#assets[@]} platform assets to draft release $tag_name"
gh release upload "$tag_name" "$asset_dir"/* \
    --repo "$release_repository" \
    --clobber
