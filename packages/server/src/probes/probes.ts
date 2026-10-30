import type { Redis } from 'ioredis';

import type { Input, Job, ProbeMetadata, TaskError } from '@eclair-js/protocol';

import { RateLimitedError } from '../errors.ts';
import type { JobEvents } from '../jobs/events.ts';
import type { Jobs } from '../jobs/jobs.ts';
import type { Project } from '../projects/projects.ts';
import { REDIS_PREFIX } from '../redis.ts';

export type ProbeOutcome =
    | { status: 'completed'; metadata: ProbeMetadata; job: Job }
    | { status: 'failed'; error: TaskError; job: Job }
    | { status: 'pending'; job: Job };

const ENDED = ['completed', 'failed', 'canceled'];

/**
 * The synchronous probe (decision 0012): a job with one `probe` task, which the request waits for
 * up to a timeout. It runs on the `probe` queue, which every worker serves with reserved slots.
 */
export class Probes {
    readonly #jobs: Jobs;
    readonly #events: JobEvents;
    readonly #redis: Redis;

    constructor(jobs: Jobs, events: JobEvents, redis: Redis) {
        this.#jobs = jobs;
        this.#events = events;
        this.#redis = redis;
    }

    /** Counts a probe against the project's `probesPerMinute`. Throws a `RateLimitedError` past it. */
    async #count(project: Project): Promise<void> {
        const minute = Math.floor(Date.now() / 60_000);
        const key = `${REDIS_PREFIX}:probes:${project.id}:${minute}`;
        const count = await this.#redis.incr(key);
        if (count === 1) {
            await this.#redis.expire(key, 120);
        }
        if (count > project.settings.probesPerMinute) {
            const retryAfter = Math.ceil(((minute + 1) * 60_000 - Date.now()) / 1000);
            throw new RateLimitedError(
                `The project probes at most ${project.settings.probesPerMinute} files a minute.`,
                retryAfter,
            );
        }
    }

    /** Probes an input and waits for the result up to `timeout` seconds. */
    async probe(
        project: Project,
        input: Input,
        options: { timeout: number; checksum: boolean; thumbhash?: boolean },
    ): Promise<ProbeOutcome> {
        await this.#count(project);
        const { job: created } = await this.#jobs.create(project, {
            input,
            tasks: {
                probe: {
                    op: 'probe',
                    options: { checksum: options.checksum, thumbhash: options.thumbhash ?? false },
                },
            },
        });

        let resolveEnded: () => void = () => {};
        const ended = new Promise<void>((resolve) => {
            resolveEnded = resolve;
        });
        const unsubscribe = await this.#events.subscribe(created.id, (event) => {
            if (event.type === 'job.status' && ENDED.includes(event.status ?? '')) {
                resolveEnded();
            }
        });
        let timer: NodeJS.Timeout | undefined;
        try {
            // The job may have ended before the subscription.
            const current = await this.#jobs.get(project.id, created.id);
            if (!ENDED.includes(current.status)) {
                await Promise.race([
                    ended,
                    new Promise<void>((resolve) => {
                        timer = setTimeout(resolve, options.timeout * 1000);
                    }),
                ]);
            }
        } finally {
            clearTimeout(timer);
            await unsubscribe();
        }

        const job = await this.#jobs.get(project.id, created.id);
        const task = job.tasks['probe'];
        if (job.status === 'completed' && task?.outputs?.metadata !== undefined) {
            return { status: 'completed', metadata: task.outputs.metadata as ProbeMetadata, job };
        }
        if (job.status === 'failed' || job.status === 'canceled') {
            return {
                status: 'failed',
                error: task?.error ?? { code: 'operation_failed', message: 'The probe failed.' },
                job,
            };
        }
        return { status: 'pending', job };
    }
}
