import { describe, expect, it } from "vitest";
import { parseProxyUrl } from "./settings-view";

describe("parseProxyUrl", () => {
  it("parses valid http and https proxy urls", () => {
    expect(parseProxyUrl("http://127.0.0.1:7890")).toEqual({
      host: "http://127.0.0.1",
      port: 7890,
    });
    expect(parseProxyUrl("https://127.0.0.1:8080")).toEqual({
      host: "https://127.0.0.1",
      port: 8080,
    });
    expect(parseProxyUrl("socks5://192.168.1.100:1080")).toEqual({
      host: "socks5://192.168.1.100",
      port: 1080,
    });
  });

  it("handles host:port without protocol scheme by defaulting to http://", () => {
    expect(parseProxyUrl("127.0.0.1:7890")).toEqual({
      host: "http://127.0.0.1",
      port: 7890,
    });
    expect(parseProxyUrl("localhost:8888")).toEqual({
      host: "http://localhost",
      port: 8888,
    });
  });

  it("returns null for invalid inputs", () => {
    expect(parseProxyUrl("")).toBeNull();
    expect(parseProxyUrl("   ")).toBeNull();
    expect(parseProxyUrl("http://127.0.0.1:99999")).toBeNull();
    expect(parseProxyUrl("invalid-format-without-port")).toBeNull();
  });
});
