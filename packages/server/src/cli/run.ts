import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { pino } from 'pino';

import { checkBinaries } from '../binaries.ts';
import { ConfigError, loadConfig } from '../config/config.ts';
import type { Config } from '../config/config.ts';
import { createDatabase } from '../database/connection.ts';
import { checkDatabase } from '../database/dialect.ts';
import { migrateToLatest, migrationStatus, pendingMigrations } from '../database/migrate.ts';
import { HostRegistry, sqliteOnSeveralHosts } from '../hosts.ts';
import { buildApp } from '../http/app.ts';
import { TaskQueues } from '../jobs/queues.ts';
import { Maintenance } from '../maintenance/maintenance.ts';
import { Metrics } from '../metrics.ts';
import { createRedis } from '../redis.ts';
import { usageReport } from '../usage/usage.ts';
import { VERSION } from '../version.ts';
import { CancelBus } from '../workers/cancel.ts';
import { TaskRunner } from '../workers/runner.ts';
import { ProjectSlots } from '../workers/slots.ts';
import { TaskWorkers } from '../workers/workers.ts';
import { ADMIN_COMMANDS } from './admin.ts';
import {
    CliExit,
    EXIT,
    configWith,
    createServicesFor,
    errorMessage,
    loadOperations,
    openMigratedDatabase,
    withServices,
} from './command.ts';
import type { CliIo, Command, CommandContext } from './command.ts';

export { EXIT } from './command.ts';
export type { CliIo } from './command.ts';

/** Starts the API, workers, or both (`eclair all`), until the process is asked to stop. */
async function start(io: CliIo, roles: { api: boolean; worker: boolean }): Promise<number> {
    const config = configWith(io, ['DATABASE_URL', 'REDIS_URL', 'ECLAIR_SECRET_KEY']);
    const operations = await loadOperations(config);
    const database = await openMigratedDatabase(config.databaseUrl ?? '');
    const name = roles.api && roles.worker ? 'all' : roles.api ? 'api' : 'worker';
    const redis = createRedis(config.redisUrl ?? '', `eclair-${name}`);
    const hosts = new HostRegistry(redis);

    // SQLite is for one machine (decision 0016): refuse to join an install that runs on another.
    if (database.dialect === 'sqlite') {
        const others = await hosts.others().catch(() => []);
        if (others.length > 0) {
            redis.disconnect();
            await database.close();
            throw new CliExit(EXIT.unavailable, sqliteOnSeveralHosts(others));
        }
    }

    const queues = new TaskQueues(redis);
    const cancel = new CancelBus(redis);
    const metrics = new Metrics(queues);
    const logger = pino({
        level: config.logLevel,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
    });
    const services = createServicesFor(database, config, operations, {
        queues,
        redis,
        logger,
        metrics,
    });
    services.scheduler?.onCancelRunning((taskIds) => cancel.publish(taskIds));

    let workers: TaskWorkers | undefined;
    let maintenance: Maintenance | undefined;
    let app: ReturnType<typeof buildApp> | undefined;
    try {
        await hosts.start();
        if (roles.worker && services.scheduler !== undefined) {
            const runner = new TaskRunner({
                database,
                scheduler: services.scheduler,
                operations,
                projects: services.projects,
                resolver: services.resolver,
                uploads: services.uploads,
                config,
                worker: `${hostname()}:${process.pid}`,
                logger,
                webhooks: services.webhooks,
                metrics,
            });
            workers = new TaskWorkers({
                connection: redis,
                queues: config.queues,
                runner,
                slots: new ProjectSlots(redis),
                cancel,
                projects: services.projects,
                logger,
            });
            await workers.start();
            logger.info(
                { queues: config.queues.map(({ name, concurrency }) => `${name}:${concurrency}`) },
                'Worker started',
            );
        }
        if (roles.api) {
            // The processes that run the API send the webhooks and run the maintenance.
            await services.webhooks?.start();
            maintenance = new Maintenance({
                database,
                redis,
                queues,
                projects: services.projects,
                uploads: services.uploads,
                temporary: services.resolver.temporary,
                logger,
                jobRetention: config.jobRetention,
            });
            maintenance.start();
            app = buildApp({
                services,
                metrics,
                version: VERSION,
                loggerInstance: logger,
                checks: [
                    { name: 'database', check: () => database.ping() },
                    {
                        name: 'redis',
                        check: async () => {
                            await redis.ping();
                        },
                    },
                    ...(database.dialect === 'sqlite'
                        ? [
                              {
                                  name: 'single-machine',
                                  check: async () => {
                                      const others = await hosts.others();
                                      if (others.length > 0) {
                                          throw new Error(sqliteOnSeveralHosts(others));
                                      }
                                  },
                              },
                          ]
                        : []),
                ],
            });
            await app.listen({ host: config.host, port: config.port });
        }
        await io.waitForStop();
        logger.info('Stopping');
    } finally {
        await app?.close();
        await maintenance?.stop();
        // Running tasks end first: a worker that stops takes no new task.
        await workers?.close();
        await hosts.stop();
        await services.webhooks?.close();
        await services.events?.close();
        await queues.close();
        redis.disconnect();
        await database.close();
    }
    return EXIT.ok;
}

async function usageCommand(io: CliIo, values: CommandContext['values']): Promise<number> {
    const days = values['days'] === undefined ? 30 : Number(values['days']);
    if (!Number.isInteger(days) || days < 1) {
        throw new CliExit(EXIT.usage, '--days must be a number of days.');
    }
    return withServices(io, async ({ database, projects }) => {
        const slug = typeof values['project'] === 'string' ? values['project'] : undefined;
        const projectId = slug === undefined ? undefined : (await projects.get(slug)).id;
        const lines = await usageReport(database, {
            since: new Date(Date.now() - days * 24 * 3_600_000),
            projectId,
        });
        if (values['json'] === true) {
            io.stdout(`${JSON.stringify(lines, null, 2)}\n`);
            return EXIT.ok;
        }
        if (lines.length === 0) {
            io.stdout('No usage in this period.\n');
            return EXIT.ok;
        }
        const megabytes = (bytes: number) => (bytes / 1024 ** 2).toFixed(1);
        const rows = lines.map((line) => [
            line.project,
            line.day,
            String(line.tasks),
            line.cpuSeconds.toFixed(1),
            line.mediaSeconds.toFixed(1),
            megabytes(line.bytesIn),
            megabytes(line.bytesOut),
            megabytes(line.bytesStored),
        ]);
        const headers = [
            'PROJECT',
            'DAY',
            'TASKS',
            'TASK S',
            'MEDIA S',
            'IN MB',
            'OUT MB',
            'KEPT MB',
        ];
        const widths = headers.map((header, column) =>
            Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
        );
        for (const row of [headers, ...rows]) {
            io.stdout(
                `${row
                    .map((cell, column) => cell.padEnd(widths[column] ?? 0))
                    .join('  ')
                    .trimEnd()}\n`,
            );
        }
        return EXIT.ok;
    });
}

async function migrate(io: CliIo, statusOnly: boolean): Promise<number> {
    const config = configWith(io, ['DATABASE_URL']);
    const database = createDatabase(config.databaseUrl ?? '');
    try {
        if (statusOnly) {
            for (const { name, executedAt } of await migrationStatus(database)) {
                io.stdout(`${executedAt === undefined ? 'pending' : 'ran    '} ${name}\n`);
            }
            return EXIT.ok;
        }
        const results = await migrateToLatest(database);
        for (const result of results) {
            io.stdout(`ran ${result.migrationName}\n`);
        }
        io.stdout(results.length === 0 ? 'Nothing to migrate.\n' : 'Done.\n');
        return EXIT.ok;
    } catch (error) {
        throw new CliExit(EXIT.failure, `Migration failed: ${errorMessage(error)}`);
    } finally {
        await database.close();
    }
}

async function doctor(io: CliIo): Promise<number> {
    let failed = false;
    const line = (status: 'ok' | 'warn' | 'error', text: string) => {
        if (status === 'error') {
            failed = true;
        }
        io.stdout(`${status.padEnd(5)} ${text}\n`);
    };

    io.stdout(`Eclair ${VERSION}\n\n`);
    let config: Config;
    try {
        config = loadConfig(io.env);
        line('ok', 'configuration');
    } catch (error) {
        if (!(error instanceof ConfigError)) {
            throw error;
        }
        for (const problem of error.problems) {
            line('error', problem);
        }
        return EXIT.config;
    }

    for (const setting of ['DATABASE_URL', 'REDIS_URL', 'ECLAIR_SECRET_KEY'] as const) {
        if (io.env[setting] === undefined || io.env[setting]?.trim() === '') {
            line('error', `${setting} is not set: the API and the workers need it.`);
        }
    }

    if (config.redisUrl !== undefined) {
        const redis = createRedis(config.redisUrl, 'eclair-doctor');
        redis.on('error', () => {});
        try {
            const info = await redis.info('server');
            const version = /redis_version:(\S+)/.exec(info)?.[1] ?? 'unknown version';
            line('ok', `redis: ${version}`);
            const live = await new HostRegistry(redis).live();
            if (live.length > 0) {
                line('ok', `machines running Eclair: ${live.join(', ')}`);
            }
            if (live.length > 1 && config.databaseUrl?.startsWith('sqlite:') === true) {
                line('error', sqliteOnSeveralHosts(live));
            }
        } catch (error) {
            line('error', `redis: ${errorMessage(error)}`);
        } finally {
            redis.disconnect();
        }
    }

    if (config.databaseUrl !== undefined) {
        try {
            const status = await checkDatabase(config.databaseUrl);
            if (!status.supported) {
                line('error', `database: ${status.dialect} ${status.version} is not supported.`);
            } else {
                line('ok', `database: ${status.dialect} ${status.version}`);
            }
            if (status.dialect === 'sqlite') {
                line(
                    'warn',
                    'SQLite is for a single machine. Use MySQL or PostgreSQL to run Eclair on several (decision 0016).',
                );
            }
            const database = createDatabase(config.databaseUrl);
            try {
                const pending = await pendingMigrations(database);
                if (pending.length > 0) {
                    line(
                        'error',
                        `database schema: run eclair migrate (pending: ${pending.join(', ')})`,
                    );
                } else {
                    line('ok', 'database schema is up to date');
                }
            } finally {
                await database.close();
            }
        } catch (error) {
            line('error', `database: ${errorMessage(error)}`);
        }
    }

    // A worker only needs the binaries of the operations it runs: a missing one is a warning.
    const binaries = await checkBinaries(config.binaries);
    for (const binary of binaries) {
        if (binary.status === 'ok') {
            line('ok', `${binary.name}: ${binary.output ?? binary.path}`);
        } else if (binary.status === 'missing') {
            line('warn', `${binary.name}: not found (${binary.path})`);
        } else {
            line('warn', `${binary.name}: doesn't run (${binary.output ?? binary.path})`);
        }
    }

    try {
        const operations = await loadOperations(config);
        const working = new Set(
            binaries
                .filter((binary) => binary.status === 'ok')
                .map((binary) => binary.name as string),
        );
        for (const operation of operations.list()) {
            const missing = operation.binaries.filter((binary) => !working.has(binary));
            if (missing.length === 0) {
                line('ok', `operation ${operation.key} (${operation.capability})`);
            } else {
                line('warn', `operation ${operation.key} can't run here: no ${missing.join(', ')}`);
            }
        }
    } catch (error) {
        line('error', error instanceof CliExit ? error.message : errorMessage(error));
    }

    return failed ? EXIT.failure : EXIT.ok;
}

const COMMANDS: Record<string, Command> = {
    api: {
        description: 'Start the API',
        run: ({ io }) => start(io, { api: true, worker: false }),
    },
    worker: {
        description: 'Start a worker for the queues in ECLAIR_QUEUES',
        run: ({ io }) => start(io, { api: false, worker: true }),
    },
    all: {
        description: 'Start the API and a worker, for a single machine',
        run: ({ io }) => start(io, { api: true, worker: true }),
    },
    migrate: {
        usage: '[--status]',
        description: 'Run the database migrations, or list them with --status',
        options: { status: { type: 'boolean' } },
        run: ({ io, values }) => migrate(io, values['status'] === true),
    },
    doctor: {
        description: 'Check the configuration, the database and the binaries',
        run: ({ io }) => doctor(io),
    },
    ...ADMIN_COMMANDS,
    usage: {
        usage: '[--project …] [--days 30] [--json]',
        description: 'Usage per project and day, to split the cost of the server',
        options: {
            project: { type: 'string' },
            days: { type: 'string' },
            json: { type: 'boolean' },
        },
        run: ({ io, values }) => usageCommand(io, values),
    },
    'key:generate': {
        description: 'Print a new ECLAIR_SECRET_KEY',
        run: async ({ io }) => {
            io.stdout(`${randomBytes(32).toString('base64')}\n`);
            return EXIT.ok;
        },
    },
};

function usage(): string {
    const lines = Object.entries(COMMANDS).map(([name, command]) => {
        const signature = command.usage === undefined ? name : `${name} ${command.usage}`;
        return `  ${signature}\n      ${command.description}`;
    });
    return `Usage: eclair <command>

Commands:
${lines.join('\n')}

Options:
  -h, --help       Show this help
  -v, --version    Show the version

Configuration comes from environment variables: see docs/deployment.md.
`;
}

/** Runs the `eclair` command line. Returns the exit code. */
export async function runCli(args: string[], io: CliIo): Promise<number> {
    const [name, ...rest] = args;

    if (name === undefined || name === 'help' || name === '-h' || name === '--help') {
        io.stdout(usage());
        return EXIT.ok;
    }
    if (name === 'version' || name === '-v' || name === '--version') {
        io.stdout(`${VERSION}\n`);
        return EXIT.ok;
    }

    const command = COMMANDS[name];
    if (command === undefined) {
        io.stderr(`eclair: unknown command "${name}"\n\n${usage()}`);
        return EXIT.usage;
    }

    let parsed: { values: CommandContext['values']; positionals: string[] };
    try {
        parsed = parseArgs({
            args: rest,
            options: command.options ?? {},
            allowPositionals: (command.positionals ?? 0) > 0,
            strict: true,
        });
        if (parsed.positionals.length > (command.positionals ?? 0)) {
            throw new Error(`Unexpected argument: ${parsed.positionals.join(' ')}`);
        }
    } catch (error) {
        io.stderr(`eclair ${name}: ${errorMessage(error)}\n\n${usage()}`);
        return EXIT.usage;
    }

    try {
        return await command.run({ io, ...parsed });
    } catch (error) {
        if (error instanceof CliExit) {
            io.stderr(`eclair: ${error.message}\n`);
            return error.code;
        }
        throw error;
    }
}
