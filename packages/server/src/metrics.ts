import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

import type { TaskQueues } from './jobs/queues.ts';

/**
 * Prometheus metrics of a process, on `/metrics` (see `docs/deployment.md`). No label names a
 * project: usage per project comes from the database (`eclair usage`).
 */
export class Metrics {
    readonly registry = new Registry();

    readonly tasks = new Counter({
        name: 'eclair_tasks_total',
        help: 'Tasks that ended on this worker, by operation and outcome.',
        labelNames: ['operation', 'outcome'],
        registers: [this.registry],
    });

    readonly taskDuration = new Histogram({
        name: 'eclair_task_duration_seconds',
        help: 'How long tasks ran on this worker, by operation.',
        labelNames: ['operation'],
        buckets: [0.1, 0.5, 1, 5, 15, 60, 300, 900, 3600],
        registers: [this.registry],
    });

    readonly jobs = new Counter({
        name: 'eclair_jobs_created_total',
        help: 'Jobs created through this process.',
        registers: [this.registry],
    });

    readonly webhooks = new Counter({
        name: 'eclair_webhook_deliveries_total',
        help: 'Webhook attempts from this process, by outcome.',
        labelNames: ['outcome'],
        registers: [this.registry],
    });

    constructor(queues?: TaskQueues) {
        collectDefaultMetrics({ register: this.registry, prefix: 'eclair_' });
        if (queues !== undefined) {
            new Gauge({
                name: 'eclair_queue_tasks',
                help: 'Tasks in each queue, by state.',
                labelNames: ['queue', 'state'],
                registers: [this.registry],
                async collect() {
                    for (const [queue, counts] of Object.entries(await queues.counts())) {
                        for (const [state, count] of Object.entries(counts)) {
                            this.set({ queue, state }, count);
                        }
                    }
                },
            });
        }
    }
}
