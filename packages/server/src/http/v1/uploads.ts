import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

import type { Upload } from '@eclair-js/protocol';

import type { Services } from '../../services.ts';
import { toUploadResponse } from '../../uploads/uploads.ts';
import { authOf } from '../auth.ts';
import { HttpProblem, problems } from '../problem.ts';

const TUS_VERSION = '1.0.0';

function tooLarge(limit: number): HttpProblem {
    return new HttpProblem(413, 'Content Too Large', {
        detail: `The file is larger than ${limit} bytes. Use a resumable upload, or a URL or storage input.`,
    });
}

interface SpooledFile {
    path: string;
    size: number;
    sha256: string;
}

/**
 * Writes a request body to a file of the API's temporary directory, with its size and SHA-256.
 * Fails with 413 past `maxSize`, without reading the rest. The request stream isn't destroyed, so
 * the 413 can be sent; the connection is closed after it.
 */
async function spool(stream: Readable, directory: string, maxSize: number): Promise<SpooledFile> {
    await mkdir(directory, { recursive: true });
    const path = join(directory, `body-${randomBytes(8).toString('hex')}`);
    const hash = createHash('sha256');
    const file = createWriteStream(path);
    let size = 0;
    let exceeded = false;
    try {
        for await (const chunk of stream.iterator({
            destroyOnReturn: false,
        }) as AsyncIterable<Buffer>) {
            size += chunk.length;
            if (size > maxSize) {
                exceeded = true;
                break;
            }
            hash.update(chunk);
            if (!file.write(chunk)) {
                await once(file, 'drain');
            }
        }
    } finally {
        file.end();
        await finished(file);
    }
    if (exceeded) {
        await rm(path, { force: true });
        const problem = tooLarge(maxSize);
        problem.headers['connection'] = 'close';
        throw problem;
    }
    return { path, size, sha256: hash.digest('hex') };
}

function integerHeader(request: FastifyRequest, name: string): number | undefined {
    const value = request.headers[name];
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        return undefined;
    }
    return Number(value);
}

function uploadIdOf(params: unknown): string {
    return (params as { id: string }).id;
}

/**
 * `/v1/uploads`: files sent to the temporary storage (decision 0011), at once (raw body or
 * multipart) or resumable with tus 1.0.0. Bodies are streamed to disk, never buffered.
 */
export async function uploadRoutes(
    app: FastifyInstance,
    options: { services: Services },
): Promise<void> {
    const { uploads, limits } = options.services;

    // In this scope, bodies stay streams: an upload of a JSON file is still a file.
    app.removeAllContentTypeParsers();
    app.addContentTypeParser('*', (_request, _payload, done) => done(null));
    await app.register(multipart, { limits: { files: 1, fields: 10 } });

    app.post(
        '/uploads',
        { config: { scope: 'jobs:write' } },
        async (request, reply): Promise<Upload> => {
            const { project } = authOf(request);
            const query = request.query as { probe?: string };
            if (query.probe === 'true' || query.probe === '1') {
                throw problems.invalid(
                    { '': ['?probe=1 is not available yet'] },
                    'Probing an upload comes with the synchronous probe. Probe the upload with a job meanwhile.',
                );
            }

            const tus = request.headers['tus-resumable'];
            if (tus !== undefined) {
                if (tus !== TUS_VERSION) {
                    throw problems.invalid({ '': [`Tus-Resumable must be ${TUS_VERSION}`] });
                }
                const length = integerHeader(request, 'upload-length');
                if (length === undefined) {
                    throw problems.invalid({ '': ['Upload-Length must be a number of bytes'] });
                }
                const maxSize = project.settings.maxInputSize ?? limits.maxInputSize;
                if (length > maxSize) {
                    throw new HttpProblem(413, 'Content Too Large', {
                        detail: `The project's inputs are limited to ${maxSize} bytes.`,
                    });
                }
                // The tus body is empty; drain it in case a client sent one.
                request.raw.resume();
                const upload = await uploads.createResumable(project, length);
                return reply
                    .code(201)
                    .headers({ location: `/v1/uploads/${upload.id}`, 'tus-resumable': TUS_VERSION })
                    .send(toUploadResponse(upload));
            }

            const maxSize = project.settings.maxDirectUpload;
            const declared = integerHeader(request, 'content-length');
            if (declared !== undefined && request.isMultipart() === false && declared > maxSize) {
                throw tooLarge(maxSize);
            }
            let stream: Readable = request.raw;
            if (request.isMultipart()) {
                const file = await request.file();
                if (file === undefined) {
                    throw problems.invalid({ '': ['the multipart body has no file'] });
                }
                stream = file.file;
            }
            const spooled = await spool(stream, limits.tmpDir, maxSize);
            try {
                if (spooled.size === 0) {
                    throw problems.invalid({ '': ['the file is empty'] });
                }
                const upload = await uploads.createFromFile(
                    project,
                    spooled.path,
                    spooled.size,
                    spooled.sha256,
                );
                return reply
                    .code(201)
                    .headers({ location: `/v1/uploads/${upload.id}` })
                    .send(toUploadResponse(upload));
            } finally {
                await rm(spooled.path, { force: true });
            }
        },
    );

    // Before the GET route: Fastify would otherwise add a HEAD route that answers like GET.
    app.head('/uploads/:id', { config: { scope: 'jobs:write' } }, async (request, reply) => {
        const { project } = authOf(request);
        const upload = await uploads.get(project.id, uploadIdOf(request.params));
        return reply
            .code(200)
            .headers({
                'upload-offset': String(upload.received),
                ...(upload.size === undefined ? {} : { 'upload-length': String(upload.size) }),
                'tus-resumable': TUS_VERSION,
                'cache-control': 'no-store',
            })
            .send();
    });

    app.get(
        '/uploads/:id',
        { config: { scope: 'jobs:read' } },
        async (request): Promise<Upload> => {
            const { project } = authOf(request);
            return toUploadResponse(await uploads.get(project.id, uploadIdOf(request.params)));
        },
    );

    app.patch('/uploads/:id', { config: { scope: 'jobs:write' } }, async (request, reply) => {
        const { project } = authOf(request);
        const id = uploadIdOf(request.params);
        if (request.headers['content-type'] !== 'application/offset+octet-stream') {
            throw new HttpProblem(415, 'Unsupported Media Type', {
                detail: 'A tus PATCH has the content type application/offset+octet-stream.',
            });
        }
        const offset = integerHeader(request, 'upload-offset');
        if (offset === undefined) {
            throw problems.invalid({ '': ['Upload-Offset must be a number of bytes'] });
        }
        const upload = await uploads.get(project.id, id);
        const remaining = (upload.size ?? Number.MAX_SAFE_INTEGER) - offset;
        const spooled = await spool(request.raw, limits.tmpDir, Math.max(0, remaining));
        try {
            const updated = await uploads.append(project, id, offset, spooled.path, spooled.size);
            return reply
                .code(204)
                .headers({
                    'upload-offset': String(updated.received),
                    'tus-resumable': TUS_VERSION,
                })
                .send();
        } finally {
            await rm(spooled.path, { force: true });
        }
    });

    app.delete('/uploads/:id', { config: { scope: 'jobs:write' } }, async (request, reply) => {
        const { project } = authOf(request);
        await uploads.delete(project.id, uploadIdOf(request.params));
        return reply.code(204).send();
    });
}
