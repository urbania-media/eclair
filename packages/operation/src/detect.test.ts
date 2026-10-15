import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { detectType, kindOf, matchesMime } from './detect.ts';

const directory = mkdtempSync(join(tmpdir(), 'eclair-detect-'));

afterAll(() => rmSync(directory, { recursive: true, force: true }));

function file(name: string, content: string | Buffer): string {
    const path = join(directory, name);
    writeFileSync(path, content);
    return path;
}

// The smallest valid PNG: a 1×1 transparent pixel.
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
);

describe('detectType', () => {
    it('reads the content, not the name', async () => {
        expect(await detectType(file('photo.pdf', PNG))).toEqual({
            mime: 'image/png',
            kind: 'image',
            extension: 'png',
        });
        expect(await detectType(file('report.png', '%PDF-1.7\n%âã\n1 0 obj\n'))).toMatchObject({
            mime: 'application/pdf',
            kind: 'document',
        });
    });

    it('recognizes SVG, which has no magic number', async () => {
        const svg =
            '<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>';
        expect(await detectType(file('logo.txt', svg))).toEqual({
            mime: 'image/svg+xml',
            kind: 'image',
            extension: 'svg',
        });
        expect((await detectType(file('page.svg', '<html><svg></svg></html>'))).kind).toBe('other');
    });

    it('falls back to other', async () => {
        expect(await detectType(file('data.bin', Buffer.from([0, 1, 2, 3])))).toEqual({
            mime: 'application/octet-stream',
            kind: 'other',
            extension: undefined,
        });
    });
});

describe('kindOf', () => {
    it.each([
        ['image/webp', 'image'],
        ['video/mp4', 'video'],
        ['audio/mpeg', 'audio'],
        ['font/woff2', 'font'],
        ['application/font-sfnt', 'font'],
        ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document'],
        ['application/zip', 'other'],
    ])('%s is %s', (mime, kind) => {
        expect(kindOf(mime)).toBe(kind);
    });
});

describe('matchesMime', () => {
    it('matches exact types and wildcards', () => {
        expect(matchesMime('video/*', 'video/mp4')).toBe(true);
        expect(matchesMime('video/*', 'audio/mp4')).toBe(false);
        expect(matchesMime('image/png', 'image/png')).toBe(true);
        expect(matchesMime('image/png', 'image/pngx')).toBe(false);
    });
});
