import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import type { ParseArgsOptionsConfig } from 'node:util';

import { checkBinaries } from '../binaries.ts';
import { ConfigError, loadConfig, requireSettings } from '../config/config.ts';
import type { Config } from '../config/config.ts';
import { createDatabase } from '../database/connection.ts';
import type { Database } from '../database/connection.ts';
import { checkDatabase } from '../database/dialect.ts';
import { migrateToLatest, migrationStatus, pendingMigrations } from '../database/migrate.ts';
import { buildApp } from '../http/app.ts';
import { VERSION } from '../version.ts';

export interface CliIo {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
    env: NodeJS.ProcessEnv;
    /** Resolves when the process is asked to stop (SIGTERM, SIGINT). Only long-running commands call it. */
    waitForStop: () => Promise<void>;
}

/** Exit codes from sysexits.h, which the Docker entry point also uses. */
export const EXIT = {
    ok: 0,
    failure: 1,
    usage: 64,
    unavailable: 69,
    config: 78,
} as const;

interface CommandContext {
    io: CliIo;
    values: Record<string, string | boolean | (string | boolean)[] | undefined>;
    positionals: string[];
}

interface Command {
    /** Arguments after the command name, for the help. */
    usage?: string;
    description: string;
    options?: ParseArgsOptionsConfig;
    /** Positional arguments the command takes. */
    positionals?: number;
    run(context: CommandContext): Promise<number>;
}

/** Thrown by a command to stop with an exit code and a message on stderr. */
class CliExit extends Error {
    readonly code: number;

    constructor(code: number, message: string) {
        super(message);
        this.code = code;
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function readConfig(io: CliIo): Config {
    try {
        return loadConfig(io.env);
    } catch (error) {
        if (error instanceof ConfigError) {
            throw new CliExit(EXIT.config, error.message);
        }
        throw error;
    }
}

/** Reads the configuration and checks the settings a command needs. */
function configWith(io: CliIo, settings: Parameters<typeof requireSettings>[1]): Config {
    const config = readConfig(io);
    try {
        requireSettings(config, settings);
    } catch (error) {
        if (error instanceof ConfigError) {
            throw new CliExit(EXIT.config, error.message);
        }
        throw error;
    }
    return config;
}

/** Connects to the database and refuses to go on when a migration hasn't run. */
async function openMigratedDatabase(databaseUrl: string): Promise<Database> {
    const database = createDatabase(databaseUrl);
    try {
        const pending = await pendingMigrations(database);
        if (pending.length > 0) {
            throw new CliExit(
                EXIT.unavailable,
                `The database schema is not up to date: run eclair migrate (pending: ${pending.join(', ')}).`,
            );
        }
        return database;
    } catch (error) {
        await database.close();
        if (error instanceof CliExit) {
            throw error;
        }
        throw new CliExit(EXIT.unavailable, `Can't read the database: ${errorMessage(error)}`);
    }
}

async function startApi(io: CliIo, role: 'api' | 'all'): Promise<number> {
    const config = configWith(io, ['DATABASE_URL']);
    const database = await openMigratedDatabase(config.databaseUrl ?? '');
    const app = buildApp({
        version: VERSION,
        logger: {
            level: config.logLevel,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
        },
        checks: [{ name: 'database', check: () => database.ping() }],
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
    for (const binary of await checkBinaries(config.binaries)) {
        if (binary.status === 'ok') {
            line('ok', `${binary.name}: ${binary.output ?? binary.path}`);
        } else if (binary.status === 'missing') {
            line('warn', `${binary.name}: not found (${binary.path})`);
        } else {
            line('warn', `${binary.name}: doesn't run (${binary.output ?? binary.path})`);
        }
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
        return `  ${signature.padEnd(24)} ${command.description}`;
    });
    return `Usage: eclair <command>

Commands:
${lines.join('\n')}

Options:
  -h, --help               Show this help
  -v, --version            Show the version

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
