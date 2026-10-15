import { fileTypeFromFile } from 'file-type';
import { open } from 'node:fs/promises';

import type { Kind } from '@eclair-js/protocol';

export interface DetectedType {
    mime: string;
    kind: Kind;
    /** Usual extension for the mime type, without the dot. */
    extension: string | undefined;
}

/** Mime types that are documents, besides `application/pdf`. */
const DOCUMENT_MIMES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'application/rtf',
    'application/epub+zip',
]);

const FONT_MIMES = new Set([
    'application/font-woff',
    'application/font-sfnt',
    'application/vnd.ms-opentype',
    'application/x-font-ttf',
]);

/** The kind of a mime type. */
export function kindOf(mime: string): Kind {
    const [type = ''] = mime.split('/');
    if (type === 'image') {
        return 'image';
    }
    if (type === 'video') {
        return 'video';
    }
    if (type === 'audio') {
        return 'audio';
    }
    if (type === 'font' || FONT_MIMES.has(mime)) {
        return 'font';
    }
    if (DOCUMENT_MIMES.has(mime)) {
        return 'document';
    }
    return 'other';
}

/** How much of the start of a file is read to recognize SVG, which has no magic number. */
const TEXT_SNIFF_BYTES = 4096;

async function readStart(path: string, bytes: number): Promise<string> {
    const handle = await open(path, 'r');
    try {
        const buffer = Buffer.alloc(bytes);
        const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
        return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
        await handle.close();
    }
}

function looksLikeSvg(start: string): boolean {
    // An XML declaration, comments or a doctype can come before the root element.
    const text = start.replace(/^\uFEFF/, '').trimStart();
    return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(text);
}

/**
 * Detects the type of a file from its content: magic numbers, or the root element for SVG. The
 * name, extension and claimed type of an upload are never used (rule 6 of AGENTS.md).
 */
export async function detectType(path: string): Promise<DetectedType> {
    const detected = await fileTypeFromFile(path);
    // An SVG with an XML declaration is detected as XML.
    if (detected !== undefined && detected.mime !== 'application/xml') {
        return { mime: detected.mime, kind: kindOf(detected.mime), extension: detected.ext };
    }
    if (looksLikeSvg(await readStart(path, TEXT_SNIFF_BYTES))) {
        return { mime: 'image/svg+xml', kind: 'image', extension: 'svg' };
    }
    if (detected !== undefined) {
        return { mime: detected.mime, kind: 'other', extension: detected.ext };
    }
    return { mime: 'application/octet-stream', kind: 'other', extension: undefined };
}

/** Whether a mime type matches a pattern: `video/mp4`, or `video/*` for every subtype. */
export function matchesMime(pattern: string, mime: string): boolean {
    if (pattern.endsWith('/*')) {
        return mime.startsWith(pattern.slice(0, -1));
    }
    return pattern === mime;
}
