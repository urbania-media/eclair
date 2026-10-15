import type { ParseArgsOptionsConfig } from 'node:util';

import { ConfigError, loadConfig, requireSettings } from '../config/config.ts';
import type { Config } from '../config/config.ts';
import { createDatabase } from '../database/connection.ts';
import type { Database } from '../database/connection.ts';
import { pendingMigrations } from '../database/migrate.ts';
import { ConflictError, NotFoundError } from '../errors.ts';
import type { TaskQueues } from '../jobs/queues.ts';
import { BUILT_IN_PLUGINS, OperationRegistry, PluginError } from '../operations/registry.ts';
import { createServices } from '../services.ts';
import type { Services } from '../services.ts';
import { TemporaryStorage } from '../storages/temporary.ts';
import { InvalidValueError } from '../validation.ts';

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

export interface CommandContext {
    io: CliIo;
    values: Record<string, string | boolean | (string | boolean)[] | undefined>;
    positionals: string[];
}

export interface Command {
    /** Arguments after the command name, for the help. */
    usage?: string;
    description: string;
    options?: ParseArgsOptionsConfig;
    /** Positional arguments the command takes. */
    positionals?: number;
    run(context: CommandContext): Promise<number>;
}

/** Thrown by a command to stop with an exit code and a message on stderr. */
export class CliExit extends Error {
    readonly code: number;

    constructor(code: number, message: string) {
        super(message);
        this.code = code;
    }
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function readConfig(io: CliIo): Config {
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
export function configWith(io: CliIo, settings: Parameters<typeof requireSettings>[1]): Config {
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
export async function openMigratedDatabase(databaseUrl: string): Promise<Database> {
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

/**
 * Runs a command with the repositories: needs the database and the secret key. Errors about what
 * the command names (unknown project, invalid settings) become a message and exit code 1.
 */
export async function withServices<T>(
    io: CliIo,
    run: (services: Services, config: Config) => Promise<T>,
): Promise<T> {
    const config = configWith(io, ['DATABASE_URL', 'ECLAIR_SECRET_KEY']);
    const operations = await loadOperations(config);
    const database = await openMigratedDatabase(config.databaseUrl ?? '');
    try {
        return await run(createServicesFor(database, config, operations), config);
    } catch (error) {
        if (error instanceof NotFoundError || error instanceof ConflictError) {
            throw new CliExit(EXIT.failure, error.message);
        }
        if (error instanceof InvalidValueError) {
            const details = Object.entries(error.errors).map(
                ([pointer, messages]) => `  ${pointer || '(value)'}: ${messages.join(', ')}`,
            );
            throw new CliExit(EXIT.failure, [error.message, ...details].join('\n'));
        }
        throw error;
    } finally {
        await database.close();
    }
}

/** Loads the built-in operations and the plugins of `ECLAIR_PLUGINS`. */
export async function loadOperations(config: Config): Promise<OperationRegistry> {
    try {
        return await OperationRegistry.load([...BUILT_IN_PLUGINS, ...config.plugins]);
    } catch (error) {
        if (error instanceof PluginError) {
            throw new CliExit(EXIT.config, `${error.message}\n  ${errorMessage(error.cause)}`);
        }
        throw error;
    }
}

/** The repositories, with the configuration's temporary storage and limits. */
export function createServicesFor(
    database: Database,
    config: Config,
    operations: OperationRegistry | undefined,
    queues?: TaskQueues,
): Services {
    return createServices({
        database,
        secretKey: config.secretKey ?? Buffer.alloc(0),
        temporary: TemporaryStorage.fromConfig(config),
        limits: {
            tempRetention: config.tempRetention,
            tempMaxRetention: config.tempMaxRetention,
            maxInputSize: config.maxInputSize,
            tmpDir: config.tmpDir,
        },
        operations,
        queues,
    });
}
