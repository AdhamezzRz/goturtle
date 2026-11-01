import { deflateSync } from 'node:zlib';

/**
 * Tiny PNG encoder for demo claim evidence (no image dependencies): a
 * cardboard box with packing tape and, depending on the variant, a crushed
 * corner, an opened flap or a shipping label.
 */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

type Rgb = [number, number, number];

/** A 240×180 RGB PNG of a parcel. */
export function parcelPhoto(variant: 'crushed' | 'open' | 'label'): Buffer {
  const w = 240;
  const h = 180;
  const bg: Rgb = [232, 234, 230];
  const box: Rgb = [196, 154, 108];
  const boxDark: Rgb = [150, 112, 74];
  const tape: Rgb = [214, 196, 150];
  const crack: Rgb = [70, 48, 30];
  const label: Rgb = [250, 250, 250];
  const ink: Rgb = [40, 40, 40];
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      let c: Rgb = bg;
      if (x >= 40 && x < 200 && y >= 35 && y < 155) {
        c = y < 60 ? boxDark : box;
        if (x >= 112 && x < 128) c = tape;
        if (variant === 'label' && x >= 140 && x < 190 && y >= 95 && y < 140) c = (y - 95) % 8 < 2 && x > 145 && x < 185 ? ink : label;
        if (variant === 'crushed') {
          if (x > 150 && y < 35 + (200 - x)) c = bg; // crushed corner
          if (Math.abs(y - (60 + (x - 40) * 0.55)) < 1.6 && x > 60 && x < 170) c = crack;
        }
        if (variant === 'open' && y < 60 && Math.abs(x - 120) < 30) c = crack; // opened flap
      }
      const i = y * stride + 1 + x * 3;
      raw[i] = c[0];
      raw[i + 1] = c[1];
      raw[i + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
