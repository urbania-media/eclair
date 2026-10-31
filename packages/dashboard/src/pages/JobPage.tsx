import { PageHeader, PageLayout } from '@panneau/app';
import { queryKeys, useDataAdapter } from '@panneau/data/query';
import { Alert, Badge, Button, Card, Disclosure, Skeleton, Text } from '@panneau/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleOff, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-aria-components';
import { useIntl } from 'react-intl';

import type { Input, Task } from '@eclair-js/protocol';

import { BASE_PATH } from '../definition.ts';
import { formatBytes, formatDuration } from '../format.ts';
import { CopyButton } from '../project/ProjectKeys.tsx';
import { TONES } from '../tones.ts';
import type { JobData } from '../widgets.ts';
import { failedTask } from './OverviewPage.tsx';
import styles from './pages.module.css';

const ACTIVE = new Set(['pending', 'running']);
const STOPPED = new Set(['failed', 'canceled']);

function describeInput(input: Input | undefined): string {
    if (input === undefined) {
        return '—';
    }
    if ('url' in input) {
        return input.url;
    }
    if ('upload' in input) {
        return `upload:${input.upload}`;
    }
    return `${input.storage}:${input.path}`;
}

/**
 * A job: its request, its probed input, its tasks on a timeline and its webhooks, with cancel and
 * retry. A plugin page until Panneau has dashboard widgets (decision 0021). It refreshes itself
 * while the job runs.
 */
export function JobPage({ params }: { params: { id?: string } }) {
    const intl = useIntl();
    const adapter = useDataAdapter();
    const queryClient = useQueryClient();
    // The page's param: `{basePath}/pages/job/{id}`
    const id = params.id ?? null;
    const [pending, setPending] = useState<string | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const job = useQuery({
        queryKey: ['eclair', 'job', id],
        queryFn: ({ signal }) =>
            adapter.getWidgetData(`job?id=${encodeURIComponent(id ?? '')}`, {
                signal,
            }) as Promise<JobData>,
        enabled: id !== null,
        refetchInterval: (query) =>
            query.state.data !== undefined && ACTIVE.has(query.state.data.job.status)
                ? 3000
                : false,
    });
    const m = (key: string, values?: Record<string, string | number>) =>
        intl.formatMessage({ id: key }, values);
    const jobsHref = `${BASE_PATH}/resources/jobs`;
    const title = id ?? m('job.title');

    const run = async (action: 'cancel' | 'retry') => {
        if (id === null) {
            return;
        }
        setPending(action);
        setFailure(null);
        try {
            const { result } = await adapter.runAction('jobs', action, {
                selection: { ids: [id] },
            });
            const failed = result?.results?.[0];
            if (failed !== undefined) {
                setFailure(failed.message ?? '');
            }
            await Promise.all([
                job.refetch(),
                queryClient.invalidateQueries({ queryKey: queryKeys.resource('jobs') }),
            ]);
        } catch (error) {
            setFailure(error instanceof Error ? error.message : String(error));
        } finally {
            setPending(null);
        }
    };

    const back = { href: jobsHref, label: m('jobs.title') };
    let content;
    if (job.data === undefined) {
        content = (
            <>
                <PageHeader title={<code>{title}</code>} back={back} />
                {job.isError ? (
                    <Alert tone="danger">
                        <p>{m('job.loadError', { message: job.error.message })}</p>
                        <Button size="sm" onPress={() => void job.refetch()}>
                            {m('common.retry')}
                        </Button>
                    </Alert>
                ) : (
                    <>
                        <Skeleton height="8rem" />
                        <Skeleton height="16rem" />
                    </>
                )}
            </>
        );
    } else {
        content = (
            <JobDetails
                back={back}
                data={job.data}
                now={job.dataUpdatedAt || Date.now()}
                pending={pending}
                failure={failure}
                onAction={(action) => void run(action)}
            />
        );
    }

    return <PageLayout>{content}</PageLayout>;
}

function JobDetails({
    back,
    data: { job, deliveries },
    now,
    pending,
    failure,
    onAction,
}: {
    back: { href: string; label: string };
    data: JobData;
    now: number;
    pending: string | null;
    failure: string | null;
    onAction: (action: 'cancel' | 'retry') => void;
}) {
    const intl = useIntl();
    const m = (key: string, values?: Record<string, string | number>) =>
        intl.formatMessage({ id: key }, values);
    const time = (date: string | undefined) =>
        date !== undefined ? intl.formatTime(date, { timeStyle: 'medium' }) : '—';
    const failed = failedTask(job);
    const start = Date.parse(job.createdAt);
    const end = job.endedAt !== undefined ? Date.parse(job.endedAt) : now;
    const span = Math.max(1, end - start);
    const position = (date: string | undefined, fallback: number) =>
        ((date !== undefined ? Date.parse(date) : fallback) - start) / span;
    const tasks = Object.entries(job.tasks).sort(
        ([, a], [, b]) =>
            (a.startedAt !== undefined ? Date.parse(a.startedAt) : Infinity) -
            (b.startedAt !== undefined ? Date.parse(b.startedAt) : Infinity),
    );
    const probe = Object.values(job.tasks).find((task) => task.op.startsWith('probe@'))?.outputs
        ?.metadata as Record<string, unknown> | undefined;

    return (
        <>
            <PageHeader
                title={
                    <span className={styles.row}>
                        <code>{job.id}</code>
                        <Badge tone={TONES[job.status]}>{m(`jobs.statuses.${job.status}`)}</Badge>
                    </span>
                }
                back={back}
                actions={
                    <>
                        <CopyButton text={JSON.stringify(job, null, 2)} />
                        <Button
                            size="sm"
                            icon={CircleOff}
                            tone="danger"
                            isDisabled={!ACTIVE.has(job.status)}
                            isPending={pending === 'cancel'}
                            onPress={() => onAction('cancel')}
                        >
                            {m('jobs.actions.cancel')}
                        </Button>
                        <Button
                            size="sm"
                            variant="primary"
                            icon={RotateCcw}
                            isDisabled={!STOPPED.has(job.status)}
                            isPending={pending === 'retry'}
                            onPress={() => onAction('retry')}
                        >
                            {m('job.retry')}
                        </Button>
                    </>
                }
            />

            {failure !== null ? <Alert tone="danger">{failure}</Alert> : null}
            {failed !== null ? (
                <Alert
                    tone="danger"
                    title={`${failed[0]} : ${failed[1].error?.code ?? m('jobs.statuses.failed')}`}
                >
                    {failed[1].error?.message}
                </Alert>
            ) : null}

            <div className={styles.cards}>
                <Card title={m('job.request')} headingLevel={2}>
                    <dl className={styles.details}>
                        <dt>{m('jobs.fields.project')}</dt>
                        <dd>
                            <Link
                                href={`${BASE_PATH}/resources/projects/${encodeURIComponent(job.project)}/edit`}
                                className={styles.link}
                            >
                                {job.project}
                            </Link>
                        </dd>
                        <dt>{m('job.preset')}</dt>
                        <dd>
                            {job.preset !== undefined ? (
                                <code>
                                    {job.preset.name} v{job.preset.version}
                                </code>
                            ) : (
                                '—'
                            )}
                        </dd>
                        <dt>{m('job.input')}</dt>
                        <dd>
                            <code>{describeInput(job.input)}</code>
                        </dd>
                        <dt>{m('job.output')}</dt>
                        <dd>
                            {job.output !== undefined ? (
                                <code>
                                    {job.output.storage}:{job.output.prefix ?? ''}
                                </code>
                            ) : (
                                '—'
                            )}
                        </dd>
                        <dt>{m('job.priority')}</dt>
                        <dd>{job.priority !== undefined ? m(`priority.${job.priority}`) : '—'}</dd>
                        <dt>{m('jobs.fields.metadata')}</dt>
                        <dd>
                            {job.metadata !== undefined ? (
                                <code>{JSON.stringify(job.metadata)}</code>
                            ) : (
                                '—'
                            )}
                        </dd>
                    </dl>
                </Card>
                <Card title={m('job.probed')} headingLevel={2}>
                    {probe === undefined ? (
                        <Text as="p" muted>
                            {m('job.notProbed')}
                        </Text>
                    ) : (
                        <dl className={styles.details}>
                            <dt>{m('job.kind')}</dt>
                            <dd>
                                {String(probe.kind)} · {String(probe.mime)}
                            </dd>
                            {typeof probe.size === 'number' ? (
                                <>
                                    <dt>{m('job.size')}</dt>
                                    <dd>{formatBytes(intl, probe.size)}</dd>
                                </>
                            ) : null}
                            {typeof probe.duration === 'number' ? (
                                <>
                                    <dt>{m('job.duration')}</dt>
                                    <dd>{formatDuration(intl, probe.duration * 1000)}</dd>
                                </>
                            ) : null}
                            {typeof probe.width === 'number' ? (
                                <>
                                    <dt>{m('job.image')}</dt>
                                    <dd>
                                        {[
                                            `${String(probe.width)} × ${String(probe.height)}`,
                                            typeof probe.frameRate === 'number'
                                                ? `${intl.formatNumber(probe.frameRate, { maximumFractionDigits: 2 })} fps`
                                                : null,
                                            typeof probe.videoCodec === 'string'
                                                ? probe.videoCodec
                                                : null,
                                        ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </dd>
                                </>
                            ) : null}
                            {typeof probe.audioCodec === 'string' ? (
                                <>
                                    <dt>{m('job.audio')}</dt>
                                    <dd>
                                        {[probe.audioCodec, probe.channels]
                                            .filter((value) => value !== undefined)
                                            .map(String)
                                            .join(' · ')}
                                    </dd>
                                </>
                            ) : null}
                        </dl>
                    )}
                </Card>
                <Card title={m('job.timeline')} headingLevel={2}>
                    <dl className={styles.details}>
                        <dt>{m('job.created')}</dt>
                        <dd>
                            {intl.formatDate(job.createdAt, {
                                dateStyle: 'medium',
                                timeStyle: 'medium',
                            })}
                        </dd>
                        <dt>{m('job.started')}</dt>
                        <dd>
                            {time(job.startedAt)}
                            {job.startedAt !== undefined
                                ? ` (${m('job.waited', {
                                      duration: formatDuration(
                                          intl,
                                          Date.parse(job.startedAt) - start,
                                      ),
                                  })})`
                                : ''}
                        </dd>
                        <dt>{m('job.ended')}</dt>
                        <dd>{time(job.endedAt)}</dd>
                        <dt>{m('job.duration')}</dt>
                        <dd>
                            {job.startedAt !== undefined
                                ? formatDuration(intl, end - Date.parse(job.startedAt))
                                : '—'}
                        </dd>
                    </dl>
                </Card>
            </div>

            <Card title={m('job.tasks')} headingLevel={2}>
                <Text as="p" size="sm" muted>
                    {m('job.tasksHelp')}
                </Text>
                <div className={styles.tableBox}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col">{m('job.task')}</th>
                                <th scope="col">{m('jobs.fields.status')}</th>
                                <th scope="col" className={styles.timelineColumn}>
                                    0 — {formatDuration(intl, span)}
                                </th>
                                <th scope="col" className={styles.end}>
                                    {m('job.duration')}
                                </th>
                                <th scope="col">{m('job.files')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tasks.map(([name, task]) => (
                                <TaskRow
                                    key={name}
                                    name={name}
                                    task={task}
                                    position={position}
                                    now={now}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            <div className={styles.columns}>
                <Card title={m('job.webhooks')} headingLevel={2}>
                    {deliveries.length === 0 ? (
                        <Text as="p" muted>
                            {m('job.noWebhooks')}
                        </Text>
                    ) : (
                        <ul className={styles.plainList}>
                            {deliveries.map((delivery) => (
                                <li key={delivery.id} className={styles.row}>
                                    <span>
                                        <code>{delivery.event}</code>
                                        {delivery.task !== null ? (
                                            <Text size="sm" muted>
                                                {' '}
                                                {delivery.task}
                                            </Text>
                                        ) : null}
                                    </span>
                                    <Text size="sm" tone={TONES[delivery.status]}>
                                        {delivery.status === 'pending' &&
                                        delivery.nextAttemptAt !== null
                                            ? m('job.nextAttempt', {
                                                  time: time(delivery.nextAttemptAt),
                                                  status: delivery.responseStatus ?? '—',
                                                  attempts: delivery.attempts,
                                              })
                                            : m(`job.delivery.${delivery.status}`, {
                                                  status: delivery.responseStatus ?? '—',
                                                  attempts: delivery.attempts,
                                              })}
                                    </Text>
                                    <Text size="sm" muted>
                                        {time(delivery.deliveredAt ?? delivery.createdAt)}
                                    </Text>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
                <Card title={m('job.response')} headingLevel={2}>
                    <Disclosure title={m('job.showJson')}>
                        <pre className={styles.json}>{JSON.stringify(job, null, 2)}</pre>
                    </Disclosure>
                </Card>
            </div>
        </>
    );
}

function TaskRow({
    name,
    task,
    position,
    now,
}: {
    name: string;
    task: Task;
    position: (date: string | undefined, fallback: number) => number;
    now: number;
}) {
    const intl = useIntl();
    const percent = (value: number) => `${Math.max(0, Math.min(100, value * 100))}%`;
    const ran = task.startedAt !== undefined;
    const runStart = position(task.startedAt, now);
    const runEnd = position(task.endedAt, now);
    const files = task.outputs?.files ?? [];
    return (
        <tr>
            <th scope="row">
                <span className={styles.taskName}>{name}</span>
                <code className={styles.taskOp}>{task.op}</code>
            </th>
            <td>
                <Badge tone={TONES[task.status]}>
                    {intl.formatMessage({ id: `job.taskStatuses.${task.status}` })}
                </Badge>
            </td>
            <td>
                <span className={styles.timeline} aria-hidden="true">
                    {ran ? (
                        <>
                            <span
                                className={styles.wait}
                                style={{ left: 0, width: percent(runStart) }}
                            />
                            <span
                                className={task.status === 'failed' ? styles.runFailed : styles.run}
                                style={{
                                    left: percent(runStart),
                                    width: percent(Math.max(0.006, runEnd - runStart)),
                                }}
                            />
                        </>
                    ) : null}
                </span>
            </td>
            <td className={styles.end}>
                {ran
                    ? formatDuration(
                          intl,
                          (task.endedAt !== undefined ? Date.parse(task.endedAt) : now) -
                              Date.parse(task.startedAt ?? ''),
                      )
                    : '—'}
            </td>
            <td>
                {files.length > 0 ? (
                    <code className={styles.taskOp}>
                        {files
                            .slice(0, 3)
                            .map((file) => file.name)
                            .join(', ')}
                        {files.length > 3 ? ` … +${files.length - 3}` : ''}
                    </code>
                ) : (
                    '—'
                )}
            </td>
        </tr>
    );
}
