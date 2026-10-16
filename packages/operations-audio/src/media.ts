import { OperationError, ffmpegInput } from '@eclair-js/operation';
import type { OperationContext } from '@eclair-js/operation';

/** What the audio operations need to know about their input. */
export interface AudioInfo {
    /** Seconds, when the container says. */
    duration: number | undefined;
    channels: number | undefined;
    sampleRate: number | undefined;
}

interface FfprobeStream {
    codec_type?: string;
    channels?: number;
    sample_rate?: string;
    duration?: string;
}

function toNumber(value: unknown): number | undefined {
    const number = Number(value);
    return value === undefined || value === null || value === '' || !Number.isFinite(number)
        ? undefined
        : number;
}

/** Reads the audio stream of the input, an audio file or a video, with ffprobe. */
export async function readAudio(context: OperationContext): Promise<AudioInfo> {
    let output: { streams?: FfprobeStream[]; format?: { duration?: string } };
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
        output = JSON.parse(stdout) as typeof output;
    } catch (error) {
        throw new OperationError('input_unreadable', "The file can't be read as audio.", {
            cause: error,
        });
    }
    const audio = output.streams?.find((stream) => stream.codec_type === 'audio');
    if (audio === undefined) {
        throw new OperationError('unsupported_input', 'The file has no audio stream.');
    }
    return {
        duration: toNumber(output.format?.duration) ?? toNumber(audio.duration),
        channels: audio.channels,
        sampleRate: toNumber(audio.sample_rate),
    };
}

/** Audio and video files: the audio operations also read the soundtrack of a video. */
export const AUDIO_INPUTS = { kinds: ['audio' as const, 'video' as const] };
