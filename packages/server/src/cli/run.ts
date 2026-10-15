import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

import { checkBinaries } from '../binaries.ts';
import { ConfigError, loadConfig } from '../config/config.ts';
import type { Config } from '../config/config.ts';
import { createDatabase } from '../database/connection.ts';
import { checkDatabase } from '../database/dialect.ts';
import { migrateToLatest, migrationStatus, pendingMigrations } from '../database/migrate.ts';
import { buildApp } from '../http/app.ts';
import { TaskQueues } from '../jobs/queues.ts';
import { createRedis } from '../redis.ts';
import { VERSION } from '../version.ts';
import { ADMIN_COMMANDS } from './admin.ts';
import {
    CliExit,
    EXIT,
    configWith,
    createServicesFor,
    errorMessage,
    loadOperations,
    openMigratedDatabase,
} from './command.ts';
import type { CliIo, Command, CommandContext } from './command.ts';

export { EXIT } from './command.ts';
export type { CliIo } from './command.ts';

async function startApi(io: CliIo, role: 'api' | 'all'): Promise<number> {
    const config = configWith(io, ['DATABASE_URL', 'REDIS_URL', 'ECLAIR_SECRET_KEY']);
    const operations = await loadOperations(config);
    const database = await openMigratedDatabase(config.databaseUrl ?? '');
    const redis = createRedis(config.redisUrl ?? '', 'eclair-api');
    const queues = new TaskQueues(redis);
    const app = buildApp({
        services: createServicesFor(database, config, operations, queues),
        version: VERSION,
        logger: {
            level: config.logLevel,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
        },
        checks: [
            { name: 'database', check: () => database.ping() },
            {
                name: 'redis',
                check: async () => {
                    await redis.ping();
                },
            },
        ],
    });
    try {
        if (role === 'all') {
            app.log.warn('Workers are not implemented yet: this process only runs the API.');
        }
        await app.listen({ host: config.host, port: config.port });
        await io.waitForStop();
        app.log.info('Stopping');
    } finally {
        await app.close();
        await queues.close();
        redis.disconnect();
        await database.close();
    }
    return EXIT.ok;
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
        run: ({ io }) => startApi(io, 'api'),
    },
    worker: {
        description: 'Start a worker for the queues in ECLAIR_QUEUES',
        run: async () => {
            throw new CliExit(
                EXIT.unavailable,
                'Workers are not implemented yet: they come with the job queue.',
            );
        },
    },
    all: {
        description: 'Start the API and a worker, for a single machine',
        run: ({ io }) => startApi(io, 'all'),
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
