import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

import { toProblemErrors, validate } from '@eclair-js/protocol';
import type { Input, ProbeResult, Upload } from '@eclair-js/protocol';

import type { Project } from '../../projects/projects.ts';
import type { Services } from '../../services.ts';
import { toUploadResponse } from '../../uploads/uploads.ts';
import type { UploadRecord } from '../../uploads/uploads.ts';
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

function flag(value: unknown): boolean {
    return value === 'true' || value === '1';
}

/** The `timeout` of a probe, from 1 to 30 seconds, 10 by default. */
function probeTimeout(value: unknown): number {
    if (value === undefined) {
        return 10;
    }
    const timeout = Number(value);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30) {
        throw problems.invalid(
            { '?timeout': ['must be an integer from 1 to 30'] },
            'The query is invalid.',
        );
    }
    return timeout;
}

/** Reads a small JSON body, without a parser in this scope. */
async function readJsonBody(stream: Readable, maxSize = 64 * 1024): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > maxSize) {
            throw new HttpProblem(413, 'Content Too Large', {
                detail: `A JSON body is at most ${maxSize} bytes.`,
            });
        }
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
        throw new HttpProblem(400, 'Bad Request', { detail: 'The body is not valid JSON.' });
    }
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
    const { uploads, limits, probes } = options.services;

    // In this scope, bodies stay streams: an upload of a JSON file is still a file.
    app.removeAllContentTypeParsers();
    app.addContentTypeParser('*', (_request, _payload, done) => done(null));
    await app.register(multipart, { limits: { files: 1, fields: 10 } });

    /** Stores the file of a raw or multipart body as an upload of the project. */
    const storeBody = async (request: FastifyRequest, project: Project): Promise<UploadRecord> => {
        const maxSize = project.settings.maxDirectUpload;
        const declared = integerHeader(request, 'content-length');
        if (declared !== undefined && !request.isMultipart() && declared > maxSize) {
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
            return await uploads.createFromFile(
                project,
                spooled.path,
                spooled.size,
                spooled.sha256,
            );
        } finally {
            await rm(spooled.path, { force: true });
        }
    };

    /** Runs a synchronous probe, or explains why it can't. */
    const runProbe = (
        project: Project,
        input: Input,
        options: { timeout: number; checksum: boolean; thumbhash?: boolean },
    ) => {
        if (probes === undefined) {
            throw new HttpProblem(503, 'Service Unavailable', {
                detail: 'This server has no job queue.',
            });
        }
        return probes.probe(project, input, options);
    };

    // POST /v1/probe: metadata in the response (decision 0012).
    app.post('/probe', { config: { scope: 'jobs:write' } }, async (request, reply) => {
        const { project } = authOf(request);
        const query = request.query as Record<string, unknown>;
        let input: Input;
        let timeout: number;
        let checksum: boolean;
        let thumbhash: boolean;
        if (request.headers['content-type']?.split(';')[0]?.trim() === 'application/json') {
            const result = validate('ProbeRequest', await readJsonBody(request.raw));
            if (!result.valid) {
                throw problems.invalid(
                    toProblemErrors(result.errors),
                    'The request body is invalid.',
                );
            }
            input = result.value.input;
            timeout = result.value.timeout ?? 10;
            checksum = result.value.checksum ?? false;
            thumbhash = result.value.thumbhash ?? false;
        } else {
            timeout = probeTimeout(query['timeout']);
            checksum = flag(query['checksum']);
            thumbhash = flag(query['thumbhash']);
            input = { upload: (await storeBody(request, project)).id };
        }

        const outcome = await runProbe(project, input, { timeout, checksum, thumbhash });
        if (outcome.status === 'completed') {
            return reply.code(200).send({ metadata: outcome.metadata } satisfies ProbeResult);
        }
        if (outcome.status === 'failed') {
            throw problems.invalid({ '': [outcome.error.message] }, outcome.error.message);
        }
        return reply.code(202).header('location', `/v1/jobs/${outcome.job.id}`).send(outcome.job);
    });

    app.post(
        '/uploads',
        { config: { scope: 'jobs:write' } },
        async (request, reply): Promise<Upload> => {
            const { project } = authOf(request);
            const query = request.query as Record<string, unknown>;
            const probe = flag(query['probe']);

            const tus = request.headers['tus-resumable'];
            if (tus !== undefined) {
                if (probe) {
                    throw problems.invalid(
                        { '?probe': ['is not for resumable uploads'] },
                        'Probe a resumable upload once it is complete, with POST /v1/probe.',
                    );
                }
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

            let upload = await storeBody(request, project);
            if (probe) {
                const outcome = await runProbe(
                    project,
                    { upload: upload.id },
                    { timeout: probeTimeout(query['timeout']), checksum: flag(query['checksum']) },
                );
                if (outcome.status === 'completed') {
                    upload = await uploads.setMetadata(project.id, upload.id, outcome.metadata);
                }
            }
            return reply
                .code(201)
                .headers({ location: `/v1/uploads/${upload.id}` })
                .send(toUploadResponse(upload));
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
