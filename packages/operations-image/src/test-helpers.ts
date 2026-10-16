import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import type { Operation } from '@eclair-js/operation';
import { runOperation } from '@eclair-js/operation/testing';

export function fixture(name: string): string {
    return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

/** Runs an operation on a fixture. Call `cleanup()` on the result. */
export function runOn(operation: Operation, name: string, options: Record<string, unknown> = {}) {
    return runOperation(operation, { input: fixture(name), options, timeout: 60_000 });
}

/** What ImageMagick reads from an output: format, size, and its EXIF and ICC data. */
export function identify(path: string): {
    format: string;
    width: number;
    height: number;
    properties: string;
} {
    const { stdout } = spawnSync(
        'magick',
        ['identify', '-format', '%m %w %h\\n%[EXIF:*]%[profiles]\\n', path],
        { encoding: 'utf8' },
    );
    const [first = '', ...rest] = stdout.split('\n');
    const [format = '', width, height] = first.split(' ');
    return { format, width: Number(width), height: Number(height), properties: rest.join('\n') };
}

/** The color of a pixel, as ImageMagick names it: `srgb(255,0,0)`. */
export function pixel(path: string, x: number, y: number): string {
    // `identify`, because the image's policy denies the `info:` coder.
    return spawnSync('magick', ['identify', '-format', `%[pixel:p{${x},${y}}]`, path], {
        encoding: 'utf8',
    }).stdout.trim();
}
