import { randomBytes } from 'node:crypto';

import { checkBinaries } from '../binaries.ts';
import { ConfigError, loadConfig } from '../config/config.ts';
import type { Config } from '../config/config.ts';
import { checkDatabase } from '../database/dialect.ts';
import { buildApp } from '../http/app.ts';
import type { ReadinessCheck } from '../http/app.ts';
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

const USAGE = `Usage: eclair <command>

Commands:
  api            Start the API
  worker         Start a worker for the queues in ECLAIR_QUEUES
  all            Start the API and a worker, for a single machine
  doctor         Check the configuration, the database and the binaries
  key:generate   Print a new ECLAIR_SECRET_KEY

Options:
  -h, --help     Show this help
  -v, --version  Show the version

Configuration comes from environment variables: see docs/deployment.md.
`;

function readConfig(io: CliIo): Config | undefined {
    try {
        return loadConfig(io.env);
    } catch (error) {
        if (error instanceof ConfigError) {
            io.stderr(`eclair: ${error.message}\n`);
            return undefined;
        }
        throw error;
    }
}

function readinessChecks(config: Config): ReadinessCheck[] {
    const checks: ReadinessCheck[] = [];
    const { databaseUrl } = config;
    if (databaseUrl !== undefined) {
        checks.push({
            name: 'database',
            async check() {
                const status = await checkDatabase(databaseUrl);
                if (!status.supported) {
                    throw new Error(`unsupported ${status.dialect} version ${status.version}`);
                }
            },
        });
    }
    return checks;
}

async function startApi(config: Config, io: CliIo, role: 'api' | 'all'): Promise<number> {
    const app = buildApp({
        version: VERSION,
        logger: {
            level: config.logLevel,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
        },
        checks: readinessChecks(config),
    });
    if (role === 'all') {
        app.log.warn('Workers are not implemented yet: this process only runs the API.');
    }
    await app.listen({ host: config.host, port: config.port });
    await io.waitForStop();
    app.log.info('Stopping');
    await app.close();
    return EXIT.ok;
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
        } catch (error) {
            line('error', `database: ${error instanceof Error ? error.message : String(error)}`);
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

/** Runs the `eclair` command line. Returns the exit code. */
export async function runCli(args: string[], io: CliIo): Promise<number> {
    const [command, ...rest] = args;
    if (rest.length > 0) {
        io.stderr(`eclair: unexpected arguments: ${rest.join(' ')}\n\n${USAGE}`);
        return EXIT.usage;
    }

    switch (command) {
        case undefined:
        case 'help':
        case '-h':
        case '--help':
            io.stdout(USAGE);
            return EXIT.ok;

        case 'version':
        case '-v':
        case '--version':
            io.stdout(`${VERSION}\n`);
            return EXIT.ok;

        case 'key:generate':
            io.stdout(`${randomBytes(32).toString('base64')}\n`);
            return EXIT.ok;

        case 'doctor':
            return doctor(io);

        case 'api':
        case 'all': {
            const config = readConfig(io);
            return config === undefined ? EXIT.config : startApi(config, io, command);
        }

        case 'worker':
            io.stderr('eclair: workers are not implemented yet: they come with the job queue.\n');
            return EXIT.unavailable;

        default:
            io.stderr(`eclair: unknown command "${command}"\n\n${USAGE}`);
            return EXIT.usage;
    }
}
