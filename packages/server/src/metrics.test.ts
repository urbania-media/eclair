import { describe, expect, it } from 'vitest';

import { buildApp } from './http/app.ts';
import { Metrics } from './metrics.ts';

describe('Metrics', () => {
    it('are served on /metrics for Prometheus', async () => {
        const metrics = new Metrics();
        metrics.tasks.inc({ operation: 'probe@1', outcome: 'completed' });
        metrics.taskDuration.observe({ operation: 'probe@1' }, 0.2);
        metrics.webhooks.inc({ outcome: 'delivered' });
        const app = buildApp({ version: 'test', metrics });
        const response = await app.inject({ method: 'GET', url: '/metrics' });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/plain');
        expect(response.body).toContain(
            'eclair_tasks_total{operation="probe@1",outcome="completed"} 1',
        );
        expect(response.body).toContain(
            'eclair_task_duration_seconds_bucket{le="0.5",operation="probe@1"} 1',
        );
        expect(response.body).toContain('eclair_webhook_deliveries_total{outcome="delivered"} 1');
        expect(response.body).toContain('eclair_process_cpu_seconds_total');
        await app.close();
    });
});
