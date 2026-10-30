import { useDataAdapter } from '@panneau/data/query';
import { Alert, Button, Card, NumberInput, Select, Skeleton, Text, chartColors } from '@panneau/ui';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';

import { formatHours } from '../displays.tsx';
import type { UsageData } from '../widgets.ts';
import { PageLayout } from './PageLayout.tsx';
import styles from './pages.module.css';
import {
    type Period,
    daysBack,
    periodDays,
    recentMonths,
    toCsv,
    totalsByProject,
} from './usage.ts';

const COST_KEY = 'eclair.serverCost';

function readCost(): number | null {
    try {
        const value = Number(localStorage.getItem(COST_KEY));
        return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
        return null;
    }
}

function writeCost(cost: number | null) {
    try {
        if (cost === null) {
            localStorage.removeItem(COST_KEY);
        } else {
            localStorage.setItem(COST_KEY, String(cost));
        }
    } catch {
        // A convenience only
    }
}

/**
 * Usage and costs: the task time of each project per day and over a period, and its share of the
 * server's monthly cost, which the operator types. A plugin page until Panneau has dashboard
 * widgets (decision 0021).
 */
export function UsagePage() {
    const intl = useIntl();
    const adapter = useDataAdapter();
    const [now] = useState(() => new Date());
    const [period, setPeriod] = useState<Period>('last30');
    const [cost, setCost] = useState<number | null>(readCost);
    const days = useMemo(() => periodDays(period, now), [period, now]);
    const back = daysBack(days, now);
    const usage = useQuery({
        queryKey: ['eclair', 'usage', back],
        queryFn: ({ signal }) =>
            adapter.getWidgetData(`usage?days=${back}`, { signal }) as Promise<UsageData>,
    });

    const m = (id: string, values?: Record<string, string | number>) =>
        intl.formatMessage({ id }, values);
    const formatBytes = (value: number) =>
        intl.formatNumber(value >= 1e9 ? value / 1e9 : value / 1e6, {
            style: 'unit',
            unit: value >= 1e9 ? 'gigabyte' : 'megabyte',
            maximumFractionDigits: 1,
        });
    const hours = (seconds: number) => formatHours(intl.formatNumber, seconds);

    const data = usage.data;
    const totals = data !== undefined ? totalsByProject(data.data, days) : [];
    const names = new Map(data?.projects.map((project) => [project.slug, project.name]));
    const color = new Map(
        totals.map((total, index) => [total.project, chartColors.categorical(index)]),
    );
    const totalTime = totals.reduce((sum, total) => sum + total.cpuSeconds, 0);
    const perDay = days.map((day) => {
        const lines = data?.data.filter((line) => line.day === day) ?? [];
        return {
            day,
            total: lines.reduce((sum, line) => sum + line.cpuSeconds, 0),
            segments: totals.map((total) => ({
                project: total.project,
                seconds: lines
                    .filter((line) => line.project === total.project)
                    .reduce((sum, line) => sum + line.cpuSeconds, 0),
            })),
        };
    });
    const peak = Math.max(1, ...perDay.map((entry) => entry.total));
    const formatDay = (day: string) =>
        intl.formatDate(`${day}T12:00:00Z`, { day: 'numeric', month: 'short', timeZone: 'UTC' });

    const csvUrl = useMemo(
        () =>
            data !== undefined
                ? URL.createObjectURL(new Blob([toCsv(data.data, days)], { type: 'text/csv' }))
                : null,
        [data, days],
    );

    const periods: { value: Period; label: string }[] = [
        { value: 'last30', label: m('usage.period.last30') },
        ...recentMonths(now).map((month) => ({
            value: month,
            label: intl.formatDate(`${month}-15T12:00:00Z`, {
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
            }),
        })),
    ];

    return (
        <PageLayout
            title={m('usage.title')}
            intro={m('usage.intro')}
            actions={
                csvUrl !== null ? (
                    <a href={csvUrl} download={`eclair-usage-${period}.csv`}>
                        <Button icon={Download} excludeFromTabOrder>
                            {m('usage.export')}
                        </Button>
                    </a>
                ) : undefined
            }
        >
            <div className={styles.toolbar}>
                <Select
                    label={m('usage.period')}
                    options={periods}
                    value={period}
                    onChange={(value) => setPeriod((value ?? 'last30') as Period)}
                />
                <NumberInput
                    label={m('usage.cost')}
                    description={m('usage.costHelp')}
                    value={cost}
                    minValue={0}
                    onChange={(value) => {
                        setCost(value);
                        writeCost(value);
                    }}
                />
            </div>

            {usage.isError ? (
                <Alert tone="danger">
                    <p>{m('usage.loadError', { message: usage.error.message })}</p>
                    <Button size="sm" onPress={() => void usage.refetch()}>
                        {m('common.retry')}
                    </Button>
                </Alert>
            ) : null}

            <Card title={m('usage.perDay')} headingLevel={2}>
                {data === undefined ? (
                    <Skeleton height="12rem" />
                ) : (
                    <figure style={{ margin: 0 }}>
                        <ul className={styles.legend}>
                            {totals.map((total) => (
                                <li key={total.project}>
                                    <span
                                        className={styles.swatch}
                                        style={{ background: color.get(total.project) }}
                                        aria-hidden="true"
                                    />
                                    {names.get(total.project) ?? total.project}
                                </li>
                            ))}
                        </ul>
                        <div className={styles.chart} role="img" aria-label={m('usage.perDay')}>
                            {perDay.map((entry) => (
                                <div
                                    key={entry.day}
                                    className={styles.bar}
                                    title={`${formatDay(entry.day)} · ${hours(entry.total)}`}
                                >
                                    {entry.segments.map((segment) =>
                                        segment.seconds > 0 ? (
                                            <div
                                                key={segment.project}
                                                className={styles.segment}
                                                style={{
                                                    height: `${(segment.seconds / peak) * 100}%`,
                                                    background: color.get(segment.project),
                                                }}
                                            />
                                        ) : null,
                                    )}
                                </div>
                            ))}
                        </div>
                        <figcaption className={styles.axis}>
                            <span>{days[0] !== undefined ? formatDay(days[0]) : ''}</span>
                            <span>{m('usage.perDayUnit')}</span>
                            <span>
                                {days.at(-1) !== undefined ? formatDay(days.at(-1) ?? '') : ''}
                            </span>
                        </figcaption>
                    </figure>
                )}
            </Card>

            <Card title={m('usage.perProject')} headingLevel={2}>
                {data === undefined ? (
                    <Skeleton height="8rem" />
                ) : totals.length === 0 ? (
                    <Text as="p" muted>
                        {m('usage.empty')}
                    </Text>
                ) : (
                    <div className={styles.tableBox}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th scope="col">{m('usage.columns.project')}</th>
                                    <th scope="col" className={styles.end}>
                                        {m('usage.columns.tasks')}
                                    </th>
                                    <th scope="col" className={styles.end}>
                                        {m('usage.columns.time')}
                                    </th>
                                    <th scope="col" className={styles.end}>
                                        {m('usage.columns.media')}
                                    </th>
                                    <th scope="col" className={styles.end}>
                                        {m('usage.columns.read')}
                                    </th>
                                    <th scope="col" className={styles.end}>
                                        {m('usage.columns.written')}
                                    </th>
                                    <th scope="col" className={styles.end}>
                                        {m('usage.columns.share')}
                                    </th>
                                    <th scope="col" className={styles.end}>
                                        {m('usage.columns.cost')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {totals.map((total) => {
                                    const share = totalTime > 0 ? total.cpuSeconds / totalTime : 0;
                                    return (
                                        <tr key={total.project}>
                                            <th scope="row">
                                                <span
                                                    className={styles.swatch}
                                                    style={{ background: color.get(total.project) }}
                                                    aria-hidden="true"
                                                />
                                                {names.get(total.project) ?? total.project}
                                            </th>
                                            <td className={styles.end}>
                                                {intl.formatNumber(total.tasks)}
                                            </td>
                                            <td className={styles.end}>
                                                {hours(total.cpuSeconds)}
                                            </td>
                                            <td className={styles.end}>
                                                {hours(total.mediaSeconds)}
                                            </td>
                                            <td className={styles.end}>
                                                {formatBytes(total.bytesIn)}
                                            </td>
                                            <td className={styles.end}>
                                                {formatBytes(total.bytesOut)}
                                            </td>
                                            <td className={styles.end}>
                                                {intl.formatNumber(share, {
                                                    style: 'percent',
                                                    maximumFractionDigits: 1,
                                                })}
                                            </td>
                                            <td className={styles.end}>
                                                {cost !== null
                                                    ? intl.formatNumber(cost * share, {
                                                          maximumFractionDigits: 2,
                                                          minimumFractionDigits: 2,
                                                      })
                                                    : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <th scope="row">{m('usage.total')}</th>
                                    <td className={styles.end}>
                                        {intl.formatNumber(
                                            totals.reduce((sum, total) => sum + total.tasks, 0),
                                        )}
                                    </td>
                                    <td className={styles.end}>{hours(totalTime)}</td>
                                    <td className={styles.end}>
                                        {hours(
                                            totals.reduce(
                                                (sum, total) => sum + total.mediaSeconds,
                                                0,
                                            ),
                                        )}
                                    </td>
                                    <td className={styles.end}>
                                        {formatBytes(
                                            totals.reduce((sum, total) => sum + total.bytesIn, 0),
                                        )}
                                    </td>
                                    <td className={styles.end}>
                                        {formatBytes(
                                            totals.reduce((sum, total) => sum + total.bytesOut, 0),
                                        )}
                                    </td>
                                    <td className={styles.end}>
                                        {intl.formatNumber(totalTime > 0 ? 1 : 0, {
                                            style: 'percent',
                                        })}
                                    </td>
                                    <td className={styles.end}>
                                        {cost !== null
                                            ? intl.formatNumber(cost, {
                                                  maximumFractionDigits: 2,
                                                  minimumFractionDigits: 2,
                                              })
                                            : '—'}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
                <Text as="p" size="sm" muted>
                    {m('usage.note')}
                </Text>
            </Card>
        </PageLayout>
    );
}
