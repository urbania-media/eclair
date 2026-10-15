import { PROTOCOL_VERSION } from '@eclair-js/protocol';

/** Builds the URL of an API endpoint: `apiUrl('https://eclair.test', '/jobs')`. */
export function apiUrl(baseUrl: string, path: string): string {
    const base = baseUrl.replace(/\/+$/, '');
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${base}/${PROTOCOL_VERSION}${suffix}`;
}
