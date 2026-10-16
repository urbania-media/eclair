import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { missingBinaries, runOperation, skipWithoutBinaries } from '@eclair-js/operation/testing';

import { convert } from './convert.ts';

function fixture(name: string): string {
    return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

function runOn(name: string, options: Record<string, unknown> = {}) {
    return runOperation(convert, { input: fixture(name), options, timeout: 60_000 });
}

/** The characters a font maps, from its cmap table. */
function codePoints(path: string): number[] {
    const { stdout } = spawnSync('fonttools', ['ttx', '-q', '-t', 'cmap', '-o', '-', path], {
        encoding: 'utf8',
    });
    return [
        ...new Set([...stdout.matchAll(/<map code="(0x[0-9a-f]+)"/g)].map((m) => Number(m[1]))),
    ].sort((a, b) => a - b);
}

async function signature(path: string): Promise<string> {
    return (await readFile(path)).subarray(0, 4).toString('latin1');
}

describe.skipIf(skipWithoutBinaries(convert.binaries))('font.convert', () => {
    it('has its binaries', () => {
        expect(missingBinaries(convert.binaries)).toEqual([]);
    });

    it('writes WOFF2 and WOFF with every character', async () => {
        const result = await runOn('font.ttf');
        try {
            expect(result.files.map(({ name, mime, role }) => ({ name, mime, role }))).toEqual([
                { name: 'font.woff2', mime: 'font/woff2', role: 'main' },
                { name: 'font.woff', mime: 'font/woff', role: 'woff' },
            ]);
            expect(result.metadata).toEqual({ formats: ['woff2', 'woff'], subset: false });
            expect(await signature(result.files[0]?.path ?? '')).toBe('wOF2');
            expect(await signature(result.files[1]?.path ?? '')).toBe('wOFF');
            for (const file of result.files) {
                expect(codePoints(file.path)).toEqual([0x20, 0x41, 0x42, 0x43, 0xe9]);
            }
        } finally {
            await result.cleanup();
        }
    });

    it('subsets to code points and text', async () => {
        const result = await runOn('font.woff2', {
            formats: ['woff'],
            unicodes: ['U+0041', '0020'],
            text: 'é',
        });
        try {
            expect(result.files.map(({ name }) => name)).toEqual(['font.woff']);
            expect(result.metadata).toEqual({ formats: ['woff'], subset: true });
            expect(codePoints(result.files[0]?.path ?? '')).toEqual([0x20, 0x41, 0xe9]);
        } finally {
            await result.cleanup();
        }
    });

    it('fails on a broken font', async () => {
        await expect(runOn('broken.ttf')).rejects.toMatchObject({ code: 'input_unreadable' });
    });
});
