import { useDataAdapter } from '@panneau/data/query';
import { Alert, Badge, Button, Card, Grid, Select, Skeleton, Text, chartColors } from '@panneau/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-aria-components';
import { useIntl } from 'react-intl';

import { BASE_PATH } from '../definition.ts';
import { TONES } from '../displays.tsx';
import { formatAgo, formatBytes, formatDuration } from '../format.ts';
import type { OverviewData } from '../widgets.ts';
import { PageLayout } from './PageLayout.tsx';
import styles from './pages.module.css';

const PERIODS = [24, 168, 720] as const;

/** The first failed task of a job, which made it fail: not one that failed because of another. */
export function failedTask(job: OverviewData['failures'][number]) {
    const failed = Object.entries(job.tasks).filter(([, task]) => task.status === 'failed');
    return failed.find(([, task]) => task.error?.code !== 'dependency_failed') ?? failed[0] ?? null;
}

/**
 * The overview, the dashboard's home: the server's health and queues now, and what it did over a
 * period. A plugin page until Panneau has dashboard widgets (decision 0021). It refreshes itself.
 */
export function OverviewPage() {
    const intl = useIntl();
    const adapter = useDataAdapter();
    const [hours, setHours] = useState<number>(24);
    const overview = useQuery({
        queryKey: ['eclair', 'overview', hours],
        queryFn: ({ signal }) =>
            adapter.getWidgetData(`overview?hours=${hours}`, { signal }) as Promise<OverviewData>,
        refetchInterval: 15_000,
    });
    const m = (id: string, values?: Record<string, string | number>) =>
        intl.formatMessage({ id }, values);
    const data = overview.data;
    const now = overview.dataUpdatedAt || Date.now();

    if (data === undefined) {
        return (
            <PageLayout title={m('overview.title')}>
                {overview.isError ? (
                    <Alert tone="danger">
                        <p>{m('overview.loadError', { message: overview.error.message })}</p>
                        <Button size="sm" onPress={() => void overview.refetch()}>
                            {m('common.retry')}
                        </Button>
                    </Alert>
                ) : (
                    <Grid minItemWidth="14rem" gap={4}>
                        {[0, 1, 2, 3].map((index) => (
                            <Skeleton key={index} height="6rem" />
                        ))}
                    </Grid>
                )}
            </PageLayout>
        );
    }

    const { status, stats, failures } = data;
    const ended = stats.tasks.reduce(
        (sum, interval) => sum + interval.completed + interval.failed,
        0,
    );
    const failed = stats.tasks.reduce((sum, interval) => sum + interval.failed, 0);
    const waiting = status.queues
        .filter((queue) => queue.oldestWaitingAt !== null)
        .map((queue) => ({ name: queue.name, since: Date.parse(queue.oldestWaitingAt ?? '') }))
        .sort((a, b) => a.since - b.since)[0];
    const unserved = status.queues.filter((queue) => queue.slots === 0).map(({ name }) => name);
    const temp = status.tempStorage;
    const failedChecks = Object.entries(status.checks)
        .filter(([, check]) => check === 'failed')
        .map(([name]) => name);
    const peak = Math.max(
        1,
        ...stats.tasks.map((interval) => interval.completed + interval.failed),
    );
    const peakInterval = stats.tasks.find(
        (interval) => interval.completed + interval.failed === peak,
    );
    const formatInterval = (start: string) =>
        stats.interval === 'hour'
            ? intl.formatTime(start, { hour: 'numeric' })
            : intl.formatDate(start, { day: 'numeric', month: 'short' });

    const kpis = [
        {
            label: m('overview.kpis.jobs'),
            value: intl.formatNumber(stats.jobs.created),
            detail: m('overview.kpis.jobsDetail', { tasks: intl.formatNumber(ended) }),
        },
        {
            label: m('overview.kpis.failures'),
            value: intl.formatNumber(ended > 0 ? failed / ended : 0, {
                style: 'percent',
                maximumFractionDigits: 1,
            }),
            detail: m('overview.kpis.failuresDetail', {
                failed: intl.formatNumber(failed),
                tasks: intl.formatNumber(ended),
            }),
            tone: failed > 0 ? ('danger' as const) : undefined,
        },
        {
            label: m('overview.kpis.wait'),
            value: waiting !== undefined ? formatDuration(intl, now - waiting.since) : '—',
            detail:
                waiting !== undefined
                    ? m('overview.kpis.waitDetail', { queue: waiting.name })
                    : m('overview.kpis.noWait'),
            tone: waiting !== undefined ? ('warning' as const) : undefined,
        },
        {
            label: m('overview.kpis.temp'),
            value: temp?.bytes !== undefined ? formatBytes(intl, temp.bytes) : '—',
            detail:
                temp === undefined
                    ? m('overview.kpis.tempUnknown')
                    : m(
                          temp.freeBytes !== undefined
                              ? 'overview.kpis.tempFree'
                              : 'overview.kpis.tempFiles',
                          {
                              files: intl.formatNumber(temp.files ?? 0),
                              free: formatBytes(intl, temp.freeBytes ?? 0),
                              kind: temp.kind,
                          },
                      ),
        },
    ];

    return (
        <PageLayout
            title={m('overview.title')}
            intro={m('overview.intro', {
                hosts: status.hosts.length,
                version: status.version,
                updated: formatAgo(intl, new Date(now), Date.now()),
            })}
            actions={
                <Badge tone={status.ready ? 'success' : 'danger'}>
                    {status.ready
                        ? m('overview.ready', { checks: Object.keys(status.checks).join(', ') })
                        : m('overview.notReady', { checks: failedChecks.join(', ') })}
                </Badge>
            }
        >
            <div className={styles.toolbar}>
                <Select
                    label={m('overview.period')}
                    options={PERIODS.map((value) => ({
                        value: String(value),
                        label: m(`overview.periods.${value}`),
                    }))}
                    value={String(hours)}
                    onChange={(value) => setHours(Number(value ?? 24))}
                />
            </div>

            <Grid as="dl" minItemWidth="14rem" gap={4} className={styles.kpis}>
                {kpis.map((kpi) => (
                    <div key={kpi.label} className={styles.kpi}>
                        <dt className={styles.kpiLabel}>{kpi.label}</dt>
                        <dd className={styles.kpiValue}>{kpi.value}</dd>
                        <dd>
                            <Text size="sm" tone={kpi.tone} muted={kpi.tone === undefined}>
                                {kpi.detail}
                            </Text>
                        </dd>
                    </div>
                ))}
            </Grid>

            <div className={styles.wideNarrow}>
                <Card title={m('overview.queues')} headingLevel={2}>
                    <div className={styles.tableBox}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th scope="col">{m('overview.columns.queue')}</th>
                                    <th scope="col" className={styles.end}>
                                        {m('overview.columns.waiting')}
                                    </th>
                                    <th scope="col" className={styles.end}>
                                        {m('overview.columns.active')}
                                    </th>
                                    <th scope="col" className={styles.end}>
                                        {m('overview.columns.slots')}
                                    </th>
                                    <th scope="col">{m('overview.columns.load')}</th>
                                    <th scope="col" className={styles.end}>
                                        {m('overview.columns.oldest')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {status.queues.map((queue) => (
                                    <tr key={queue.name}>
                                        <th scope="row">
                                            <code>{queue.name}</code>
                                        </th>
                                        <td className={styles.end}>{queue.waiting}</td>
                                        <td className={styles.end}>{queue.active}</td>
                                        <td className={styles.end}>{queue.slots}</td>
                                        <td>
                                            <span className={styles.meter} aria-hidden="true">
                                                <span
                                                    className={styles.meterFill}
                                                    style={{
                                                        width: `${queue.slots > 0 ? Math.min(100, (queue.active / queue.slots) * 100) : 0}%`,
                                                    }}
                                                />
                                            </span>
                                        </td>
                                        <td className={styles.end}>
                                            {queue.oldestWaitingAt !== null
                                                ? formatDuration(
                                                      intl,
                                                      now - Date.parse(queue.oldestWaitingAt),
                                                  )
                                                : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {unserved.length > 0 ? (
                        <Text as="p" size="sm" muted>
                            {m('overview.unserved', { queues: unserved.join(', ') })}
                        </Text>
                    ) : null}
                </Card>

                <Card title={m('overview.health')} headingLevel={2}>
                    <ul className={styles.plainList}>
                        {Object.entries(status.checks).map(([name, check]) => (
                            <li key={name} className={styles.row}>
                                <code>{name}</code>
                                <Badge tone={check === 'ok' ? 'success' : 'danger'}>
                                    {m(`overview.checks.${check}`)}
                                </Badge>
                            </li>
                        ))}
                        {status.hosts.map((host) => (
                            <li key={host.name} className={styles.row}>
                                <span>
                                    {host.name}
                                    <Text as="span" size="sm" muted>
                                        {' · '}
                                        {host.queues.length > 0
                                            ? host.queues
                                                  .map(
                                                      (queue) =>
                                                          `${queue.name}:${queue.concurrency}`,
                                                  )
                                                  .join(',')
                                            : m('overview.apiOnly')}
                                    </Text>
                                </span>
                                <Text size="sm" muted>
                                    {host.version ?? ''} · {formatAgo(intl, host.seenAt, now)}
                                </Text>
                            </li>
                        ))}
                    </ul>
                </Card>
            </div>

            <Card
                title={m(stats.interval === 'hour' ? 'overview.perHour' : 'overview.perDay')}
                headingLevel={2}
            >
                <figure style={{ margin: 0 }}>
                    <ul className={styles.legend}>
                        <li>
                            <span
                                className={styles.swatch}
                                style={{ background: chartColors.categorical(0) }}
                                aria-hidden="true"
                            />
                            {m('overview.completed')}
                        </li>
                        <li>
                            <span
                                className={styles.swatch}
                                style={{ background: 'var(--panneau-color-danger)' }}
                                aria-hidden="true"
                            />
                            {m('overview.failed')}
                        </li>
                        {peakInterval !== undefined && ended > 0 ? (
                            <li>
                                <Text size="sm" muted>
                                    {m('overview.peak', {
                                        tasks: intl.formatNumber(peak),
                                        when: formatInterval(peakInterval.start),
                                    })}
                                </Text>
                            </li>
                        ) : null}
                    </ul>
                    <div className={styles.chart} role="img" aria-label={m('overview.perHour')}>
                        {stats.tasks.map((interval) => (
                            <div
                                key={interval.start}
                                className={styles.bar}
                                title={`${formatInterval(interval.start)} · ${interval.completed} · ${interval.failed}`}
                            >
                                <div
                                    className={styles.segment}
                                    style={{
                                        height: `${(interval.completed / peak) * 100}%`,
                                        background: chartColors.categorical(0),
                                    }}
                                />
                                <div
                                    className={styles.segment}
                                    style={{
                                        height: `${(interval.failed / peak) * 100}%`,
                                        background: 'var(--panneau-color-danger)',
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                    <figcaption className={styles.axis}>
                        <span>
                            {stats.tasks[0] !== undefined
                                ? formatInterval(stats.tasks[0].start)
                                : ''}
                        </span>
                        <span>{m('overview.now')}</span>
                    </figcaption>
                </figure>
            </Card>

            <div className={styles.columns}>
                <Card title={m('overview.operations')} headingLevel={2}>
                    {stats.operations.length === 0 ? (
                        <Text as="p" muted>
                            {m('overview.noTasks')}
                        </Text>
                    ) : (
                        <div className={styles.tableBox}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th scope="col">{m('overview.columns.operation')}</th>
                                        <th scope="col" className={styles.end}>
                                            {m('overview.columns.tasks')}
                                        </th>
                                        <th scope="col" className={styles.end}>
                                            {m('overview.columns.failures')}
                                        </th>
                                        <th scope="col" className={styles.end}>
                                            {m('overview.columns.p50')}
                                        </th>
                                        <th scope="col" className={styles.end}>
                                            {m('overview.columns.p95')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stats.operations.map((operation) => (
                                        <tr key={operation.name}>
                                            <th scope="row">
                                                <code>{operation.name}</code>
                                            </th>
                                            <td className={styles.end}>
                                                {intl.formatNumber(
                                                    operation.completed + operation.failed,
                                                )}
                                            </td>
                                            <td
                                                className={`${styles.end} ${operation.failed > 0 ? styles.danger : ''}`}
                                            >
                                                {intl.formatNumber(operation.failed)}
                                            </td>
                                            <td className={styles.end}>
                                                {operation.p50 !== null
                                                    ? formatDuration(intl, operation.p50)
                                                    : '—'}
                                            </td>
                                            <td className={styles.end}>
                                                {operation.p95 !== null
                                                    ? formatDuration(intl, operation.p95)
                                                    : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>

                <Card
                    title={m('overview.failures')}
                    headingLevel={2}
                    actions={
                        <Link
                            href={`${BASE_PATH}/resources/jobs?filter[status][]=failed`}
                            className={styles.link}
                        >
                            {m('overview.allFailures')}
                        </Link>
                    }
                >
                    {failures.length === 0 ? (
                        <Text as="p" muted>
                            {m('overview.noFailures')}
                        </Text>
                    ) : (
                        <ul className={styles.plainList}>
                            {failures.map((job) => {
                                const [task, details] = failedTask(job) ?? [];
                                return (
                                    <li key={job.id} className={styles.failure}>
                                        <span className={styles.row}>
                                            <Link
                                                href={`${BASE_PATH}/pages/job?id=${encodeURIComponent(job.id)}`}
                                                className={styles.link}
                                            >
                                                <code>{job.id}</code>
                                            </Link>
                                            <Badge tone={TONES.failed}>
                                                {details?.error?.code ?? m('overview.failed')}
                                            </Badge>
                                            <Text size="sm" muted>
                                                {formatAgo(intl, job.endedAt ?? job.createdAt, now)}
                                            </Text>
                                        </span>
                                        <Text as="p" size="sm" muted>
                                            {[job.project, task, details?.error?.message]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </Text>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </Card>
            </div>

            <Card title={m('overview.webhooks')} headingLevel={2}>
                <dl className={styles.stats}>
                    <div>
                        <dt>{m('overview.delivered')}</dt>
                        <dd>{intl.formatNumber(stats.webhooks.delivered)}</dd>
                    </div>
                    <div>
                        <dt>{m('overview.retrying')}</dt>
                        <dd className={stats.webhooks.pending > 0 ? styles.warning : undefined}>
                            {intl.formatNumber(stats.webhooks.pending)}
                        </dd>
                    </div>
                    <div>
                        <dt>{m('overview.gaveUp')}</dt>
                        <dd className={stats.webhooks.failed > 0 ? styles.danger : undefined}>
                            {intl.formatNumber(stats.webhooks.failed)}
                        </dd>
                    </div>
                </dl>
            </Card>
        </PageLayout>
    );
}
