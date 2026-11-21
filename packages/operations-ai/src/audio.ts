import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { OperationError, ffmpegInput, ffmpegProgress } from '@eclair-js/operation';
import type { OperationContext } from '@eclair-js/operation';

/** Below this peak volume, in dB, the audio is silence: the model isn't run. */
export const SILENCE_THRESHOLD = -60;

interface FfprobeOutput {
    streams?: { codec_type?: string; duration?: string }[];
    format?: { duration?: string };
}

function toNumber(value: unknown): number | undefined {
    const number = Number(value);
    return value === undefined || value === null || value === '' || !Number.isFinite(number)
        ? undefined
        : number;
}

/** The duration of the input's audio, in seconds, when the container says. Fails without audio. */
export async function probeAudio(context: OperationContext): Promise<number | undefined> {
    let output: FfprobeOutput;
    try {
        const { stdout } = await context.exec('ffprobe', [
            '-v',
            'error',
            '-print_format',
            'json',
            '-show_format',
            '-show_streams',
            ...ffmpegInput(context.input.path),
        ]);
        output = JSON.parse(stdout) as FfprobeOutput;
    } catch (error) {
        throw new OperationError('input_unreadable', "The file can't be read as audio.", {
            cause: error,
        });
    }
    const audio = output.streams?.find((stream) => stream.codec_type === 'audio');
    if (audio === undefined) {
        throw new OperationError('unsupported_input', 'The file has no audio stream.');
    }
    return toNumber(output.format?.duration) ?? toNumber(audio.duration);
}

export interface ExtractedAudio {
    /** 16 kHz mono 16-bit PCM WAV, what whisper.cpp reads. */
    path: string;
    /** Seconds, from the size of the PCM data. */
    duration: number;
    /** Peak volume in dB, `-91` for digital silence. */
    peak: number | undefined;
}

/**
 * Extracts the first audio stream as 16 kHz mono PCM, and measures its peak volume in the same pass
 * (`volumedetect`), so silence can be told without running a model.
 */
export async function extractAudio(
    context: OperationContext,
    duration: number | undefined,
    onProgress: (ratio: number) => void,
): Promise<ExtractedAudio> {
    const path = join(context.workdir, 'audio.wav');
    const { stderr } = await context.exec(
        'ffmpeg',
        [
            '-hide_banner',
            '-nostdin',
            '-v',
            'info',
            '-y',
            ...ffmpegInput(context.input.path),
            '-map',
            '0:a:0',
            '-vn',
            '-sn',
            '-dn',
            '-map_metadata',
            '-1',
            '-af',
            'volumedetect',
            '-ac',
            '1',
            '-ar',
            '16000',
            '-c:a',
            'pcm_s16le',
            '-progress',
            'pipe:1',
            '-nostats',
            path,
        ],
        { onStdout: ffmpegProgress(duration, onProgress) },
    );
    const { size } = await stat(path);
    const peak = toNumber(
        /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr)?.[1]?.replace('-inf', '-91'),
    );
    // A WAV header is 44 bytes (ffmpeg may add a LIST chunk: a few bytes don't matter here).
    return { path, duration: Math.max(0, size - 44) / (16000 * 2), peak };
}
