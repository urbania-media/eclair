import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { Type } from 'typebox';

import { OperationError, defineOperation } from '@eclair-js/operation';
import type { OperationContext } from '@eclair-js/operation';
import type { ProbeMetadata } from '@eclair-js/protocol';

const ProbeOptions = Type.Object(
    {
        /** Adds the SHA-256 of the whole file, which reads all of it. */
        checksum: Type.Boolean({ default: false }),
        /** Adds a summary of the EXIF data of images. GPS data is never included. */
        exif: Type.Boolean({ default: true }),
    },
    { additionalProperties: false },
);

type Metadata = { -readonly [Key in keyof ProbeMetadata]: ProbeMetadata[Key] };

/**
 * ImageMagick decoders for the image types it reads. The decoder is always given explicitly, so
 * ImageMagick never guesses a format from the content or the name.
 */
const IMAGEMAGICK_CODERS: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpeg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/heic': 'heic',
    'image/heif': 'heic',
    'image/tiff': 'tiff',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
};

/** EXIF tags kept in the summary. GPS tags and serial numbers are left out. */
const EXIF_TAGS = [
    'Make',
    'Model',
    'LensModel',
    'Software',
    'DateTimeOriginal',
    'ExposureTime',
    'FNumber',
    'ISOSpeedRatings',
    'PhotographicSensitivity',
    'FocalLength',
    'Orientation',
];

/** Clockwise rotation for each EXIF orientation, as ImageMagick names it. Mirroring is ignored. */
const EXIF_ROTATIONS: Record<string, 0 | 90 | 180 | 270> = {
    TopLeft: 0,
    TopRight: 0,
    BottomRight: 180,
    BottomLeft: 180,
    LeftTop: 90,
    RightTop: 90,
    RightBottom: 270,
    LeftBottom: 270,
};

function toNumber(value: unknown): number | undefined {
    const number = typeof value === 'number' ? value : Number(value);
    return value === undefined || value === null || value === '' || !Number.isFinite(number)
        ? undefined
        : number;
}

/** `30000/1001` as a number of frames per second. */
function parseRate(value: unknown): number | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const [numerator, denominator] = value.split('/').map(Number);
    if (
        numerator === undefined ||
        denominator === undefined ||
        denominator === 0 ||
        numerator === 0
    ) {
        return undefined;
    }
    return Math.round((numerator / denominator) * 1000) / 1000;
}

/** A clockwise rotation in 0, 90, 180 or 270, from any angle. */
function normalizeRotation(degrees: number): 0 | 90 | 180 | 270 {
    const quarter = Math.round((((degrees % 360) + 360) % 360) / 90) % 4;
    return ([0, 90, 180, 270] as const)[quarter] ?? 0;
}

function unreadable(kind: string, error: unknown): OperationError {
    return new OperationError('input_unreadable', `The file can't be read as ${kind}.`, {
        cause: error,
    });
}

interface FfprobeStream {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    channels?: number;
    duration?: string;
    disposition?: { attached_pic?: number };
    side_data_list?: { rotation?: number }[];
    tags?: { rotate?: string };
}

interface FfprobeOutput {
    streams?: FfprobeStream[];
    format?: { duration?: string; bit_rate?: string };
}

async function probeMedia(context: OperationContext, metadata: Metadata): Promise<void> {
    let output: FfprobeOutput;
    try {
        const { stdout } = await context.exec('ffprobe', [
            '-v',
            'error',
            '-print_format',
            'json',
            '-show_format',
            '-show_streams',
            context.input.path,
        ]);
        output = JSON.parse(stdout) as FfprobeOutput;
    } catch (error) {
        throw unreadable(metadata.kind, error);
    }

    const streams = output.streams ?? [];
    // A cover image in an audio file is a video stream marked as an attached picture.
    const video = streams.find(
        (stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1,
    );
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    if (video === undefined && audio === undefined) {
        throw new OperationError('input_unreadable', `The file has no audio or video stream.`);
    }
    if (video === undefined) {
        metadata.kind = 'audio';
    }

    const duration = toNumber(output.format?.duration) ?? toNumber((video ?? audio)?.duration);
    if (duration !== undefined) {
        metadata.duration = Math.round(duration * 1000) / 1000;
    }
    const bitrate = toNumber(output.format?.bit_rate);
    if (bitrate !== undefined) {
        metadata.bitrate = Math.round(bitrate);
    }
    if (video !== undefined) {
        if (video.width !== undefined && video.height !== undefined) {
            metadata.width = video.width;
            metadata.height = video.height;
        }
        const frameRate = parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate);
        if (frameRate !== undefined) {
            metadata.frameRate = frameRate;
        }
        if (video.codec_name !== undefined) {
            metadata.videoCodec = video.codec_name;
        }
        // ffprobe reports the display matrix counterclockwise; the protocol says clockwise.
        const matrix = video.side_data_list?.find((data) => data.rotation !== undefined)?.rotation;
        const tag = toNumber(video.tags?.rotate);
        metadata.rotation =
            matrix !== undefined ? normalizeRotation(-matrix) : normalizeRotation(tag ?? 0);
    }
    if (audio !== undefined) {
        if (audio.codec_name !== undefined) {
            metadata.audioCodec = audio.codec_name;
        }
        if (audio.channels !== undefined) {
            metadata.audioChannels = audio.channels;
        }
    }
}

async function probeImage(
    context: OperationContext,
    metadata: Metadata,
    exif: boolean,
): Promise<void> {
    const coder = IMAGEMAGICK_CODERS[context.input.mime];
    if (coder === undefined) {
        // Readable by the probe as a type, but not by ImageMagick: report what's known.
        return;
    }
    const source = `${coder}:${context.input.path}`;
    try {
        const { stdout } = await context.exec('magick', [
            'identify',
            '-ping',
            '-format',
            '%w %h %[orientation]\\n',
            source,
        ]);
        const lines = stdout.trim().split('\n');
        const [width, height, orientation] = (lines[0] ?? '').split(' ');
        metadata.width = Number(width);
        metadata.height = Number(height);
        metadata.rotation = EXIF_ROTATIONS[orientation ?? ''] ?? 0;
        metadata.animated = lines.length > 1;
    } catch (error) {
        throw unreadable('an image', error);
    }

    if (exif && (coder === 'jpeg' || coder === 'tiff' || coder === 'heic' || coder === 'webp')) {
        const { stdout } = await context.exec('magick', [
            'identify',
            '-format',
            '%[EXIF:*]',
            source,
        ]);
        const summary: Record<string, string> = {};
        for (const line of stdout.split('\n')) {
            const match = /^exif:([A-Za-z]+)=(.*)$/.exec(line.trim());
            if (
                match?.[1] !== undefined &&
                match[2] !== undefined &&
                EXIF_TAGS.includes(match[1])
            ) {
                summary[match[1]] = match[2].slice(0, 256);
            }
        }
        if (Object.keys(summary).length > 0) {
            metadata.exif = summary;
        }
    }
}

/** Reads an SVG's size from its root element, without rendering it. */
async function probeSvg(path: string, metadata: Metadata): Promise<void> {
    const handle = await open(path, 'r');
    let text: string;
    try {
        const buffer = Buffer.alloc(64 * 1024);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        text = buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
        await handle.close();
    }
    const root = /<svg\b[^>]*>/i.exec(text)?.[0] ?? '';
    const attribute = (name: string) =>
        new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(root)?.[1];
    const length = (value: string | undefined) => {
        const match = /^\s*([0-9.]+)\s*(px)?\s*$/.exec(value ?? '');
        return match?.[1] === undefined ? undefined : Math.round(Number(match[1]));
    };
    const viewBox = attribute('viewBox')
        ?.trim()
        .split(/[\s,]+/)
        .map(Number);
    const width =
        length(attribute('width')) ??
        (viewBox?.length === 4 ? Math.round(viewBox[2] ?? 0) : undefined);
    const height =
        length(attribute('height')) ??
        (viewBox?.length === 4 ? Math.round(viewBox[3] ?? 0) : undefined);
    if (width !== undefined && height !== undefined) {
        metadata.width = width;
        metadata.height = height;
    }
    metadata.rotation = 0;
    metadata.animated = false;
}

async function probePdf(context: OperationContext, metadata: Metadata): Promise<void> {
    try {
        const { stdout } = await context.exec('pdfinfo', [context.input.path]);
        const pages = /^Pages:\s+(\d+)/m.exec(stdout)?.[1];
        if (pages !== undefined) {
            metadata.pageCount = Number(pages);
        }
        // Size of the first page, in points.
        const size = /^Page size:\s+([0-9.]+) x ([0-9.]+) pts/m.exec(stdout);
        if (size?.[1] !== undefined && size[2] !== undefined) {
            metadata.width = Math.round(Number(size[1]));
            metadata.height = Math.round(Number(size[2]));
        }
    } catch (error) {
        throw unreadable('a PDF', error);
    }
}

function decodeXml(text: string): string {
    return text
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&');
}

async function probeFont(context: OperationContext, metadata: Metadata): Promise<void> {
    try {
        const { stdout } = await context.exec('fonttools', [
            'ttx',
            '-q',
            '-t',
            'name',
            '-o',
            '-',
            context.input.path,
        ]);
        // Family (1), full name (4) and typographic family (16).
        const names = [
            ...stdout.matchAll(/<namerecord nameID="(1|4|16)"[^>]*>([\s\S]*?)<\/namerecord>/g),
        ]
            .map((match) => decodeXml(match[2] ?? '').trim())
            .filter((name) => name !== '');
        metadata.fontNames = [...new Set(names)];
    } catch (error) {
        throw unreadable('a font', error);
    }
}

async function sha256(path: string, signal: AbortSignal): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path, { signal })) {
        hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
}

/**
 * Reads what a file is: its type from its content, then what applies to its kind (decision 0012).
 * Fast by design: the binaries read headers, not whole files, except for the optional checksum.
 */
export const probe = defineOperation({
    name: 'probe',
    version: 1,
    description:
        'Type, size and dimensions; duration, frame rate, bitrate, codecs and channels; page count; font names; animation; an EXIF summary without GPS; and an optional checksum.',
    accepts: {},
    capability: 'probe',
    binaries: ['ffprobe', 'magick', 'pdfinfo', 'fonttools'],
    options: ProbeOptions,
    outputs: { files: false, metadata: true },

    async run(context, options) {
        const { input } = context;
        const metadata: Metadata = {
            kind: input.kind,
            mime: input.mime,
            size: input.size,
            ...(input.extension === undefined ? {} : { extension: input.extension }),
        };

        if (input.kind === 'video' || input.kind === 'audio') {
            await probeMedia(context, metadata);
        } else if (input.mime === 'image/svg+xml') {
            await probeSvg(input.path, metadata);
        } else if (input.kind === 'image') {
            await probeImage(context, metadata, options.exif);
        } else if (input.mime === 'application/pdf') {
            await probePdf(context, metadata);
        } else if (input.kind === 'font') {
            await probeFont(context, metadata);
        }

        if (options.checksum) {
            metadata.checksum = await sha256(input.path, context.signal);
        }
        return { metadata: metadata as Record<string, unknown> };
    },
});
