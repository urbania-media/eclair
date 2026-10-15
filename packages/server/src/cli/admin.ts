import { readFileSync } from 'node:fs';

import type { Priority, Project, ProjectPatch } from '../projects/projects.ts';
import { CliExit, EXIT, errorMessage, withServices } from './command.ts';
import type { CliIo, Command, CommandContext } from './command.ts';

function text(values: CommandContext['values'], name: string): string | undefined {
    const value = values[name];
    return typeof value === 'string' ? value : undefined;
}

function texts(values: CommandContext['values'], name: string): string[] {
    const value = values[name];
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === 'string');
    }
    return typeof value === 'string' ? [value] : [];
}

function positional(context: CommandContext, index: number, name: string): string {
    const value = context.positionals[index];
    if (value === undefined) {
        throw new CliExit(EXIT.usage, `Missing <${name}>.`);
    }
    return value;
}

/** Prints rows as aligned columns. */
function table(io: CliIo, headers: string[], rows: string[][]): void {
    if (rows.length === 0) {
        io.stdout('Nothing yet.\n');
        return;
    }
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
}

function json(io: CliIo, value: unknown): void {
    io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

/** Reads a JSON value from an option, a file or stdin (`-`). */
function readJsonOption(source: string, label: string): unknown {
    let content = source;
    if (source === '-') {
        content = readFileSync(0, 'utf8');
    } else if (source.startsWith('@')) {
        content = readFileSync(source.slice(1), 'utf8');
    }
    try {
        return JSON.parse(content) as unknown;
    } catch (error) {
        throw new CliExit(EXIT.usage, `${label} is not valid JSON: ${errorMessage(error)}`);
    }
}

/** Parses `key=value` settings. A value is JSON when it parses as JSON, a string otherwise. */
function parseSettings(assignments: string[]): Record<string, unknown> {
    const settings: Record<string, unknown> = {};
    for (const assignment of assignments) {
        const separator = assignment.indexOf('=');
        if (separator <= 0) {
            throw new CliExit(EXIT.usage, `--set takes key=value, not "${assignment}".`);
        }
        const value = assignment.slice(separator + 1);
        try {
            settings[assignment.slice(0, separator)] = JSON.parse(value) as unknown;
        } catch {
            settings[assignment.slice(0, separator)] = value;
        }
    }
    return settings;
}

function describeProject(project: Project) {
    return {
        id: project.id,
        slug: project.slug,
        name: project.name,
        priority: project.priority,
        webhookUrl: project.webhookUrl ?? null,
        settings: project.settings,
        disabled: project.disabledAt !== undefined,
        createdAt: project.createdAt,
    };
}

const PRIORITY_OPTION = { type: 'string' } as const;

export const ADMIN_COMMANDS: Record<string, Command> = {
    'projects:create': {
        usage: '<slug> [--name …] [--priority low|normal|high] [--webhook-url …] [--set key=value…]',
        description: 'Create a project and print its webhook secret',
        positionals: 1,
        options: {
            name: { type: 'string' },
            priority: PRIORITY_OPTION,
            'webhook-url': { type: 'string' },
            set: { type: 'string', multiple: true },
        },
        run: (context) =>
            withServices(context.io, async ({ projects }) => {
                const { values } = context;
                const { project, webhookSecret } = await projects.create({
                    slug: positional(context, 0, 'slug'),
                    ...(text(values, 'name') === undefined ? {} : { name: text(values, 'name') }),
                    ...(text(values, 'priority') === undefined
                        ? {}
                        : { priority: text(values, 'priority') as Priority }),
                    ...(text(values, 'webhook-url') === undefined
                        ? {}
                        : { webhookUrl: text(values, 'webhook-url') }),
                    settings: parseSettings(texts(values, 'set')),
                });
                context.io.stdout(
                    `Created ${project.slug} (${project.id}).\n\nWebhook secret, to verify Eclair's webhooks (shown once, see projects:secret):\n${webhookSecret}\n`,
                );
                return EXIT.ok;
            }),
    },

    'projects:list': {
        description: 'List the projects',
        run: ({ io }) =>
            withServices(io, async ({ projects }) => {
                table(
                    io,
                    ['SLUG', 'NAME', 'PRIORITY', 'STATUS', 'ID'],
                    (await projects.list()).map((project) => [
                        project.slug,
                        project.name,
                        project.priority,
                        project.disabledAt === undefined ? 'active' : 'disabled',
                        project.id,
                    ]),
                );
                return EXIT.ok;
            }),
    },

    'projects:show': {
        usage: '<project>',
        description: 'Show a project, its keys and its storages',
        positionals: 1,
        run: (context) =>
            withServices(context.io, async ({ projects, apiKeys, storages }) => {
                const project = await projects.get(positional(context, 0, 'project'));
                json(context.io, {
                    ...describeProject(project),
                    keys: (await apiKeys.list(project.id)).map((key) => ({
                        id: key.id,
                        name: key.name,
                        prefix: key.prefix,
                        scopes: key.scopes,
                        lastUsedAt: key.lastUsedAt ?? null,
                        revoked: key.revokedAt !== undefined,
                    })),
                    storages: (await storages.list(project.id)).map((storage) => ({
                        name: storage.name,
                        kind: storage.kind,
                        location: storage.location,
                    })),
                });
                return EXIT.ok;
            }),
    },

    'projects:update': {
        usage: '<project> [--name …] [--priority …] [--webhook-url …|--no-webhook] [--set key=value…] [--unset key…] [--disable|--enable]',
        description: 'Change a project. --set merges a setting, --unset restores its default',
        positionals: 1,
        options: {
            name: { type: 'string' },
            priority: PRIORITY_OPTION,
            'webhook-url': { type: 'string' },
            'no-webhook': { type: 'boolean' },
            set: { type: 'string', multiple: true },
            unset: { type: 'string', multiple: true },
            disable: { type: 'boolean' },
            enable: { type: 'boolean' },
        },
        run: (context) =>
            withServices(context.io, async ({ projects }) => {
                const { values } = context;
                if (values['disable'] === true && values['enable'] === true) {
                    throw new CliExit(EXIT.usage, 'Choose --disable or --enable, not both.');
                }
                const settings = parseSettings(texts(values, 'set'));
                for (const key of texts(values, 'unset')) {
                    settings[key] = null;
                }
                const patch: ProjectPatch = {
                    ...(text(values, 'name') === undefined ? {} : { name: text(values, 'name') }),
                    ...(text(values, 'priority') === undefined
                        ? {}
                        : { priority: text(values, 'priority') as Priority }),
                    ...(text(values, 'webhook-url') === undefined
                        ? {}
                        : { webhookUrl: text(values, 'webhook-url') }),
                    ...(values['no-webhook'] === true ? { webhookUrl: null } : {}),
                    ...(Object.keys(settings).length === 0 ? {} : { settings }),
                    ...(values['disable'] === true ? { disabled: true } : {}),
                    ...(values['enable'] === true ? { disabled: false } : {}),
                };
                const project = await projects.update(positional(context, 0, 'project'), patch);
                json(context.io, describeProject(project));
                return EXIT.ok;
            }),
    },

    'projects:secret': {
        usage: '<project> [--rotate]',
        description: "Print a project's webhook secret, or replace it with --rotate",
        positionals: 1,
        options: { rotate: { type: 'boolean' } },
        run: (context) =>
            withServices(context.io, async ({ projects }) => {
                const slug = positional(context, 0, 'project');
                const secret =
                    context.values['rotate'] === true
                        ? await projects.rotateWebhookSecret(slug)
                        : await projects.webhookSecret((await projects.get(slug)).id);
                context.io.stdout(`${secret}\n`);
                return EXIT.ok;
            }),
    },

    'projects:delete': {
        usage: '<project> --yes',
        description: 'Delete a project with its keys, storages, presets, jobs and usage',
        positionals: 1,
        options: { yes: { type: 'boolean' } },
        run: (context) =>
            withServices(context.io, async ({ projects }) => {
                const slug = positional(context, 0, 'project');
                if (context.values['yes'] !== true) {
                    throw new CliExit(
                        EXIT.usage,
                        `This deletes ${slug} and everything it owns in Eclair. Add --yes to confirm.`,
                    );
                }
                await projects.delete(slug);
                context.io.stdout(`Deleted ${slug}.\n`);
                return EXIT.ok;
            }),
    },

    'keys:create': {
        usage: '<project> [--name …] [--scopes jobs:read,jobs:write,presets:write]',
        description: 'Create an API key and print it (shown once)',
        positionals: 1,
        options: { name: { type: 'string' }, scopes: { type: 'string' } },
        run: (context) =>
            withServices(context.io, async ({ apiKeys }) => {
                const scopes = text(context.values, 'scopes')
                    ?.split(',')
                    .map((scope) => scope.trim())
                    .filter((scope) => scope !== '');
                const { key, token } = await apiKeys.create(positional(context, 0, 'project'), {
                    ...(text(context.values, 'name') === undefined
                        ? {}
                        : { name: text(context.values, 'name') }),
                    ...(scopes === undefined ? {} : { scopes }),
                });
                context.io.stdout(
                    `Created key ${key.id} (${key.scopes.join(', ')}). It is shown once:\n${token}\n`,
                );
                return EXIT.ok;
            }),
    },

    'keys:list': {
        usage: '<project>',
        description: "List a project's API keys",
        positionals: 1,
        run: (context) =>
            withServices(context.io, async ({ apiKeys }) => {
                table(
                    context.io,
                    ['ID', 'NAME', 'PREFIX', 'SCOPES', 'LAST USED', 'STATUS'],
                    (await apiKeys.list(positional(context, 0, 'project'))).map((key) => [
                        key.id,
                        key.name,
                        `${key.prefix}…`,
                        key.scopes.join(','),
                        key.lastUsedAt?.toISOString() ?? 'never',
                        key.revokedAt === undefined ? 'active' : 'revoked',
                    ]),
                );
                return EXIT.ok;
            }),
    },

    'keys:revoke': {
        usage: '<key-id>',
        description: 'Revoke an API key',
        positionals: 1,
        run: (context) =>
            withServices(context.io, async ({ apiKeys }) => {
                const key = await apiKeys.revoke(positional(context, 0, 'key-id'));
                context.io.stdout(`Revoked ${key.id} (${key.prefix}…).\n`);
                return EXIT.ok;
            }),
    },

    'storages:set': {
        usage: "<project> <name> --kind s3|http --config '<json>'|@file|-",
        description: 'Create or replace a storage of a project',
        positionals: 2,
        options: { kind: { type: 'string' }, config: { type: 'string' } },
        run: (context) =>
            withServices(context.io, async ({ storages }) => {
                const kind = text(context.values, 'kind');
                const config = text(context.values, 'config');
                if (kind === undefined || config === undefined) {
                    throw new CliExit(EXIT.usage, 'storages:set needs --kind and --config.');
                }
                const storage = await storages.set(
                    positional(context, 0, 'project'),
                    positional(context, 1, 'name'),
                    kind,
                    readJsonOption(config, '--config'),
                );
                context.io.stdout(`Saved ${storage.name}: ${storage.location}\n`);
                return EXIT.ok;
            }),
    },

    'storages:list': {
        usage: '<project>',
        description: "List a project's storages, without their credentials",
        positionals: 1,
        run: (context) =>
            withServices(context.io, async ({ storages }) => {
                table(
                    context.io,
                    ['NAME', 'KIND', 'LOCATION'],
                    (await storages.list(positional(context, 0, 'project'))).map((storage) => [
                        storage.name,
                        storage.kind,
                        storage.location,
                    ]),
                );
                return EXIT.ok;
            }),
    },

    'storages:remove': {
        usage: '<project> <name>',
        description: 'Remove a storage of a project',
        positionals: 2,
        run: (context) =>
            withServices(context.io, async ({ storages }) => {
                const name = positional(context, 1, 'name');
                await storages.remove(positional(context, 0, 'project'), name);
                context.io.stdout(`Removed ${name}.\n`);
                return EXIT.ok;
            }),
    },

    'presets:set': {
        usage: '<name> --file preset.json|- [--project …]',
        description: 'Create or replace a preset, global or of a project',
        positionals: 1,
        options: { file: { type: 'string' }, project: { type: 'string' } },
        run: (context) =>
            withServices(context.io, async ({ presets, projects }) => {
                const file = text(context.values, 'file');
                if (file === undefined) {
                    throw new CliExit(EXIT.usage, 'presets:set needs --file.');
                }
                const slug = text(context.values, 'project');
                const projectId = slug === undefined ? undefined : (await projects.get(slug)).id;
                const { preset, created } = await presets.put(
                    projectId,
                    positional(context, 0, 'name'),
                    readJsonOption(file === '-' ? '-' : `@${file}`, '--file'),
                );
                context.io.stdout(
                    `${created ? 'Created' : 'Updated'} ${preset.scope} preset ${preset.name}, version ${preset.version}.\n`,
                );
                return EXIT.ok;
            }),
    },

    'presets:list': {
        usage: '[--project …]',
        description: 'List the global presets, or the presets a project sees',
        options: { project: { type: 'string' } },
        run: (context) =>
            withServices(context.io, async ({ presets, projects }) => {
                const slug = text(context.values, 'project');
                const projectId = slug === undefined ? undefined : (await projects.get(slug)).id;
                table(
                    context.io,
                    ['NAME', 'SCOPE', 'VERSION', 'TASKS'],
                    (await presets.list(projectId)).map((preset) => [
                        preset.name,
                        preset.scope,
                        String(preset.version),
                        Object.keys(preset.tasks).join(', '),
                    ]),
                );
                return EXIT.ok;
            }),
    },

    'presets:remove': {
        usage: '<name> [--project …]',
        description: 'Remove a global preset, or a preset of a project',
        positionals: 1,
        options: { project: { type: 'string' } },
        run: (context) =>
            withServices(context.io, async ({ presets, projects }) => {
                const slug = text(context.values, 'project');
                const projectId = slug === undefined ? undefined : (await projects.get(slug)).id;
                const name = positional(context, 0, 'name');
                await presets.delete(projectId, name);
                context.io.stdout(`Removed ${name}.\n`);
                return EXIT.ok;
            }),
    },
};
