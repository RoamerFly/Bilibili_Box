import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const assetDir = process.env.RELEASE_ASSET_DIR || "release-assets";
const tagName = process.env.RELEASE_TAG_NAME || process.env.GITHUB_REF_NAME || "v0.0.0";
// GITHUB_REPOSITORY is a GitHub Actions reserved variable and always points at
// the workflow's source repository. Releases are intentionally published to a
// separate public repository, so use a dedicated variable for download URLs.
const repo = process.env.RELEASE_REPOSITORY || "RoamerFly/Bilibili_Box";
const notes = process.env.RELEASE_NOTES_FILE
  ? (await readFile(process.env.RELEASE_NOTES_FILE, "utf8")).trim()
  : (process.env.RELEASE_NOTES || "").trim();
const pubDate = process.env.RELEASE_PUB_DATE || new Date().toISOString();
const version = tagName.replace(/^v/i, "");
const downloadBase = `https://github.com/${repo}/releases/download/${tagName}`;

const platformPatterns = [
  { key: "windows-x86_64", pattern: /windows-x64-installer\.exe$/i, priority: 10 },
  { key: "windows-x86_64", pattern: /windows-x64-portable\.zip$/i, priority: 20 },
  { key: "darwin-aarch64", pattern: /macos-arm64-installer\.dmg$/i, priority: 10 },
  { key: "darwin-aarch64", pattern: /macos-arm64-portable\.zip$/i, priority: 20 },
  { key: "darwin-x86_64", pattern: /macos-x64-installer\.dmg$/i, priority: 10 },
  { key: "darwin-x86_64", pattern: /macos-x64-portable\.zip$/i, priority: 20 },
  // Linux application updates are only safe through AppImage.  Debian/RPM
  // assets remain published artifacts for package managers, but must never be
  // selected as an in-app executable update.
  { key: "linux-x86_64", pattern: /linux-x64-appimage\.AppImage$/i, priority: 10 },
];

function resolvePlatform(fileName) {
  return platformPatterns
    .filter((candidate) => candidate.pattern.test(fileName))
    .sort((left, right) => left.priority - right.priority)[0] || null;
}

const fileNames = (await readdir(assetDir))
  .filter((name) => !name.endsWith(".sig") && name !== "latest.json")
  .sort();

const candidates = new Map();
const artifacts = [];

for (const fileName of fileNames) {
  const assetPath = path.join(assetDir, fileName);
  const sigPath = `${assetPath}.sig`;
  let signature = "";
  try {
    signature = (await readFile(sigPath, "utf8")).trim();
    if (!signature.startsWith("untrusted comment:")) {
      const decoded = Buffer.from(signature, "base64").toString("utf8").trim();
      if (decoded.startsWith("untrusted comment:")) {
        signature = decoded;
      }
    }
  } catch {
    continue;
  }

  const bytes = await readFile(assetPath);
  const info = await stat(assetPath);
  const artifact = {
    name: fileName,
    url: `${downloadBase}/${encodeURIComponent(fileName)}`,
    signature,
    size: info.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  artifacts.push(artifact);

  const platform = resolvePlatform(fileName);
  if (!platform) continue;
  const current = candidates.get(platform.key);
  if (!current || platform.priority < current.priority) {
    candidates.set(platform.key, { priority: platform.priority, artifact });
  }
}

const platforms = Object.fromEntries(
  [...candidates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, { artifact }]) => [
      key,
      {
        signature: artifact.signature,
        url: artifact.url,
      },
    ]),
);

if (Object.keys(platforms).length === 0) {
  throw new Error("No signed updater assets were found. Make sure .sig files were generated before latest.json.");
}

const latest = {
  version,
  notes,
  pub_date: pubDate,
  platforms,
  artifacts,
};

await writeFile(path.join(assetDir, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`, "utf8");
console.log(`Generated latest.json for ${Object.keys(platforms).join(", ")}`);
