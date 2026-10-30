import { describe, expect, it } from 'vitest';

import { readVipsPixels } from './thumbhash.ts';

/** A `.v` file: the 64-byte header, then the pixels. */
function vips(
    options: { width: number; height: number; bands: number; format?: number; bigEndian?: boolean },
    samples: number[],
): Buffer {
    const { width, height, bands, format = 0, bigEndian = false } = options;
    const bytes = format === 2 ? 2 : 1;
    const buffer = Buffer.alloc(64 + samples.length * bytes);
    const int = (value: number, offset: number) =>
        bigEndian ? buffer.writeInt32BE(value, offset) : buffer.writeInt32LE(value, offset);
    buffer.writeUInt32LE(bigEndian ? 0xb6a6f208 : 0x08f2a6b6, 0);
    int(width, 4);
    int(height, 8);
    int(bands, 12);
    int(format, 20);
    samples.forEach((sample, index) => {
        if (bytes === 1) {
            buffer.writeUInt8(sample, 64 + index);
        } else if (bigEndian) {
            buffer.writeUInt16BE(sample, 64 + index * 2);
        } else {
            buffer.writeUInt16LE(sample, 64 + index * 2);
        }
    });
    return buffer;
}

describe('readVipsPixels', () => {
    it('reads RGB and RGBA pixels', () => {
        expect(readVipsPixels(vips({ width: 2, height: 1, bands: 3 }, [1, 2, 3, 4, 5, 6]))).toEqual(
            { width: 2, height: 1, rgba: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]) },
        );
        expect(readVipsPixels(vips({ width: 1, height: 1, bands: 4 }, [1, 2, 3, 4]))).toEqual({
            width: 1,
            height: 1,
            rgba: new Uint8Array([1, 2, 3, 4]),
        });
    });

    it('reads grey pixels, with or without alpha', () => {
        expect(readVipsPixels(vips({ width: 1, height: 2, bands: 2 }, [7, 8, 9, 10]))).toEqual({
            width: 1,
            height: 2,
            rgba: new Uint8Array([7, 7, 7, 8, 9, 9, 9, 10]),
        });
    });

    it('reads 16-bit samples, in either byte order', () => {
        expect(
            readVipsPixels(
                vips({ width: 1, height: 1, bands: 1, format: 2, bigEndian: true }, [0x1234]),
            ),
        ).toEqual({ width: 1, height: 1, rgba: new Uint8Array([0x12, 0x12, 0x12, 255]) });
        expect(
            readVipsPixels(vips({ width: 1, height: 1, bands: 1, format: 2 }, [0xff00])),
        ).toEqual({ width: 1, height: 1, rgba: new Uint8Array([0xff, 0xff, 0xff, 255]) });
    });

    it('refuses what it does not know', () => {
        expect(readVipsPixels(Buffer.alloc(10))).toBeUndefined();
        expect(readVipsPixels(Buffer.alloc(80))).toBeUndefined();
        // Floats
        expect(
            readVipsPixels(vips({ width: 1, height: 1, bands: 1, format: 6 }, [0, 0, 0, 0])),
        ).toBeUndefined();
        // Truncated
        expect(readVipsPixels(vips({ width: 2, height: 2, bands: 3 }, [1, 2, 3]))).toBeUndefined();
    });
});
