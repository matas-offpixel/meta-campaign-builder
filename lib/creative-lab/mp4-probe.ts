/**
 * Width, height, duration and frame rate from an MP4 or MOV, without
 * ffprobe. The Vercel function image cannot start the Remotion compositor
 * (glibc 2.35), and that binary is what getVideoMetadata shells out to.
 */

export type Probe = { width: number; height: number; fps: number; durationInSeconds: number };

type Box = { type: string; payloadStart: number; end: number };

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl"]);

function boxes(buf: Buffer, start: number, end: number): Box[] {
  const out: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = Number(buf.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) break;
    out.push({ type: buf.toString("ascii", offset + 4, offset + 8), payloadStart: offset + header, end: offset + size });
    offset += size;
  }
  return out;
}

function u32(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset);
}

function timescaleAndDuration(buf: Buffer, payloadStart: number): { timescale: number; duration: number } | null {
  if (payloadStart >= buf.length) return null;
  const version = buf[payloadStart];
  if (version === 0) {
    if (payloadStart + 20 > buf.length) return null;
    return { timescale: u32(buf, payloadStart + 12), duration: u32(buf, payloadStart + 16) };
  }
  if (payloadStart + 32 > buf.length) return null;
  return { timescale: u32(buf, payloadStart + 20), duration: Number(buf.readBigUInt64BE(payloadStart + 24)) };
}

function fixed16(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset) / 65536;
}

type Track = { width: number; height: number; video: boolean; samples: number };

function readTrack(buf: Buffer, payloadStart: number, end: number): Track {
  const track: Track = { width: 0, height: 0, video: false, samples: 0 };
  const walk = (start: number, stop: number) => {
    for (const box of boxes(buf, start, stop)) {
      if (box.type === "tkhd" && box.end - box.payloadStart >= 8) {
        track.width = fixed16(buf, box.end - 8);
        track.height = fixed16(buf, box.end - 4);
      } else if (box.type === "hdlr" && box.payloadStart + 12 <= box.end) {
        // mdia carries 'vide' or 'soun'. minf then carries a data handler ('alis'), which is not the media type.
        if (buf.toString("ascii", box.payloadStart + 8, box.payloadStart + 12) === "vide") track.video = true;
      } else if (box.type === "stts" && box.payloadStart + 8 <= box.end) {
        const count = u32(buf, box.payloadStart + 4);
        let samples = 0;
        for (let i = 0; i < count; i += 1) {
          const at = box.payloadStart + 8 + i * 8;
          if (at + 4 > box.end) break;
          samples += u32(buf, at);
        }
        track.samples = samples;
      } else if (CONTAINERS.has(box.type)) {
        walk(box.payloadStart, box.end);
      }
    }
  };
  walk(payloadStart, end);
  return track;
}

/** The first video track. Throws when the moov atom has no dimensions or duration. */
export function probeMp4Bytes(bytes: Uint8Array): Probe {
  const buf = Buffer.from(bytes);
  const found: { movie: { timescale: number; duration: number } | null; video: Track | null } = { movie: null, video: null };
  const walk = (start: number, end: number) => {
    for (const box of boxes(buf, start, end)) {
      if (box.type === "mvhd") found.movie = timescaleAndDuration(buf, box.payloadStart);
      else if (box.type === "trak") {
        const track = readTrack(buf, box.payloadStart, box.end);
        if (track.video && !found.video) found.video = track;
      } else if (CONTAINERS.has(box.type)) walk(box.payloadStart, box.end);
    }
  };
  walk(0, buf.length);
  const movie = found.movie;
  const video = found.video;
  if (!movie || movie.timescale <= 0 || movie.duration <= 0) throw new Error("mp4 has no duration");
  if (!video || video.width < 2 || video.height < 2) throw new Error("mp4 has no video dimensions");
  const durationInSeconds = movie.duration / movie.timescale;
  const fps = video.samples > 0 ? video.samples / durationInSeconds : 30;
  return {
    width: Math.round(video.width),
    height: Math.round(video.height),
    fps,
    durationInSeconds,
  };
}

async function fetchRange(url: string, start: number, end: number): Promise<{ buf: Buffer; total: number }> {
  const response = await fetch(url, { headers: { range: `bytes=${start}-${end}` } });
  if (!response.ok && response.status !== 206) throw new Error(`clip fetch failed (${response.status})`);
  const totalHeader = response.headers.get("content-range");
  const total = totalHeader ? Number(totalHeader.split("/")[1]) : Number(response.headers.get("content-length"));
  if (!Number.isFinite(total) || total <= 0) throw new Error("clip fetch did not say how long the file is");
  return { buf: Buffer.from(await response.arrayBuffer()), total };
}

async function readExact(url: string, start: number, size: number): Promise<Buffer> {
  const { buf } = await fetchRange(url, start, start + size - 1);
  if (buf.length < size) throw new Error("clip fetch returned a short range");
  return buf.subarray(0, size);
}

/** Download only the moov atom (it may sit after mdat) and probe it. */
export async function probeMp4Url(url: string): Promise<Probe> {
  const first = await fetchRange(url, 0, 31);
  let offset = 0;
  while (offset + 8 <= first.total) {
    const header = offset === 0 ? first.buf.subarray(0, Math.min(16, first.buf.length)) : await readExact(url, offset, 16);
    let size = header.readUInt32BE(0);
    let headerBytes = 8;
    if (size === 1) {
      size = Number(header.readBigUInt64BE(8));
      headerBytes = 16;
    } else if (size === 0) {
      size = first.total - offset;
    }
    if (size < headerBytes) throw new Error("mp4 box size is shorter than its header");
    const type = header.toString("ascii", 4, 8);
    if (type === "moov") {
      const moov = await readExact(url, offset, size);
      return probeMp4Bytes(moov);
    }
    offset += size;
  }
  throw new Error("mp4 has no moov atom");
}
