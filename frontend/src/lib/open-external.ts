import { invoke } from "@/lib/api";

export async function openExternalUrl(url: string) {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("仅支持打开 http/https 链接");
  }
  await invoke("open_external_url", { url: trimmed });
}

export function biliVideoUrl(bvid: string) {
  return `https://www.bilibili.com/video/${bvid}`;
}
