import { readFileSync } from 'node:fs';

/** The version of `@eclair-js/server`, which all Eclair packages and the image share. */
export const VERSION: string = (
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        version: string;
    }
).version;
