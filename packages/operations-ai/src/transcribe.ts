import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Type } from 'typebox';

import { OperationError, defineOperation } from '@eclair-js/operation';
import type { OperationContext } from '@eclair-js/operation';

import { amazonTranscribe, amazonTranscribeSettings } from './amazon-transcribe.ts';
import { SILENCE_THRESHOLD, extractAudio, probeAudio } from './audio.ts';
import { toJson, toSrt, toWebVtt } from './formats.ts';
import { localWhisper, localWhisperSettings } from './local-whisper.ts';
import type { TranscriptionProvider, TranscriptionResult } from './provider.ts';
import { roundTime } from './transcript.ts';

type Format = 'json' | 'vtt' | 'srt';

const FORMATS: Record<Format, { file: string; mime: string; role: string }> = {
    json: { file: 'transcript.json', mime: 'application/json', role: 'transcript' },
    vtt: { file: 'transcript.vtt', mime: 'text/vtt', role: 'subtitles' },
    srt: { file: 'transcript.srt', mime: 'application/x-subrip', role: 'subtitles' },
};

const TranscribeOptions = Type.Object(
    {
        language: Type.String({
            pattern: '^(auto|[a-z]{2,3}(-[A-Z]{2})?)$',
            default: 'auto',
            description:
                'The spoken language: an ISO 639-1 code (`fr`), a locale for the providers that tell them apart (`fr-CA`), or `auto` to detect it.',
        }),
        provider: Type.Optional(
            Type.String({
                pattern: '^[a-z][a-z0-9-]{0,63}$',
                description:
                    "The transcription provider, among the project's (`aiProviders`). The project's first one by default.",
            }),
        ),
        model: Type.Optional(
            Type.String({
                pattern: '^[a-z0-9][a-z0-9._-]{0,63}$',
                description:
                    "The provider's model (`large-v3-turbo-q5_0`, `medium-q5_0`…). The worker's default otherwise.",
            }),
        ),
        formats: Type.Array(
            Type.Union([Type.Literal('json'), Type.Literal('vtt'), Type.Literal('srt')]),
            {
                minItems: 1,
                uniqueItems: true,
                default: ['json', 'vtt', 'srt'],
                description: 'Files to write. The first one is the main file.',
            },
        ),
        words: Type.Boolean({
            default: true,
            description: 'Word timings in the JSON file.',
        }),
        prompt: Type.Optional(
            Type.String({
                maxLength: 500,
                description:
                    'Names and words likely to be spoken, and the style of the text, to help the model spell them.',
            }),
        ),
    },
    { additionalProperties: false },
);

/** The provider of the `transcription` capability the context gives: `local-whisper` by default. */
function providerOf(context: OperationContext): TranscriptionProvider {
    const configured = context.providers?.transcription;
    const name = configured?.name ?? 'local-whisper';
    switch (name) {
        case 'local-whisper':
            return localWhisper(localWhisperSettings(configured?.settings));
        case 'amazon-transcribe':
            return amazonTranscribe(
                amazonTranscribeSettings(configured?.credentials, configured?.settings),
            );
        default:
            throw new OperationError(
                'provider_failed',
                `The transcription provider "${name}" isn't available.`,
            );
    }
}

/**
 * Asks for the time the provider needs on this audio, before a job starts: a task that would
 * time out halfway through a paid job fails now instead.
 */
function askTime(context: OperationContext, provider: TranscriptionProvider, duration: number) {
    const needed = provider.timeFor(duration);
    if (context.extendTimeout !== undefined && !context.extendTimeout(needed)) {
        throw new OperationError(
            'limit_exceeded',
            `The audio lasts ${Math.round(duration)} s: ${provider.name} may need ${Math.round(needed / 60_000)} minutes, more than a task may run on this server.`,
        );
    }
}

/** Transcribes the speech of an audio file or a video. */
export const transcribe = defineOperation({
    name: 'ai.transcribe',
    version: 1,
    description:
        'Transcript with timings, through the transcription provider: JSON with segments and words, WebVTT and SRT.',
    accepts: { kinds: ['audio', 'video'] },
    capability: 'ai',
    binaries: ['ffprobe', 'ffmpeg'],
    // Only `local-whisper` runs it: a worker that only sends audio to Amazon can do without.
    optionalBinaries: ['whisper-cli'],
    options: TranscribeOptions,
    providers: 'transcription',
    // A task of an external provider only waits on it: it doesn't hold a slot of the `ai` queue.
    externalQueue: 'network',
    outputs: { files: true, metadata: true },

    async run(context, options) {
        const provider = providerOf(context);
        const probed = await probeAudio(context);
        if (probed !== undefined && probed > provider.maxDuration) {
            throw new OperationError(
                'limit_exceeded',
                `The audio lasts ${Math.round(probed)} s, more than the ${provider.maxDuration} s this provider transcribes.`,
            );
        }
        if (probed !== undefined) {
            askTime(context, provider, probed);
        }
        const audio = await extractAudio(context, probed, (ratio) => context.progress(ratio * 0.1));
        if (audio.duration > provider.maxDuration) {
            throw new OperationError(
                'limit_exceeded',
                `The audio lasts ${Math.round(audio.duration)} s, more than the ${provider.maxDuration} s this provider transcribes.`,
            );
        }
        askTime(context, provider, audio.duration);
        const language = options.language === 'auto' ? undefined : options.language;
        const baseLanguage = language?.split('-')[0];
        const silent =
            audio.duration < 0.1 || (audio.peak !== undefined && audio.peak < SILENCE_THRESHOLD);

        let result: TranscriptionResult;
        if (silent) {
            context.log.info('The audio is silent: nothing to transcribe.', { peak: audio.peak });
            result = {
                transcript: { language: baseLanguage, segments: [] },
                model: options.model,
                usage: { mediaSeconds: audio.duration },
            };
        } else {
            result = await provider.transcribe(context, {
                audio: audio.path,
                duration: audio.duration,
                language,
                model: options.model,
                prompt: options.prompt,
            });
        }
        context.progress(0.95);

        const { transcript } = result;
        for (const [index, format] of options.formats.entries()) {
            const { file, mime, role } = FORMATS[format];
            const path = join(context.workdir, file);
            const content =
                format === 'json'
                    ? toJson(transcript, {
                          duration: audio.duration,
                          provider: provider.name,
                          model: result.model,
                          words: options.words,
                      })
                    : format === 'vtt'
                      ? toWebVtt(transcript)
                      : toSrt(transcript);
            await writeFile(path, content);
            context.output(file, path, { mime, role: index === 0 ? 'main' : role });
        }

        const words = transcript.segments.reduce(
            (count, segment) => count + segment.words.length,
            0,
        );
        return {
            metadata: {
                provider: provider.name,
                model: result.model ?? null,
                language: transcript.language ?? null,
                duration: roundTime(audio.duration),
                speech: transcript.segments.length > 0,
                segments: transcript.segments.length,
                words,
                // What the provider used: the seconds of audio, and the cost when it's known.
                usage: {
                    mediaSeconds: roundTime(result.usage.mediaSeconds),
                    ...(result.usage.cost === undefined
                        ? {}
                        : { cost: { amount: result.usage.cost, currency: 'USD' } }),
                },
            },
            usage: { mediaSeconds: result.usage.mediaSeconds },
        };
    },
});
