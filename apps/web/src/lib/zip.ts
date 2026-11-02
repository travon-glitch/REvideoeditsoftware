/*
 * Minimal ZIP writer (stored, no compression — MP4s are already compressed).
 * Files are added one at a time and streamed out, so a batch of large videos
 * never sits in memory all at once. ZIP 2.0, UTF-8 names, no ZIP64 (each file and
 * the whole archive must stay under 4 GB, far above a batch of 1080p MP4s).
 */
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export interface ZipEntry { name: string; data: Uint8Array }

/** Builds the ZIP as a stream; `files` yields one file at a time (e.g. downloaded on demand). */
export function zipStream(files: AsyncIterable<ZipEntry>, now = new Date()): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;
  const { time, date } = dosTime(now);
  const iterator = files[Symbol.asyncIterator]();
  let finished = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      const next = await iterator.next();
      if (next.done) {
        const cdStart = offset;
        let cdSize = 0;
        for (const c of central) { controller.enqueue(c); cdSize += c.length; }
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, count, true); end.setUint16(10, count, true);
        end.setUint32(12, cdSize, true); end.setUint32(16, cdStart, true);
        controller.enqueue(new Uint8Array(end.buffer));
        finished = true;
        controller.close();
        return;
      }
      const { name, data } = next.value;
      const nameBytes = enc.encode(name);
      const crc = crc32(data);
      if (offset + data.length > 0xffffffff) throw new Error("ZIP too large");
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
      local.setUint16(10, time, true); local.setUint16(12, date, true);
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
      cd.setUint16(12, time, true); cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint32(42, offset, true);
      const cdEntry = new Uint8Array(46 + nameBytes.length);
      cdEntry.set(new Uint8Array(cd.buffer), 0); cdEntry.set(nameBytes, 46);
      central.push(cdEntry);
      controller.enqueue(new Uint8Array(local.buffer));
      controller.enqueue(nameBytes);
      controller.enqueue(data);
      offset += 30 + nameBytes.length + data.length;
      count++;
    },
    async cancel() { await iterator.return?.(); },
  });
}

/** A safe, unique file name inside the ZIP. */
export function zipName(title: string, ext: string, used: Set<string>): string {
  const base = title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "video";
  let name = `${base}.${ext}`;
  for (let i = 2; used.has(name); i++) name = `${base}-${i}.${ext}`;
  used.add(name);
  return name;
}
