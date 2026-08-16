import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = await mkdtemp(path.join(tmpdir(), "bilibox-updater-metadata-"));

try {
  const assetNames = [
    "Bilibili_Box-v9.9.9-windows-x64-installer.exe",
    "Bilibili_Box-v9.9.9-linux-x64-installer.deb",
    "Bilibili_Box-v9.9.9-linux-x64-installer.rpm",
    "Bilibili_Box-v9.9.9-linux-x64-appimage.AppImage",
  ];
  for (const assetName of assetNames) {
    await writeFile(path.join(fixtureDir, assetName), "test asset", "utf8");
    await writeFile(path.join(fixtureDir, `${assetName}.sig`), "test signature", "utf8");
  }

  const result = spawnSync(process.execPath, [path.join(scriptDir, "finalize-updater-metadata.mjs")], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_REPOSITORY: "RoamerFly/Bilibili-api-private",
      RELEASE_ASSET_DIR: fixtureDir,
      RELEASE_REPOSITORY: "RoamerFly/Bilibili_Box",
      RELEASE_TAG_NAME: "v9.9.9",
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const metadata = JSON.parse(await readFile(path.join(fixtureDir, "latest.json"), "utf8"));
  const expectedPrefix = "https://github.com/RoamerFly/Bilibili_Box/releases/download/v9.9.9/";
  assert.ok(metadata.platforms["windows-x86_64"].url.startsWith(expectedPrefix));
  assert.equal(
    metadata.platforms["linux-x86_64"].url,
    `${expectedPrefix}Bilibili_Box-v9.9.9-linux-x64-appimage.AppImage`,
  );
  assert.ok(metadata.artifacts.every((artifact) => artifact.url.startsWith(expectedPrefix)));
  assert.ok(!JSON.stringify(metadata).includes("Bilibili-api-private"));
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

console.log("Updater metadata public repository test passed.");
