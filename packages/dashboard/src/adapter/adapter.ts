import type { ActionResponse, DataAdapter, LoginCredentials, Values } from '@panneau/data';
import {
    type Definition,
    type Item,
    type ListQuery,
    type ListResponse,
    type Session,
    validateDefinition,
} from '@panneau/protocol';
import type { IntlShape } from 'react-intl';

import type { AdminProjectList } from '@eclair-js/protocol';

import { createDefinition } from '../definition.ts';
import { type Locale, createMessages, t } from '../messages/index.ts';
import { type AdminClient, createAdminClient, notFound, unauthorized } from './client.ts';
import type { TokenStore } from './token.ts';

/** What the handlers of resources and widgets get. */
export interface HandlerContext {
    client: AdminClient;
    intl: IntlShape;
    signal?: AbortSignal | undefined;
}

/**
 * How a resource of the definition maps onto the admin API. A method left out answers `404`, as
 * a route the server doesn't have.
 */
export interface ResourceHandler {
    list?(query: ListQuery, context: HandlerContext): Promise<ListResponse>;
    get?(id: string, context: HandlerContext): Promise<Item>;
    create?(values: Values, context: HandlerContext): Promise<Item>;
    update?(id: string, values: Values, context: HandlerContext): Promise<Item>;
    delete?(id: string, context: HandlerContext): Promise<void>;
    runAction?(
        action: string,
        request: Parameters<DataAdapter['runAction']>[2],
        context: HandlerContext,
    ): Promise<ActionResponse>;
}

/**
 * The data of a plugin page, by name: `getWidgetData('usage?days=30')` calls the `usage` widget
 * with its query string. The pages of the overview, a job and usage read their data this way,
 * through the adapter, until Panneau has dashboard widgets (decision 0021).
 */
export type WidgetHandler = (params: URLSearchParams, context: HandlerContext) => Promise<unknown>;

export interface EclairAdapterOptions {
    /** Where the admin token is kept. */
    tokens: TokenStore;
    /** The locale of the definition's labels. */
    locale: Locale;
    /** The URL of the admin API. Defaults to `/admin/v1`, on the dashboard's origin. */
    baseUrl?: string;
    resources?: Record<string, ResourceHandler>;
    widgets?: Record<string, WidgetHandler>;
    fetch?: typeof globalThis.fetch;
}

/**
 * The `DataAdapter` of the dashboard: Panneau's calls mapped onto Eclair's admin API (`/admin/v1`),
 * with the admin token as a bearer token. Eclair implements no Panneau protocol: the definition is
 * built here, and lists that the admin API answers whole are paged here.
 */
export function createEclairAdapter({
    tokens,
    locale,
    baseUrl = '/admin/v1',
    resources = {},
    widgets = {},
    fetch,
}: EclairAdapterOptions): DataAdapter {
    const client = createAdminClient({
        baseUrl,
        getToken: () => tokens.get(),
        ...(fetch !== undefined ? { fetch } : {}),
    });
    const intl = createMessages(locale);
    const context = (signal?: AbortSignal): HandlerContext => ({ client, intl, signal });
    const handler = (resource: string) => {
        const found = resources[resource];
        if (found === undefined) {
            throw notFound(`The dashboard has no resource "${resource}".`);
        }
        return found;
    };
    const missing = (resource: string, method: string) =>
        notFound(`The resource "${resource}" can't ${method}.`);

    const session = (): Session => ({
        user: { id: 'admin', name: t(intl, 'session.user') },
    });
    // Any admin route checks the token; the list of projects is a short one.
    const check = (token: string | undefined, signal?: AbortSignal) =>
        client.request<AdminProjectList>('/projects', {
            signal,
            ...(token !== undefined ? { token } : {}),
        });

    const getSession = async (signal?: AbortSignal): Promise<Session> => {
        if (tokens.get() === null) {
            throw unauthorized();
        }
        await check(undefined, signal);
        return session();
    };

    return {
        async getDefinition({ signal } = {}): Promise<Definition> {
            const { user } = await getSession(signal);
            const result = validateDefinition(createDefinition({ intl, locale, baseUrl, user }));
            if (!result.success) {
                const issues = result.issues.map(({ path, message }) => `${path}: ${message}`);
                throw new Error(`The dashboard's definition is invalid:\n${issues.join('\n')}`);
            }
            return result.data;
        },

        async list(resource, query = {}, { signal } = {}) {
            const found = handler(resource);
            if (found.list === undefined) {
                throw missing(resource, 'be listed');
            }
            return found.list(query, context(signal));
        },
        async get(resource, id, { signal } = {}) {
            const found = handler(resource);
            if (found.get === undefined) {
                throw missing(resource, 'show an item');
            }
            return found.get(id, context(signal));
        },
        async create(resource, values, { signal } = {}) {
            const found = handler(resource);
            if (found.create === undefined) {
                throw missing(resource, 'create items');
            }
            return found.create(values, context(signal));
        },
        async update(resource, id, values, { signal } = {}) {
            const found = handler(resource);
            if (found.update === undefined) {
                throw missing(resource, 'update items');
            }
            return found.update(id, values, context(signal));
        },
        async delete(resource, id, { signal } = {}) {
            const found = handler(resource);
            if (found.delete === undefined) {
                throw missing(resource, 'delete items');
            }
            return found.delete(id, context(signal));
        },

        async runAction(resource, action, request, { signal } = {}) {
            const found = handler(resource);
            if (found.runAction === undefined) {
                throw notFound(`The resource "${resource}" has no action "${action}".`);
            }
            return found.runAction(action, request, context(signal));
        },
        // Eclair's actions answer at once: there are no queued runs.
        async getActionRun(id) {
            throw notFound(`There is no action run "${id}".`);
        },
        async listActionRuns() {
            return [];
        },
        async cancelActionRun(id) {
            throw notFound(`There is no action run "${id}".`);
        },

        getSession: ({ signal } = {}) => getSession(signal),
        /**
         * Signs in with the admin token, as the `password` of the credentials: it is kept once the
         * server accepts it. Rejects with an `UnauthorizedError` when it refuses it.
         */
        // A token, not an email and a password: https://github.com/folkloreinc/panneau-js/issues/136
        async login(credentials: LoginCredentials, { signal } = {}) {
            const token = credentials.password.trim();
            if (token === '') {
                throw unauthorized();
            }
            await check(token, signal);
            tokens.set(token);
            return session();
        },
        async logout() {
            tokens.clear();
        },

        async search() {
            return { data: [] };
        },
        async getWidgetData(widget, { signal } = {}) {
            const [name = '', search = ''] = widget.split('?', 2);
            const found = widgets[name];
            if (found === undefined) {
                throw notFound(`The dashboard has no widget "${name}".`);
            }
            return found(new URLSearchParams(search), context(signal));
        },
    };
}
