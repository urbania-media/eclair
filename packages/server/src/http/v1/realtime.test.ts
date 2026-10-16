import type { FastifyInstance } from 'fastify';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { validate } from '@eclair-js/protocol';
import type { JobEvent } from '@eclair-js/protocol';

import { BUILT_IN_PLUGINS, OperationRegistry } from '../../operations/registry.ts';
import type { Project } from '../../projects/projects.ts';
import { verifySignature } from '../../storages/signing.ts';
import { RUNS_WITH_REDIS, createTestServices } from '../../testing.ts';
import { CancelBus } from '../../workers/cancel.ts';
import { TaskRunner } from '../../workers/runner.ts';
import { ProjectSlots } from '../../workers/slots.ts';
import { TaskWorkers } from '../../workers/workers.ts';
import { buildApp } from '../app.ts';

let services: Awaited<ReturnType<typeof createTestServices>>;
let app: FastifyInstance;
let base: string;
let project: Project;
let token: string;
let workers: TaskWorkers | undefined;

// A webhook receiver that answers with the next status of `answers`, then 200.
const received: { headers: IncomingHttpHeaders; body: string }[] = [];
const answers: number[] = [];
let receiver: Server;
let hook: string;

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function auth() {
    return { authorization: `Bearer ${token}` };
}

async function until<T>(
    read: () => Promise<T>,
    done: (value: T) => boolean,
    timeout = 10_000,
): Promise<T> {
    const deadline = Date.now() + timeout;
    for (;;) {
        const value = await read();
        if (done(value)) {
            return value;
        }
        if (Date.now() > deadline) {
            throw new Error(`Still waiting after ${timeout} ms: ${JSON.stringify(value)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

/** Ends every task of a job as a worker would. */
async function completeJob(jobId: string) {
    await services.database.kysely
        .updateTable('tasks')
        .set({ status: 'completed', ended_at: new Date() })
        .where('job_id', '=', jobId)
        .execute();
    await services.scheduler?.advance(jobId);
}

describe.skipIf(!RUNS_WITH_REDIS)('webhooks, events and probes', () => {
    beforeAll(async () => {
        services = await createTestServices({
            operations: await OperationRegistry.load(BUILT_IN_PLUGINS),
            queues: true,
        });
        await services.webhooks?.obliterate();
        await services.webhooks?.start();
        project = (
            await services.projects.create({ slug: 'niche', settings: { taskWebhooks: false } })
        ).project;
        token = (await services.apiKeys.create('niche')).token;
        app = buildApp({ version: 'test', services });
        await app.listen({ port: 0, host: '127.0.0.1' });
        base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

        receiver = createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer) => chunks.push(chunk));
            request.on('end', () => {
                received.push({
                    headers: request.headers,
                    body: Buffer.concat(chunks).toString('utf8'),
                });
                response.writeHead(answers.shift() ?? 200).end();
            });
        });
        await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
        hook = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/eclair/webhook`;
    });

    afterAll(async () => {
        await workers?.close();
        await app?.close();
        await new Promise<void>((resolve) => receiver?.close(() => resolve()));
        await services?.close();
    });

    /** A probe job on a URL that never resolves: it stays queued, nothing runs it in these tests. */
    async function createJob() {
        const { job } = await (services.jobs as NonNullable<typeof services.jobs>).create(project, {
            input: { url: 'https://cdn.example.com/a.txt' },
            tasks: { probe: { op: 'probe' } },
        });
        // Webhook URLs are https: point this one at the local receiver directly.
        await services.database.kysely
            .updateTable('jobs')
            .set({ webhook_url: hook })
            .where('id', '=', job.id)
            .execute();
        return job;
    }

    describe('webhooks', () => {
        it('send the job, signed, when it ends', async () => {
            const job = await createJob();
            const before = received.length;
            await completeJob(job.id);
            await until(
                async () => received.length,
                (count) => count > before,
            );
            const delivery = received.at(-1);
            expect(delivery?.headers['eclair-event']).toBe('job.completed');
            expect(delivery?.headers['eclair-delivery']).toMatch(/^whd_/);
            expect(delivery?.headers['content-type']).toBe('application/json');
            const secret = await services.projects.webhookSecret(project.id);
            expect(
                verifySignature(
                    String(delivery?.headers['eclair-signature']),
                    secret,
                    delivery?.body ?? '',
                ),
            ).toBe(true);
            const body = JSON.parse(delivery?.body ?? '{}') as { id: string; status: string };
            expect(validate('Job', body).valid).toBe(true);
            expect(body).toMatchObject({ id: job.id, status: 'completed' });

            const rows = await until(
                () =>
                    services.database.kysely
                        .selectFrom('webhook_deliveries')
                        .selectAll()
                        .where('job_id', '=', job.id)
                        .execute(),
                (deliveries) => deliveries[0]?.status === 'delivered',
            );
            expect(rows[0]).toMatchObject({
                event: 'job.completed',
                attempts: 1,
                response_status: 200,
            });
        });

        it('are signed with both secrets during the grace period of a rotation', async () => {
            const before = await services.projects.webhookSecret(project.id);
            const { webhookSecret } = await services.projects.rotateWebhookSecret('niche');

            async function deliver() {
                const job = await createJob();
                const count = received.length;
                await completeJob(job.id);
                await until(
                    async () => received.length,
                    (length) => length > count,
                );
                const delivery = received.at(-1);
                const signature = String(delivery?.headers['eclair-signature']);
                return (secret: string) => verifySignature(signature, secret, delivery?.body ?? '');
            }

            // An application with either secret accepts the webhook.
            const during = await deliver();
            expect(during(webhookSecret)).toBe(true);
            expect(during(before)).toBe(true);
            expect(during('whsec_other')).toBe(false);

            const rotated = await services.projects.rotateWebhookSecret('niche', { grace: 0 });
            const after = await deliver();
            expect(after(rotated.webhookSecret)).toBe(true);
            expect(after(webhookSecret)).toBe(false);
            expect(after(before)).toBe(false);
        });

        it('retry until the receiver answers 2xx', async () => {
            const job = await createJob();
            answers.push(500, 503);
            await completeJob(job.id);
            const rows = await until(
                () =>
                    services.database.kysely
                        .selectFrom('webhook_deliveries')
                        .selectAll()
                        .where('job_id', '=', job.id)
                        .execute(),
                (deliveries) => deliveries[0]?.status === 'delivered',
            );
            expect(rows[0]).toMatchObject({ attempts: 3, response_status: 200 });
        });

        it('are not sent without a webhook URL', async () => {
            const { job } = await (services.jobs as NonNullable<typeof services.jobs>).create(
                project,
                {
                    input: { url: 'https://cdn.example.com/a.txt' },
                    tasks: { probe: { op: 'probe' } },
                },
            );
            await completeJob(job.id);
            const rows = await services.database.kysely
                .selectFrom('webhook_deliveries')
                .select('id')
                .where('job_id', '=', job.id)
                .execute();
            expect(rows).toEqual([]);
        });
    });

    describe('GET /v1/jobs/{id}/events', () => {
        it('streams the current statuses, then the changes, until the job ends', async () => {
            const job = await createJob();
            const response = await fetch(`${base}/v1/jobs/${job.id}/events`, { headers: auth() });
            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');

            const reader = (response.body as ReadableStream<Uint8Array>).getReader();
            const decoder = new TextDecoder();
            let text = '';
            const read = async () => {
                const { value, done } = await reader.read();
                text += decoder.decode(value ?? new Uint8Array());
                return done;
            };
            // The current statuses first.
            while (!text.includes('event: task.status')) {
                await read();
            }
            await completeJob(job.id);
            while (!(await read())) {
                // Until the server ends the stream.
            }
            const events = text
                .split('\n\n')
                .map((block) => /^data: (.*)$/m.exec(block)?.[1])
                .filter((data): data is string => data !== undefined)
                .map((data) => JSON.parse(data) as JobEvent);
            expect(events.every((event) => validate('JobEvent', event).valid)).toBe(true);
            expect(events[0]).toEqual({ type: 'job.status', job: job.id, status: 'pending' });
            expect(events[1]).toEqual({
                type: 'task.status',
                job: job.id,
                task: 'probe',
                status: 'queued',
            });
            expect(events.at(-1)).toEqual({ type: 'job.status', job: job.id, status: 'completed' });
        });

        it('ends at once for an ended job, and is a 404 for another project', async () => {
            const job = await createJob();
            await completeJob(job.id);
            const text = await fetch(`${base}/v1/jobs/${job.id}/events`, { headers: auth() }).then(
                (response) => response.text(),
            );
            expect(text).toContain('"status":"completed"');

            const other = (await services.projects.create({ slug: 'other' })).project;
            const otherToken = (await services.apiKeys.create(other.id)).token;
            const response = await fetch(`${base}/v1/jobs/${job.id}/events`, {
                headers: { authorization: `Bearer ${otherToken}` },
            });
            expect(response.status).toBe(404);
        });
    });

    describe('the synchronous probe', () => {
        it('answers 202 with the job when no worker answers in time', async () => {
            const response = await fetch(`${base}/v1/probe?timeout=1`, {
                method: 'POST',
                headers: { ...auth(), 'content-type': 'application/octet-stream' },
                body: 'nobody probes this',
            });
            expect(response.status).toBe(202);
            const job = (await response.json()) as { id: string };
            expect(response.headers.get('location')).toBe(`/v1/jobs/${job.id}`);
            expect(validate('Job', job).valid).toBe(true);
        });

        describe('with a worker', () => {
            beforeAll(async () => {
                if (
                    services.scheduler === undefined ||
                    services.operations === undefined ||
                    services.redis === undefined
                ) {
                    throw new Error('No scheduler.');
                }
                const cancel = new CancelBus(services.redis);
                workers = new TaskWorkers({
                    connection: services.redis,
                    queues: [{ name: 'probe', concurrency: 2 }],
                    runner: new TaskRunner({
                        database: services.database,
                        scheduler: services.scheduler,
                        operations: services.operations,
                        projects: services.projects,
                        resolver: services.resolver,
                        uploads: services.uploads,
                        config: {
                            binaries: {} as never,
                            tmpDir: services.limits.tmpDir,
                            taskTimeout: 60_000,
                            maxInputSize: 1024 ** 2,
                            tempRetention: 3_600_000,
                            tempMaxRetention: 7_200_000,
                        },
                        worker: 'test-probe-worker',
                        logger: silent,
                    }),
                    slots: new ProjectSlots(services.redis),
                    cancel,
                    projects: services.projects,
                    logger: silent,
                });
                await workers.start();
            });

            it('answers with the metadata of a file in the body', async () => {
                const response = await fetch(`${base}/v1/probe?checksum=1`, {
                    method: 'POST',
                    headers: { ...auth(), 'content-type': 'application/octet-stream' },
                    body: 'plain text',
                });
                expect(response.status).toBe(200);
                const result = await response.json();
                expect(validate('ProbeResult', result).valid).toBe(true);
                expect(result).toEqual({
                    metadata: {
                        kind: 'other',
                        mime: 'application/octet-stream',
                        size: 10,
                        checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
                    },
                });
            });

            it('takes an input as JSON, and refuses an invalid one', async () => {
                const upload = (await fetch(`${base}/v1/uploads?probe=1`, {
                    method: 'POST',
                    headers: { ...auth(), 'content-type': 'application/octet-stream' },
                    body: 'uploaded first',
                }).then((response) => response.json())) as { id: string; metadata?: unknown };
                expect(upload.metadata).toEqual({
                    kind: 'other',
                    mime: 'application/octet-stream',
                    size: 14,
                });

                const response = await fetch(`${base}/v1/probe`, {
                    method: 'POST',
                    headers: { ...auth(), 'content-type': 'application/json' },
                    body: JSON.stringify({ input: { upload: upload.id }, timeout: 10 }),
                });
                expect(response.status).toBe(200);

                const invalid = await fetch(`${base}/v1/probe`, {
                    method: 'POST',
                    headers: { ...auth(), 'content-type': 'application/json' },
                    body: JSON.stringify({ input: { url: 'http://insecure.example.com/a' } }),
                });
                expect(invalid.status).toBe(422);
            });

            it("refuses probes past the project's limit, with Retry-After", async () => {
                const limited = (
                    await services.projects.create({
                        slug: 'limited',
                        settings: { probesPerMinute: 1 },
                    })
                ).project;
                const limitedToken = (await services.apiKeys.create(limited.id)).token;
                const probe = () =>
                    fetch(`${base}/v1/probe`, {
                        method: 'POST',
                        headers: {
                            authorization: `Bearer ${limitedToken}`,
                            'content-type': 'application/octet-stream',
                        },
                        body: 'x',
                    });
                const first = await probe();
                // The first may already be the second of this minute's window in a slow run: either way, the next is refused.
                expect([200, 429]).toContain(first.status);
                const second = await probe();
                expect(second.status).toBe(429);
                expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0);
            });
        });
    });
});
