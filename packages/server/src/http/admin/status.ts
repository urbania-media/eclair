import type { FastifyInstance } from 'fastify';

import { CAPABILITIES } from '@eclair-js/operation';
import type * as protocol from '@eclair-js/protocol';

import { readOptionalDate } from '../../database/values.ts';
import type { HostRegistry, LiveHost } from '../../hosts.ts';
import type { TaskQueues } from '../../jobs/queues.ts';
import type { Services } from '../../services.ts';
import { runChecks } from '../checks.ts';
import type { ReadinessCheck } from '../checks.ts';

export interface StatusOptions {
    version: string;
    checks: readonly ReadinessCheck[];
    checkTimeout: number;
    hosts?: HostRegistry | undefined;
    queues?: TaskQueues | undefined;
}

/**
 * `GET /admin/v1/status`: the checks of `/ready`, the live hosts and their queues, each queue's
 * tasks and slots, and the temporary storage. What Redis can't answer is left out, so that the
 * status still says which check fails.
 */
export function statusRoute(
    app: FastifyInstance,
    services: Services,
    options: StatusOptions,
): void {
    app.get('/status', async (request): Promise<protocol.ServerStatus> => {
        const [readiness, hosts, counts, oldest, tempStorage] = await Promise.all([
            runChecks(options.checks, options.checkTimeout, request.log),
            options.hosts?.describe().catch((): LiveHost[] => []) ?? [],
            options.queues?.counts().catch(() => ({})) ?? {},
            // When the oldest queued task of each queue was queued: the database knows, BullMQ
            // sorts its waiting tasks by priority.
            services.database.kysely
                .selectFrom('tasks')
                .select((eb) => ['queue', eb.fn.min('queued_at').as('oldest')])
                .where('status', '=', 'queued')
                .groupBy('queue')
                .execute(),
            services.resolver.temporary.size().catch(() => undefined),
        ]);

        const queues = CAPABILITIES.map((name) => {
            const count =
                (counts as Record<string, Record<string, number> | undefined>)[name] ?? {};
            const queued = oldest.find((row) => row.queue === name)?.oldest;
            return {
                name,
                waiting:
                    (count['waiting'] ?? 0) + (count['prioritized'] ?? 0) + (count['delayed'] ?? 0),
                active: count['active'] ?? 0,
                slots: hosts.reduce(
                    (sum, host) =>
                        sum +
                        host.queues
                            .filter((queue) => queue.name === name)
                            .reduce((total, queue) => total + queue.concurrency, 0),
                    0,
                ),
                oldestWaitingAt: readOptionalDate(queued)?.toISOString() ?? null,
            };
        });

        return {
            version: options.version,
            ready: readiness.ready,
            checks: readiness.checks,
            hosts: hosts.map((host) => ({
                name: host.name,
                ...(host.version === undefined ? {} : { version: host.version }),
                queues: host.queues,
                seenAt: host.seenAt.toISOString(),
            })),
            queues,
            ...(tempStorage === undefined ? {} : { tempStorage }),
        };
    });
}
