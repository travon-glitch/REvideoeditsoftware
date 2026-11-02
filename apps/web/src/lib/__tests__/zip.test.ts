import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, zipName, zipStream, type ZipEntry } from "@/lib/zip";

async function collect(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const r = s.getReader();
  for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value); }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

describe("zip", () => {
  it("computes CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes a ZIP that standard tools open, with every file intact", async () => {
    const files: ZipEntry[] = [
      { name: "Cinematic-Listing-Tour.mp4", data: new Uint8Array(200_000).map((_, i) => (i * 7) % 256) },
      { name: "Just-Listed-Reel.mp4", data: new TextEncoder().encode("hello") },
      { name: "Résumé ünïcode.txt", data: new Uint8Array(0) },
    ];
    async function* gen() { for (const f of files) yield f; }
    const bytes = await collect(zipStream(gen()));
    const dir = mkdtempSync(join(tmpdir(), "lvs-zip-"));
    const file = join(dir, "a.zip");
    writeFileSync(file, bytes);
    const py = spawnSync("python3", ["-I", "-c", `
import zipfile, sys, json
z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print(json.dumps([[i.filename, i.file_size, sum(z.read(i.filename))] for i in z.infolist()]))`, file], { encoding: "utf8" });
    expect(py.stderr).toBe("");
    const listed = JSON.parse(py.stdout) as [string, number, number][];
    expect(listed.map((x) => x[0])).toEqual(files.map((f) => f.name));
    expect(listed.map((x) => x[1])).toEqual(files.map((f) => f.data.length));
    expect(listed[0]![2]).toBe(files[0]!.data.reduce((a, b) => a + b, 0));
  });

  it("makes safe unique names", () => {
    const used = new Set<string>();
    expect(zipName("Luxury-Style Video — 742 Evergreen", "mp4", used)).toBe("Luxury-Style-Video-742-Evergreen.mp4");
    expect(zipName("Luxury-Style Video — 742 Evergreen", "mp4", used)).toBe("Luxury-Style-Video-742-Evergreen-2.mp4");
    expect(zipName("../../etc/passwd", "mp4", used)).toBe("etcpasswd.mp4");
  });
});
