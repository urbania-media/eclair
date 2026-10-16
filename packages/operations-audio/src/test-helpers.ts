import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import type { Operation } from '@eclair-js/operation';
import { runOperation } from '@eclair-js/operation/testing';

export function fixture(name: string): string {
    return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

/** What ffprobe reads from an output file: its streams and format. */
export function probeFile(path: string): {
    streams: {
        codec_type: string;
        codec_name: string;
        width?: number;
        height?: number;
        channels?: number;
        sample_rate?: string;
        bit_rate?: string;
        pix_fmt?: string;
    }[];
    format: { format_name: string; duration?: string };
} {
    const { stdout } = spawnSync(
        'ffprobe',
        ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path],
        { encoding: 'utf8' },
    );
    return JSON.parse(stdout) as ReturnType<typeof probeFile>;
}

/** Runs an operation on a fixture. Call `cleanup()` on the result. */
export function runOn(operation: Operation, name: string, options: Record<string, unknown> = {}) {
    return runOperation(operation, { input: fixture(name), options, timeout: 60_000 });
}
