import { execFile } from 'node:child_process';

import type { BinaryName } from './config/config.ts';

/** Arguments that make each binary print its version and exit. */
const VERSION_ARGUMENTS: Record<BinaryName, string[]> = {
    ffmpeg: ['-version'],
    ffprobe: ['-version'],
    magick: ['-version'],
    vips: ['--version'],
    gs: ['--version'],
    pdfinfo: ['-v'],
    pdftoppm: ['-v'],
    audiowaveform: ['--version'],
    fonttools: ['help'],
    'whisper-cli': ['--version'],
    'yt-dlp': ['--version'],
};

/** Binaries that only some images have: the embed variant's yt-dlp (decision 0022). */
export const OPTIONAL_BINARIES: readonly BinaryName[] = ['yt-dlp'];

const availability = new Map<string, Promise<boolean>>();

/** Whether a binary runs on this machine, checked once per path. */
export function isAvailable(name: BinaryName, path: string): Promise<boolean> {
    let known = availability.get(path);
    if (known === undefined) {
        known = checkBinary(name, path).then(({ status }) => status === 'ok');
        availability.set(path, known);
    }
    return known;
}

export interface BinaryStatus {
    name: BinaryName;
    path: string;
    /** `missing`: not found or not executable. `failed`: it ran but exited with an error or timed out. */
    status: 'ok' | 'missing' | 'failed';
    /** First line the binary printed: its version, or the error when it failed. */
    output: string | undefined;
}

/** Runs a binary with its version arguments. Never throws. */
export function checkBinary(
    name: BinaryName,
    path: string,
    timeout = 15_000,
): Promise<BinaryStatus> {
    return new Promise((resolve) => {
        execFile(path, VERSION_ARGUMENTS[name], { timeout }, (error, stdout, stderr) => {
            const code = (error as NodeJS.ErrnoException | null)?.code;
            const output = `${stdout}\n${stderr}`
                .split('\n')
                .map((text) => text.trim())
                .find((text) => text !== '');
            if (code === 'ENOENT' || code === 'EACCES') {
                resolve({ name, path, status: 'missing', output: undefined });
            } else if (error !== null) {
                const reason = error.killed ? `no answer after ${timeout} ms` : output;
                resolve({ name, path, status: 'failed', output: reason });
            } else {
                resolve({ name, path, status: 'ok', output });
            }
        });
    });
}

export function checkBinaries(binaries: Record<BinaryName, string>): Promise<BinaryStatus[]> {
    return Promise.all(
        (Object.keys(binaries) as BinaryName[]).map((name) => checkBinary(name, binaries[name])),
    );
}
