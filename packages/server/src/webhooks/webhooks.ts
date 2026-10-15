import { Queue, UnrecoverableError, Worker } from 'bullmq';
import type { Job as BullJob } from 'bullmq';
import type { Redis } from 'ioredis';

import type { WebhookEvent } from '@eclair-js/protocol';

import type { Database } from '../database/connection.ts';
import { readDate } from '../database/values.ts';
import { createId } from '../ids.ts';
import type { Jobs } from '../jobs/jobs.ts';
import type { JobRecord } from '../jobs/records.ts';
import { guardedRequest } from '../net/ssrf.ts';
import type { GuardOptions } from '../net/ssrf.ts';
import type { Projects } from '../projects/projects.ts';
import { REDIS_PREFIX } from '../redis.ts';
import { signWebhook } from '../storages/signing.ts';
import type { RunnerLogger } from '../workers/runner.ts';

/** The queue of webhook deliveries, served by the processes that run the API. */
export const WEBHOOK_QUEUE = 'webhooks';

/** How long a delivery is retried (see the protocol). */
export const DELIVERY_WINDOW = 24 * 3_600_000;

/** Milliseconds before the next attempt: 30 s, doubling, at most an hour. */
export function deliveryBackoff(attemptsMade: number): number {
    return Math.min(30_000 * 2 ** Math.max(0, attemptsMade - 1), 3_600_000);
}

interface DeliveryMessage {
    deliveryId: string;
}

export interface WebhooksOptions {
    database: Database;
    projects: Projects;
    connection: Redis;
    logger: RunnerLogger;
    /** Only for tests, to reach a local receiver. */
    guard?: Pick<GuardOptions, 'allowHttp' | 'allowPrivateAddresses'>;
    /** Only for tests: the backoff between attempts. */
    backoff?: (attemptsMade: number) => number;
}

/**
 * Webhooks: a signed `POST` of the job to its webhook URL when it ends, or when a task completes
 * for projects that ask (see the protocol). Deliveries go through the SSRF guard, are recorded in
 * `webhook_deliveries`, and are retried with backoff for 24 hours.
 */
export class Webhooks {
    readonly #options: WebhooksOptions;
    readonly #queue: Queue<DeliveryMessage>;
    #jobs: Jobs | undefined;
    #worker: Worker<DeliveryMessage> | undefined;

    constructor(options: WebhooksOptions) {
        this.#options = options;
        this.#queue = new Queue<DeliveryMessage>(WEBHOOK_QUEUE, {
            connection: options.connection,
            prefix: REDIS_PREFIX,
        });
    }

    /** The jobs, to send them as they are when the webhook leaves. */
    setJobs(jobs: Jobs): void {
        this.#jobs = jobs;
    }

    /** Records a delivery and queues it. Does nothing for a job without a webhook URL. */
    async send(job: JobRecord, event: WebhookEvent): Promise<void> {
        if (job.webhookUrl === undefined) {
            return;
        }
        const id = createId('delivery');
        const now = new Date();
        await this.#options.database.kysely
            .insertInto('webhook_deliveries')
            .values({
                id,
                project_id: job.projectId,
                job_id: job.id,
                event,
                url: job.webhookUrl,
                status: 'pending',
                attempts: 0,
                next_attempt_at: now,
                created_at: now,
                updated_at: now,
            })
            .execute();
        await this.#queue.add(
            'deliver',
            { deliveryId: id },
            {
                jobId: id,
                // Enough attempts for the 24-hour window; past it, the delivery gives up.
                attempts: 40,
                backoff: { type: 'eclair' },
                removeOnComplete: true,
                removeOnFail: true,
            },
        );
    }

    /** Sends one delivery. Throws to have BullMQ try again later. */
    async deliver(deliveryId: string): Promise<void> {
        const { database, projects, logger } = this.#options;
        const delivery = await database.kysely
            .selectFrom('webhook_deliveries')
            .selectAll()
            .where('id', '=', deliveryId)
            .executeTakeFirst();
        if (delivery === undefined || delivery.status !== 'pending') {
            return;
        }
        if (this.#jobs === undefined) {
            throw new Error('The webhooks have no jobs to send.');
        }
        const body = JSON.stringify(await this.#jobs.get(delivery.project_id, delivery.job_id));
        const secret = await projects.webhookSecret(delivery.project_id);
        const attempts = delivery.attempts + 1;

        let status: number | undefined;
        try {
            const response = await guardedRequest(delivery.url, {
                ...this.#options.guard,
                method: 'POST',
                body,
                headers: {
                    'content-type': 'application/json',
                    'user-agent': 'Eclair',
                    'eclair-event': delivery.event,
                    'eclair-delivery': delivery.id,
                    'eclair-signature': signWebhook(secret, body),
                },
                headersTimeout: 10_000,
                bodyTimeout: 10_000,
            });
            status = response.statusCode;
            await response.body.dump();
        } catch (error) {
            logger.warn(
                { delivery: delivery.id, error: (error as Error).message },
                'Webhook not delivered',
            );
        }

        const now = new Date();
        const delivered = status !== undefined && status >= 200 && status < 300;
        const expired = now.getTime() - readDate(delivery.created_at).getTime() > DELIVERY_WINDOW;
        await database.kysely
            .updateTable('webhook_deliveries')
            .set({
                status: delivered ? 'delivered' : expired ? 'failed' : 'pending',
                attempts,
                response_status: status ?? null,
                delivered_at: delivered ? now : null,
                next_attempt_at:
                    delivered || expired ? null : new Date(now.getTime() + this.#backoff(attempts)),
                updated_at: now,
            })
            .where('id', '=', delivery.id)
            .execute();
        if (!delivered) {
            if (expired) {
                throw new UnrecoverableError(
                    `The webhook of ${delivery.job_id} was not delivered in 24 hours.`,
                );
            }
            throw new Error(`The webhook answered ${status ?? 'nothing'}.`);
        }
    }

    #backoff(attemptsMade: number): number {
        return (this.#options.backoff ?? deliveryBackoff)(attemptsMade);
    }

    /** Starts sending the queued deliveries, in a process that runs the API. */
    async start(concurrency = 10): Promise<void> {
        this.#worker = new Worker<DeliveryMessage>(
            WEBHOOK_QUEUE,
            (job: BullJob<DeliveryMessage>) => this.deliver(job.data.deliveryId),
            {
                connection: this.#options.connection,
                prefix: REDIS_PREFIX,
                concurrency,
                settings: {
                    backoffStrategy: (attemptsMade: number) => this.#backoff(attemptsMade),
                },
            },
        );
        this.#worker.on('error', (error) => {
            this.#options.logger.error({ err: error }, 'Webhook worker error');
        });
        await this.#worker.waitUntilReady();
    }

    async close(): Promise<void> {
        await this.#worker?.close();
        await this.#queue.close();
    }

    /** Empties the queue. Only for tests. */
    async obliterate(): Promise<void> {
        await this.#queue.obliterate({ force: true });
    }
}
