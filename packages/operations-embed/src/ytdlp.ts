import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { OperationError, detectType } from '@eclair-js/operation';
import type { EmbedOperationContext } from '@eclair-js/operation';
import type { ProbeMetadata } from '@eclair-js/protocol';

import { httpsUrl, isoDate, positive, removeUndefined, string } from './common.ts';
import type { DownloadRequest } from './common.ts';

export const YTDLP = 'yt-dlp';

/**
 * The yt-dlp extractor of each provider it may read (decision 0022). Vimeo goes through its API,
 * and Spotify's files are protected: neither is here.
 */
export const YTDLP_EXTRACTORS: Readonly<Record<string, string>> = {
    youtube: 'youtube',
    dailymotion: 'dailymotion',
    soundcloud: 'soundcloud',
    tiktok: 'tiktok',
    instagram: 'instagram',
};

/** Whether yt-dlp can read this embed on this worker. */
export async function canUseYtdlp(context: EmbedOperationContext): Promise<boolean> {
    return (
        YTDLP_EXTRACTORS[context.input.provider] !== undefined && (await context.available(YTDLP))
    );
}

/**
 * The arguments every run starts with. yt-dlp reads no configuration, cookies or cache, only one
 * video, with the provider's own extractor, from the canonical URL that the provider recognized,
 * never the URL as the job gave it. It solves YouTube's challenges with Node, and fetches no remote
 * code to do it.
 */
function baseArguments(context: EmbedOperationContext): string[] {
    const extractor = YTDLP_EXTRACTORS[context.input.provider];
    if (extractor === undefined) {
        throw new OperationError(
            'unsupported_input',
            `yt-dlp doesn't read embeds from ${context.input.provider} here.`,
        );
    }
    return [
        '--ignore-config',
        '--no-cache-dir',
        '--no-playlist',
        '--no-warnings',
        '--use-extractors',
        extractor,
        '--js-runtimes',
        'node',
        '--socket-timeout',
        '20',
        '--retries',
        '2',
    ];
}

/** The ERROR line of yt-dlp's output, without the worker's paths. */
function reasonOf(error: unknown, workdir: string): string {
    const output =
        error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
    const line =
        output
            .split('\n')
            .reverse()
            .find((text) => text.includes('ERROR')) ??
        output.split('\n').at(-1) ??
        '';
    return line
        .replaceAll(workdir, '…')
        .replace(/^ERROR:\s*/, '')
        .trim()
        .slice(0, 300);
}

/** yt-dlp's failure, in the protocol's codes: the platform refused the server, or the embed is gone. */
export function ytdlpError(error: unknown, workdir: string): OperationError {
    if (error instanceof OperationError && error.code !== 'operation_failed') {
        return error;
    }
    const reason = reasonOf(error, workdir);
    if (/confirm you.re not a bot|HTTP Error 429|Too Many Requests|rate.?limit/i.test(reason)) {
        return new OperationError(
            'provider_refused',
            `The platform refused the server: ${reason}`,
            { cause: error },
        );
    }
    if (
        /private|unavailable|not available|removed|deleted|log ?in|sign in|HTTP Error 40[134]/i.test(
            reason,
        )
    ) {
        return new OperationError('provider_unavailable', reason, { cause: error });
    }
    return new OperationError(
        'provider_failed',
        reason === '' ? "yt-dlp couldn't read the embed." : `yt-dlp: ${reason}`,
        { cause: error },
    );
}

/** What yt-dlp reads about the embed, without downloading it. */
export async function ytdlpInfo(context: EmbedOperationContext): Promise<Record<string, unknown>> {
    let stdout: string;
    try {
        ({ stdout } = await context.exec(YTDLP, [
            ...baseArguments(context),
            '--dump-single-json',
            '--skip-download',
            context.input.url,
        ]));
    } catch (error) {
        throw ytdlpError(error, context.workdir);
    }
    try {
        return JSON.parse(stdout) as Record<string, unknown>;
    } catch (error) {
        throw new OperationError('provider_failed', "yt-dlp didn't answer JSON.", { cause: error });
    }
}

const PRIVACY: Record<string, 'public' | 'unlisted' | 'private'> = {
    public: 'public',
    unlisted: 'unlisted',
    private: 'private',
    needs_auth: 'private',
    subscriber_only: 'private',
    premium_only: 'private',
};

/**
 * Fills what the API or oEmbed didn't give with what yt-dlp read, never replacing a field the
 * provider gave: the duration of SoundCloud, TikTok and Instagram embeds, mostly.
 */
export function completeWithInfo(
    metadata: ProbeMetadata,
    info: Record<string, unknown>,
): ProbeMetadata {
    const live =
        info['is_live'] === true ||
        ['is_live', 'is_upcoming'].includes(String(info['live_status']));
    const authorId = string(info['channel_id']) ?? string(info['uploader_id']);
    const availability = string(info['availability']);
    const found = removeUndefined({
        duration: positive(info['duration']),
        width: positive(info['width']),
        height: positive(info['height']),
        embed: {
            title: string(info['title']),
            description: string(info['description']),
            author: {
                id: authorId,
                name: string(info['uploader']) ?? string(info['channel']),
                url: httpsUrl(info['uploader_url']) ?? httpsUrl(info['channel_url']),
            },
            thumbnailUrl: httpsUrl(info['thumbnail']),
            publishedAt: isoDate(info['timestamp']),
            live:
                info['is_live'] === undefined && info['live_status'] === undefined
                    ? undefined
                    : live,
            privacy: availability === undefined ? undefined : PRIVACY[availability],
        },
    });
    const merged = { ...found, ...metadata } as Record<string, unknown>;
    const embed = { ...(found['embed'] as object), ...metadata.embed } as Record<string, unknown>;
    const foundAuthor = (found['embed'] as { author?: object } | undefined)?.author;
    if (foundAuthor !== undefined || metadata.embed?.author !== undefined) {
        embed['author'] = { ...foundAuthor, ...metadata.embed?.author };
    }
    merged['embed'] = embed;
    return merged as ProbeMetadata;
}

/** The formats to ask for: yt-dlp's selectors, the best file within the height, or the audio. */
function formatOf(request: DownloadRequest): string {
    if (request.audioOnly) {
        return 'ba/b';
    }
    if (request.quality === 'best') {
        return 'bv*+ba/b';
    }
    const height = request.quality;
    return `bv*[height<=${height}]+ba/b[height<=${height}]/wv*+ba/w`;
}

/** What the `--print` of a download gives, as JSON. */
const PRINTED = '%(.{filepath,id,format_id,ext,duration,width,height,filesize})j';

/**
 * Downloads an embed with yt-dlp, for the platforms that give no file through an API. One run: the
 * live, duration and size limits are yt-dlp's filters, so the platform sees one request for the
 * page and the download. Without a printed file, a filter refused it.
 */
export async function ytdlpDownload(
    context: EmbedOperationContext,
    request: DownloadRequest,
): Promise<Record<string, unknown>> {
    const { limits, workdir } = context;
    const printed: string[] = [];
    let pending = '';
    const onStdout = (chunk: string) => {
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
            const progress = /^eclair-progress (\d+) (\d+)/.exec(line);
            if (progress !== null) {
                const [, done, total] = progress;
                if (Number(total) > 0) {
                    context.progress(Number(done) / Number(total));
                }
            } else if (line.startsWith('{')) {
                printed.push(line);
            }
        }
    };
    try {
        await context.exec(
            YTDLP,
            [
                ...baseArguments(context),
                '--format',
                formatOf(request),
                '--merge-output-format',
                'mp4/mkv',
                '--match-filters',
                `!is_live & duration <=? ${limits.maxDuration}`,
                '--max-filesize',
                String(limits.maxSize),
                '--paths',
                workdir,
                '--paths',
                `temp:${workdir}`,
                '--output',
                'download.%(ext)s',
                '--no-mtime',
                '--no-simulate',
                '--print',
                `after_move:${PRINTED}`,
                '--progress',
                '--newline',
                '--progress-template',
                'download:eclair-progress %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s',
                context.input.url,
            ],
            { onStdout },
        );
    } catch (error) {
        throw ytdlpError(error, workdir);
    }
    if (pending.startsWith('{')) {
        printed.push(pending);
    }
    const info =
        printed.length === 0
            ? undefined
            : (JSON.parse(printed.at(-1) ?? '{}') as Record<string, unknown>);
    const files = (await readdir(workdir)).filter((name) => name.startsWith('download.'));
    if (info === undefined || files.length === 0) {
        throw new OperationError(
            'limit_exceeded',
            `The embed is live, longer than ${limits.maxDuration} s, or larger than ${limits.maxSize} bytes.`,
        );
    }
    // The file yt-dlp names, in the work directory only.
    const name = files.find((file) => join(workdir, file) === info['filepath']) ?? files[0] ?? '';
    const path = join(workdir, name);
    const type = await detectType(path);
    // SoundCloud only has audio; elsewhere, a video unless the audio was asked for.
    const wanted =
        request.audioOnly || context.input.provider === 'soundcloud'
            ? ['audio', 'video']
            : ['video'];
    if (!wanted.includes(type.kind)) {
        throw new OperationError(
            'input_unreadable',
            `yt-dlp wrote a ${type.mime} file, not ${request.audioOnly ? 'an audio' : 'a video'}.`,
        );
    }
    const extension = type.extension ?? string(info['ext']) ?? 'bin';
    context.output(`${type.kind === 'audio' ? 'audio' : 'video'}.${extension}`, path, {
        mime: type.mime,
        role: 'main',
    });
    const { size } = await stat(path);
    return {
        provider: context.input.provider,
        id: context.input.id,
        backend: 'yt-dlp',
        format: string(info['format_id']),
        mime: type.mime,
        size,
        width: positive(info['width']),
        height: positive(info['height']),
        duration: positive(info['duration']),
    };
}
