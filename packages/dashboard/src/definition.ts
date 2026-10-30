import type {
    ActionInput,
    DefinitionInput,
    Field,
    LayoutNode,
    ResourceInput,
    User,
} from '@panneau/protocol';
import type { IntlShape } from 'react-intl';

import { type Locale, type MessageId, t } from './messages/index.ts';

export interface DefinitionOptions {
    intl: IntlShape;
    locale: Locale;
    /** The URL of the admin API. */
    baseUrl: string;
    user: User;
    /** The projects, for the filters of lists. */
    projects?: readonly { slug: string; name: string }[];
}

/** The path of the dashboard, for links. */
export const BASE_PATH = '/dashboard';

const SLUG = '^[a-z0-9][a-z0-9-]{0,62}$';
const STORAGE_NAME = '^[a-z0-9][a-z0-9_-]{0,63}$';
const PRESET_NAME = '^[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*)*$';

function messages(intl: IntlShape) {
    const m = (id: MessageId, values?: Record<string, string | number>) => t(intl, id, values);
    const options = (prefix: string, values: readonly string[]) =>
        values.map((value) => ({ value, label: m(`${prefix}.${value}` as MessageId) }));
    const field = (
        resource: string,
        name: string,
        type: string,
        extra: Partial<Field> = {},
    ): Field => ({ name, type, label: m(`${resource}.fields.${name}` as MessageId), ...extra });
    const row = (...children: [string, number][]): LayoutNode => ({
        type: 'row',
        children: children.map(([name, width]) => ({ type: 'field', name, width })),
    });
    return { m, options, field, row };
}

function projectsResource(intl: IntlShape): ResourceInput {
    const { m, options, field, row } = messages(intl);
    const server = m('projects.serverDefault');
    const status = options('status', ['active', 'disabled']);
    const actions: ActionInput[] = [
        {
            id: 'disable',
            label: m('projects.actions.disable'),
            icon: 'circle-off',
            scope: ['item'],
            placement: ['form'],
            destructive: true,
            confirm: {
                title: m('projects.actions.disableTitle'),
                message: m('projects.actions.disableMessage'),
                confirmLabel: m('projects.actions.disable'),
            },
        },
        {
            id: 'enable',
            label: m('projects.actions.enable'),
            icon: 'circle-check',
            scope: ['item'],
            placement: ['form'],
        },
        {
            id: 'jobs',
            label: m('projects.actions.jobs'),
            icon: 'list',
            kind: 'link',
            scope: ['item'],
            placement: ['form'],
            url: `${BASE_PATH}/resources/jobs?filter[project]={slug}`,
        },
    ];
    return {
        id: 'projects',
        label: { singular: m('projects.singular'), plural: m('projects.plural') },
        description: m('projects.description'),
        icon: 'folder',
        itemTitle: 'name',
        itemSubtitle: 'slug',
        abilities: { viewAny: true, create: true },
        fields: [
            field('projects', 'name', 'text', { rules: [{ rule: 'required' }] }),
            field('projects', 'slug', 'text', {
                createOnly: true,
                help: m('projects.help.slug'),
                rules: [{ rule: 'required' }, { rule: 'pattern', value: SLUG }],
            }),
            field('projects', 'status', 'select', {
                readOnly: true,
                options: status,
                display: 'eclair-status',
            }),
            field('projects', 'priority', 'select', {
                options: options('priority', ['low', 'normal', 'high']),
                default: 'normal',
                help: m('projects.help.priority'),
            }),
            field('projects', 'concurrency', 'number', {
                placeholder: '4',
                help: m('projects.help.concurrency'),
                rules: [
                    { rule: 'min', value: 1 },
                    { rule: 'max', value: 1000 },
                ],
            }),
            field('projects', 'taskTimeout', 'duration', {
                help: m('projects.help.taskTimeout'),
                settings: { precision: 'minutes' },
            }),
            field('projects', 'maxInputSize', 'number', {
                placeholder: server,
                help: m('projects.help.maxInputSize'),
                settings: { suffix: m('units.megabytes') },
                rules: [{ rule: 'min', value: 1 }],
            }),
            field('projects', 'maxDirectUpload', 'number', {
                placeholder: '100',
                help: m('projects.help.maxDirectUpload'),
                settings: { suffix: m('units.megabytes') },
                rules: [{ rule: 'min', value: 1 }],
            }),
            field('projects', 'probesPerMinute', 'number', {
                placeholder: '600',
                help: m('projects.help.probesPerMinute'),
                rules: [{ rule: 'min', value: 1 }],
            }),
            field('projects', 'tempRetention', 'duration', {
                help: m('projects.help.tempRetention'),
                settings: { precision: 'minutes' },
            }),
            field('projects', 'operations', 'tags', { help: m('projects.help.operations') }),
            field('projects', 'inputHosts', 'tags', { help: m('projects.help.inputHosts') }),
            field('projects', 'webhookUrl', 'url', {
                help: m('projects.help.webhookUrl'),
                rules: [{ rule: 'pattern', value: '^https://', message: m('projects.httpsOnly') }],
            }),
            field('projects', 'taskWebhooks', 'boolean', { help: m('projects.help.taskWebhooks') }),
            field('projects', 'progressWebhooks', 'boolean', {
                help: m('projects.help.progressWebhooks'),
            }),
            field('projects', 'progressWebhookInterval', 'duration', {
                help: m('projects.help.progressWebhookInterval'),
                visibleWhen: { field: 'progressWebhooks', equals: true },
            }),
        ],
        form: {
            layout: [
                {
                    type: 'component',
                    component: 'eclair-item-actions',
                    props: { resource: 'projects', idField: 'slug' },
                },
                row(['name', 6], ['slug', 4], ['status', 2]),
                {
                    type: 'section',
                    label: m('projects.sections.settings'),
                    description: m('projects.sections.settingsHelp'),
                    children: [
                        row(['concurrency', 4], ['taskTimeout', 4], ['maxInputSize', 4]),
                        row(['maxDirectUpload', 4], ['probesPerMinute', 4], ['tempRetention', 4]),
                        row(['priority', 4], ['operations', 8]),
                        { type: 'field', name: 'inputHosts' },
                    ],
                },
                {
                    type: 'section',
                    label: m('projects.sections.webhooks'),
                    children: [
                        { type: 'field', name: 'webhookUrl' },
                        { type: 'component', component: 'eclair-webhook-secret' },
                        { type: 'field', name: 'taskWebhooks' },
                        { type: 'field', name: 'progressWebhooks' },
                        { type: 'field', name: 'progressWebhookInterval' },
                    ],
                },
                { type: 'component', component: 'eclair-project-keys' },
                { type: 'component', component: 'eclair-project-storages' },
            ],
        },
        list: {
            columns: [
                { field: 'name' },
                { field: 'status' },
                { id: 'storages', label: m('projects.columns.storages'), display: 'text' },
                { id: 'keys', label: m('projects.columns.keys'), display: 'number', align: 'end' },
                { field: 'concurrency', label: m('projects.columns.concurrency'), align: 'end' },
                { id: 'jobs', label: m('projects.columns.jobs'), display: 'number', align: 'end' },
                {
                    id: 'failures',
                    label: m('projects.columns.failures'),
                    display: 'number',
                    align: 'end',
                },
                {
                    id: 'webhooks',
                    label: m('projects.columns.webhooks'),
                    display: 'eclair-webhooks',
                },
                {
                    id: 'taskTime',
                    label: m('projects.columns.taskTime'),
                    display: 'eclair-hours',
                    align: 'end',
                },
            ],
            filters: [
                {
                    id: 'status',
                    type: 'select',
                    label: m('projects.fields.status'),
                    options: status,
                },
            ],
            sorts: ['name', 'slug', 'concurrency', 'jobs', 'failures', 'taskTime'],
            defaultSort: 'name',
            search: true,
            perPage: 50,
        },
        actions,
    };
}

function keysResource(intl: IntlShape): ResourceInput {
    const { m, options, field } = messages(intl);
    return {
        id: 'keys',
        label: { singular: m('keys.singular'), plural: m('keys.plural') },
        icon: 'key-round',
        itemTitle: 'name',
        abilities: { viewAny: true, create: true },
        fields: [
            field('keys', 'name', 'text', { placeholder: m('keys.namePlaceholder') }),
            field('keys', 'prefix', 'text', { readOnly: true }),
            field('keys', 'scopes', 'select', {
                multiple: true,
                options: options('scopes', ['jobs:read', 'jobs:write', 'presets:write']),
                help: m('keys.help.scopes'),
            }),
            field('keys', 'status', 'select', {
                readOnly: true,
                options: options('status', ['active', 'revoked']),
                display: 'eclair-status',
            }),
            field('keys', 'lastUsedAt', 'datetime', { readOnly: true }),
            field('keys', 'createdAt', 'datetime', { readOnly: true }),
        ],
        list: {
            columns: [
                { field: 'name' },
                { field: 'prefix', display: 'eclair-code' },
                { field: 'scopes' },
                { field: 'lastUsedAt' },
                { field: 'createdAt' },
                { field: 'status' },
            ],
            perPage: 50,
            defaultSort: '-createdAt',
        },
        actions: [
            {
                id: 'revoke',
                label: m('keys.actions.revoke'),
                icon: 'ban',
                scope: ['item'],
                placement: ['row'],
                destructive: true,
                confirm: {
                    title: m('keys.actions.revokeTitle'),
                    message: m('keys.actions.revokeMessage'),
                    confirmLabel: m('keys.actions.revoke'),
                },
            },
        ],
    };
}

function storagesResource(intl: IntlShape): ResourceInput {
    const { m, options, field } = messages(intl);
    const s3 = { field: 'kind', equals: 's3' };
    return {
        id: 'storages',
        label: { singular: m('storages.singular'), plural: m('storages.plural') },
        icon: 'hard-drive',
        itemTitle: 'name',
        abilities: { viewAny: true, create: true },
        fields: [
            field('storages', 'name', 'text', {
                placeholder: 'media',
                help: m('storages.help.name'),
                rules: [{ rule: 'required' }, { rule: 'pattern', value: STORAGE_NAME }],
            }),
            field('storages', 'kind', 'select', {
                options: options('storages.kinds', ['s3', 'http']),
                default: 's3',
                rules: [{ rule: 'required' }],
                settings: { widget: 'radios' },
            }),
            field('storages', 'location', 'text', { readOnly: true, display: 'eclair-code' }),
            field('storages', 'bucket', 'text', {
                visibleWhen: s3,
                rules: [{ rule: 'required' }],
            }),
            field('storages', 'region', 'text', { visibleWhen: s3, placeholder: 'us-east-1' }),
            field('storages', 'endpoint', 'url', {
                visibleWhen: s3,
                placeholder: 'https://tor1.digitaloceanspaces.com',
            }),
            field('storages', 'prefix', 'text', { visibleWhen: s3 }),
            field('storages', 'accessKeyId', 'text', { visibleWhen: s3 }),
            // Shown as it is typed: text fields have no secret mode yet,
            // https://github.com/folkloreinc/panneau-js/issues/143
            field('storages', 'secretAccessKey', 'text', { visibleWhen: s3 }),
            field('storages', 'forcePathStyle', 'boolean', { visibleWhen: s3 }),
            field('storages', 'url', 'url', {
                visibleWhen: { field: 'kind', equals: 'http' },
                help: m('storages.help.url'),
                rules: [{ rule: 'required' }],
            }),
            field('storages', 'updatedAt', 'datetime', { readOnly: true }),
        ],
        list: {
            columns: [
                { field: 'name' },
                { field: 'kind' },
                { field: 'location' },
                { field: 'updatedAt' },
            ],
            perPage: 50,
            defaultSort: 'name',
        },
        actions: [
            {
                id: 'check',
                label: m('storages.actions.check'),
                icon: 'plug-zap',
                scope: ['item'],
                placement: ['row'],
            },
            {
                id: 'remove',
                label: m('storages.actions.remove'),
                icon: 'trash-2',
                scope: ['item'],
                placement: ['row'],
                destructive: true,
                confirm: {
                    title: m('storages.actions.removeTitle'),
                    message: m('storages.actions.removeMessage'),
                    confirmLabel: m('storages.actions.remove'),
                },
            },
        ],
    };
}

function presetsResource(intl: IntlShape): ResourceInput {
    const { m, field } = messages(intl);
    return {
        id: 'presets',
        label: { singular: m('presets.singular'), plural: m('presets.plural') },
        description: m('presets.description'),
        icon: 'layers',
        itemTitle: 'name',
        itemSubtitle: 'description',
        abilities: { viewAny: true, create: true },
        fields: [
            field('presets', 'name', 'text', {
                createOnly: true,
                placeholder: 'mediatheque/video',
                help: m('presets.help.name'),
                rules: [{ rule: 'required' }, { rule: 'pattern', value: PRESET_NAME }],
            }),
            field('presets', 'revision', 'number', { readOnly: true }),
            field('presets', 'description', 'textarea'),
            field('presets', 'tasks', 'json', {
                help: m('presets.help.tasks'),
                rules: [{ rule: 'required' }],
            }),
        ],
        form: {
            layout: [
                {
                    type: 'component',
                    component: 'eclair-item-actions',
                    props: { resource: 'presets', idField: 'name' },
                },
                { type: 'field', name: 'name' },
                { type: 'field', name: 'revision' },
                { type: 'field', name: 'description' },
                { type: 'field', name: 'tasks' },
            ],
        },
        list: {
            columns: [
                { field: 'name' },
                { field: 'description' },
                {
                    id: 'operations',
                    label: m('presets.columns.operations'),
                    display: 'eclair-code',
                },
                { field: 'revision', align: 'end' },
            ],
            perPage: 50,
            defaultSort: 'name',
            search: true,
        },
        actions: [
            {
                id: 'delete',
                label: m('presets.actions.delete'),
                icon: 'trash-2',
                scope: ['item'],
                placement: ['form'],
                destructive: true,
                confirm: {
                    title: m('presets.actions.deleteTitle'),
                    message: m('presets.actions.deleteMessage'),
                    confirmLabel: m('presets.actions.delete'),
                },
            },
        ],
    };
}

const JOB_STATUSES = ['running', 'pending', 'completed', 'failed', 'canceled'] as const;

function jobsResource(
    intl: IntlShape,
    projects: DefinitionOptions['projects'] = [],
): ResourceInput {
    const { m, options, field } = messages(intl);
    return {
        id: 'jobs',
        label: { singular: m('jobs.singular'), plural: m('jobs.plural') },
        description: m('jobs.description'),
        icon: 'list',
        itemTitle: 'id',
        abilities: { viewAny: true, create: false },
        fields: [
            field('jobs', 'id', 'text', { readOnly: true, display: 'eclair-code' }),
            field('jobs', 'project', 'select', {
                readOnly: true,
                options: projects.map(({ slug, name }) => ({ value: slug, label: name })),
                display: 'text',
            }),
            field('jobs', 'status', 'select', {
                readOnly: true,
                options: options('jobs.statuses', JOB_STATUSES),
                display: 'eclair-status',
            }),
            field('jobs', 'tasks', 'json', { readOnly: true, display: 'eclair-tasks' }),
            field('jobs', 'what', 'text', { readOnly: true, display: 'eclair-code' }),
            field('jobs', 'metadata', 'text', { readOnly: true, display: 'eclair-code' }),
            field('jobs', 'duration', 'duration', { readOnly: true }),
            field('jobs', 'createdAt', 'datetime', { readOnly: true }),
        ],
        list: {
            columns: [
                { field: 'id' },
                { field: 'project' },
                { field: 'status' },
                { field: 'tasks' },
                { field: 'what' },
                { field: 'metadata' },
                { field: 'duration', align: 'end' },
                { field: 'createdAt', align: 'end' },
            ],
            filters: [
                {
                    id: 'status',
                    type: 'select',
                    label: m('jobs.fields.status'),
                    options: options('jobs.statuses', JOB_STATUSES),
                    multiple: true,
                },
                {
                    id: 'project',
                    type: 'select',
                    label: m('jobs.fields.project'),
                    options: projects.map(({ slug, name }) => ({ value: slug, label: name })),
                },
                { id: 'operation', type: 'text', label: m('jobs.filters.operation') },
                { id: 'created', type: 'date-range', label: m('jobs.fields.createdAt') },
            ],
            // The newest first, always: the admin API pages jobs with a cursor.
            sorts: [],
            search: true,
            perPage: 50,
        },
        actions: [
            {
                id: 'open',
                label: m('jobs.actions.open'),
                icon: 'external-link',
                kind: 'link',
                scope: ['item'],
                placement: ['row'],
                url: `${BASE_PATH}/pages/job?id={id}`,
            },
            {
                id: 'cancel',
                label: m('jobs.actions.cancel'),
                icon: 'circle-off',
                scope: ['item'],
                placement: ['row'],
                destructive: true,
                confirm: {
                    title: m('jobs.actions.cancelTitle'),
                    message: m('jobs.actions.cancelMessage'),
                    confirmLabel: m('jobs.actions.cancelConfirm'),
                },
            },
            {
                id: 'retry',
                label: m('jobs.actions.retry'),
                icon: 'rotate-ccw',
                scope: ['item'],
                placement: ['row'],
            },
        ],
    };
}

/**
 * The dashboard's definition: Eclair implements no Panneau protocol, so the definition is static,
 * in the operator's locale, and the adapter maps it onto the admin API (decision 0021).
 */
export function createDefinition({
    intl,
    locale,
    baseUrl,
    user,
    projects,
}: DefinitionOptions): DefinitionInput {
    return {
        protocol: 1,
        name: t(intl, 'app.name'),
        locale,
        locales: [locale],
        api: { baseUrl },
        resources: [
            jobsResource(intl, projects),
            projectsResource(intl),
            keysResource(intl),
            storagesResource(intl),
            presetsResource(intl),
        ],
        pages: {
            overview: { component: 'eclair-overview', label: t(intl, 'overview.title') },
            job: { component: 'eclair-job', label: t(intl, 'job.title') },
            usage: { component: 'eclair-usage', label: t(intl, 'usage.title') },
            'sign-out': { component: 'eclair-sign-out', label: t(intl, 'signOut.label') },
        },
        menus: {
            // Keys and storages are on the page of their project, a job on its own page.
            main: [
                { type: 'page', page: 'overview', icon: 'layout-dashboard' },
                { type: 'resource', resource: 'jobs' },
                { type: 'resource', resource: 'projects' },
                { type: 'page', page: 'usage', icon: 'chart-line' },
                { type: 'resource', resource: 'presets' },
                { type: 'separator' },
                { type: 'page', page: 'sign-out', icon: 'log-out' },
            ],
        },
        // Signing in is the dashboard's own page: the admin token (decision 0021).
        auth: { mode: 'panneau', password: false },
        search: { enabled: false },
        user,
    };
}
