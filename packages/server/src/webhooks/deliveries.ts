import type { WebhookDelivery, WebhookEvent } from '@eclair-js/protocol';

import type { Database } from '../database/connection.ts';
import { readDate, readOptionalDate } from '../database/values.ts';

/** Every recorded webhook of a job, newest first (`GET /admin/v1/jobs/{id}/deliveries`). */
export async function listDeliveries(
    database: Database,
    jobId: string,
): Promise<WebhookDelivery[]> {
    const rows = await database.kysely
        .selectFrom('webhook_deliveries')
        .selectAll()
        .where('job_id', '=', jobId)
        .orderBy('id', 'desc')
        .execute();
    return rows.map((row) => ({
        id: row.id,
        event: row.event as WebhookEvent,
        task: row.task,
        url: row.url,
        status: row.status as WebhookDelivery['status'],
        attempts: row.attempts,
        responseStatus: row.response_status,
        nextAttemptAt: readOptionalDate(row.next_attempt_at)?.toISOString() ?? null,
        deliveredAt: readOptionalDate(row.delivered_at)?.toISOString() ?? null,
        createdAt: readDate(row.created_at).toISOString(),
    }));
}
