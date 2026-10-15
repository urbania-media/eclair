import addFormatsModule from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { Options } from 'ajv/dist/2020.js';

// ajv-formats is CommonJS: its default export is under `default`.
const addFormats = addFormatsModule as unknown as typeof addFormatsModule.default;

/**
 * Creates an Ajv instance with the options of decision 0015: JSON Schema 2020-12, every error at
 * once and defaults applied. It is the only validator in the server: configuration, routes and
 * operation options.
 */
export function createAjv(options: Options = {}): Ajv2020 {
    const ajv = new Ajv2020({ allErrors: true, useDefaults: true, strict: false, ...options });
    addFormats(ajv);
    return ajv;
}
