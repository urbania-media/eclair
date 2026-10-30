import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { rgbaToThumbHash } from 'thumbhash';

import type { OperationContext } from '@eclair-js/operation';

/** The largest side ThumbHash encodes: more is slower, with no benefit. */
const MAX_SIZE = 100;

/** vips' native format: a 64-byte header, then the pixels, row by row. */
const VIPS_HEADER_SIZE = 64;
const VIPS_MAGIC_LITTLE_ENDIAN = 0x08f2a6b6;
const VIPS_MAGIC_BIG_ENDIAN = 0xb6a6f208;
const VIPS_FORMAT_UCHAR = 0;
const VIPS_FORMAT_USHORT = 2;
const VIPS_CODING_NONE = 0;

interface Pixels {
    width: number;
    height: number;
    rgba: Uint8Array;
}

/**
 * Reads the pixels of a `.v` file as RGBA bytes: 1 band is grey, 2 grey and alpha, 3 RGB, 4 RGBA.
 * Undefined for a layout it doesn't know.
 */
export function readVipsPixels(buffer: Buffer): Pixels | undefined {
    if (buffer.length < VIPS_HEADER_SIZE) {
        return undefined;
    }
    const magic = buffer.readUInt32LE(0);
    const littleEndian = magic === VIPS_MAGIC_LITTLE_ENDIAN;
    if (!littleEndian && magic !== VIPS_MAGIC_BIG_ENDIAN) {
        return undefined;
    }
    const int = (offset: number) =>
        littleEndian ? buffer.readInt32LE(offset) : buffer.readInt32BE(offset);
    const [width, height, bands, format, coding] = [4, 8, 12, 20, 24].map(int) as [
        number,
        number,
        number,
        number,
        number,
    ];
    const bytes = format === VIPS_FORMAT_UCHAR ? 1 : format === VIPS_FORMAT_USHORT ? 2 : 0;
    if (
        bytes === 0 ||
        coding !== VIPS_CODING_NONE ||
        bands < 1 ||
        bands > 4 ||
        width < 1 ||
        height < 1 ||
        buffer.length < VIPS_HEADER_SIZE + width * height * bands * bytes
    ) {
        return undefined;
    }

    const sample = (index: number) => {
        const offset = VIPS_HEADER_SIZE + index * bytes;
        if (bytes === 1) {
            return buffer[offset] ?? 0;
        }
        return (littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset)) >> 8;
    };
    const rgba = new Uint8Array(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) {
        const first = pixel * bands;
        const grey = bands < 3;
        rgba[pixel * 4] = sample(first);
        rgba[pixel * 4 + 1] = sample(grey ? first : first + 1);
        rgba[pixel * 4 + 2] = sample(grey ? first : first + 2);
        rgba[pixel * 4 + 3] = bands === 2 || bands === 4 ? sample(first + bands - 1) : 255;
    }
    return { width, height, rgba };
}

/**
 * The ThumbHash placeholder of an image, in base64: its first frame, upright, in sRGB, fitted in
 * 100×100 by libvips, encoded with the reference implementation. Undefined when libvips can't read
 * it: a placeholder never fails a probe.
 */
export async function thumbhash(context: OperationContext): Promise<string | undefined> {
    const path = join(context.workdir, 'thumbhash.v');
    let pixels: Pixels | undefined;
    try {
        await context.exec(
            'vips',
            [
                'thumbnail',
                context.input.path,
                path,
                String(MAX_SIZE),
                '--height',
                String(MAX_SIZE),
                '--size',
                'down',
                '--export-profile',
                'srgb',
            ],
            // Only the loader of the detected type reads the file (SVG has no placeholder).
            { env: { VIPS_BLOCK_UNTRUSTED: '1' } },
        );
        pixels = readVipsPixels(await readFile(path));
    } catch (error) {
        if (context.signal.aborted) {
            throw error;
        }
        return undefined;
    }
    if (pixels === undefined || pixels.width > MAX_SIZE || pixels.height > MAX_SIZE) {
        return undefined;
    }
    return Buffer.from(rgbaToThumbHash(pixels.width, pixels.height, pixels.rgba)).toString(
        'base64',
    );
}
