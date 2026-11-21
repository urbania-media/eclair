import { access, readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';

import { OperationError } from '@eclair-js/operation';

import type { TranscriptionProvider } from './provider.ts';
import type { Transcript, TranscriptSegment, TranscriptWord } from './transcript.ts';

/** The operator's settings of `local-whisper`, from the server's configuration. */
export interface LocalWhisperSettings {
    /** Directory of the models: `ggml-<model>.bin`, and the VAD model. */
    modelsDir: string;
    /** The model when a task gives none. */
    defaultModel: string;
    /** File name of a Silero VAD model in `modelsDir`. VAD is skipped when it isn't there. */
    vadModel: string | undefined;
    /** Threads of whisper.cpp. All the worker's CPUs by default. */
    threads: number;
    /** Seconds of audio a task can transcribe. */
    maxDuration: number;
}

export const LOCAL_WHISPER_DEFAULTS: LocalWhisperSettings = {
    modelsDir: '/var/lib/eclair/models',
    defaultModel: 'large-v3-turbo-q5_0',
    vadModel: 'ggml-silero-v6.2.0.bin',
    threads: availableParallelism(),
    maxDuration: 4 * 3600,
};

/** Reads the settings the context gives, over the defaults. Unknown keys are ignored. */
export function localWhisperSettings(
    settings: Readonly<Record<string, unknown>> = {},
): LocalWhisperSettings {
    const string = (key: string) =>
        typeof settings[key] === 'string' && settings[key] !== '' ? settings[key] : undefined;
    const number = (key: string) =>
        typeof settings[key] === 'number' && Number.isFinite(settings[key]) && settings[key] > 0
            ? settings[key]
            : undefined;
    return {
        modelsDir: string('modelsDir') ?? LOCAL_WHISPER_DEFAULTS.modelsDir,
        defaultModel: string('defaultModel') ?? LOCAL_WHISPER_DEFAULTS.defaultModel,
        vadModel:
            settings['vadModel'] === null
                ? undefined
                : (string('vadModel') ?? LOCAL_WHISPER_DEFAULTS.vadModel),
        threads: Math.floor(number('threads') ?? LOCAL_WHISPER_DEFAULTS.threads),
        maxDuration: number('maxDuration') ?? LOCAL_WHISPER_DEFAULTS.maxDuration,
    };
}

/** whisper.cpp's full JSON output (`-ojf`), as far as it's read here. */
interface WhisperJson {
    result?: { language?: string };
    transcription?: {
        offsets?: { from?: number; to?: number };
        text?: string;
        tokens?: { text?: string; offsets?: { from?: number; to?: number }; p?: number }[];
    }[];
}

/** Special tokens of whisper.cpp: `[_BEG_]`, `[_TT_150]`, `[_SOT_]`… */
const SPECIAL_TOKEN = /^\s*\[_[A-Z]+_?\d*\]\s*$/;

/**
 * Words of a segment from its tokens. A token that starts with a space starts a word; the others
 * (the rest of a word, punctuation) are added to the current word.
 */
export function wordsOfTokens(
    tokens: NonNullable<NonNullable<WhisperJson['transcription']>[number]['tokens']>,
): TranscriptWord[] {
    const words: (TranscriptWord & { probabilities: number[] })[] = [];
    for (const token of tokens) {
        const text = token.text ?? '';
        if (text === '' || SPECIAL_TOKEN.test(text)) {
            continue;
        }
        const from = (token.offsets?.from ?? 0) / 1000;
        const to = (token.offsets?.to ?? 0) / 1000;
        const current = words.at(-1);
        if (current === undefined || /^\s/.test(text)) {
            const trimmed = text.trim();
            if (trimmed === '') {
                continue;
            }
            words.push({ start: from, end: Math.max(from, to), text: trimmed, probabilities: [] });
        } else {
            current.text += text.trimEnd();
            current.end = Math.max(current.end, to);
        }
        if (typeof token.p === 'number') {
            words.at(-1)?.probabilities.push(token.p);
        }
    }
    return words.map(({ probabilities, ...word }) =>
        probabilities.length === 0
            ? word
            : {
                  ...word,
                  probability: probabilities.reduce((sum, p) => sum + p, 0) / probabilities.length,
              },
    );
}

/** Escapes the control characters of string literals; the ones between values are whitespace. */
function escapeControlCharacters(raw: string): string {
    let result = '';
    let inString = false;
    let escaped = false;
    for (const character of raw) {
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            } else if (character < ' ') {
                result += `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
                continue;
            }
        } else if (character === '"') {
            inString = true;
        }
        result += character;
    }
    return result;
}

/**
 * Parses whisper.cpp's full JSON. It escapes quotes and backslashes but not control characters,
 * which a token can contain: they're escaped before parsing.
 */
export function parseWhisperJson(raw: string): Transcript {
    const json = JSON.parse(escapeControlCharacters(raw)) as WhisperJson;
    const segments: TranscriptSegment[] = [];
    for (const segment of json.transcription ?? []) {
        const text = (segment.text ?? '').trim();
        if (text === '') {
            continue;
        }
        segments.push({
            start: (segment.offsets?.from ?? 0) / 1000,
            end: (segment.offsets?.to ?? 0) / 1000,
            text,
            words: wordsOfTokens(segment.tokens ?? []),
        });
    }
    return { language: json.result?.language, segments };
}

async function exists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

/** `local-whisper`: whisper.cpp's `whisper-cli` on the worker, with a model of `modelsDir`. */
export function localWhisper(settings: LocalWhisperSettings): TranscriptionProvider {
    return {
        name: 'local-whisper',
        maxDuration: settings.maxDuration,

        async transcribe(context, request) {
            const model = request.model ?? settings.defaultModel;
            const modelPath = join(settings.modelsDir, `ggml-${model}.bin`);
            if (!(await exists(modelPath))) {
                throw new OperationError(
                    'provider_failed',
                    `The model "${model}" isn't installed on this worker.`,
                );
            }
            const vadPath =
                settings.vadModel === undefined
                    ? undefined
                    : join(settings.modelsDir, settings.vadModel);
            const vad = vadPath !== undefined && (await exists(vadPath));
            if (!vad) {
                context.log.warn('No VAD model: silences may be transcribed as made-up text.', {
                    model,
                });
            }
            const output = join(context.workdir, 'whisper');
            await context.exec('whisper-cli', [
                '--model',
                modelPath,
                '--file',
                request.audio,
                '--language',
                request.language ?? 'auto',
                '--threads',
                String(settings.threads),
                '--output-json-full',
                '--output-file',
                output,
                '--no-prints',
                ...(vad && vadPath !== undefined ? ['--vad', '--vad-model', vadPath] : []),
                ...(request.prompt === undefined ? [] : ['--prompt', request.prompt]),
            ]);
            let raw: string;
            try {
                raw = await readFile(`${output}.json`, 'utf8');
            } catch (error) {
                throw new OperationError('provider_failed', 'whisper.cpp wrote no transcript.', {
                    cause: error,
                });
            }
            const transcript = parseWhisperJson(raw);
            return {
                transcript: { ...transcript, language: transcript.language ?? request.language },
                model,
                usage: { mediaSeconds: request.duration },
            };
        },
    };
}
