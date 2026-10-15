import addFormatsModule from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, Options } from 'ajv/dist/2020.js';

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

function escapePointerToken(token: string): string {
    return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Groups Ajv errors by JSON pointer, pointing at a missing or unexpected property itself. */
export function groupErrors(errors: ErrorObject[], base = ''): Record<string, string[]> {
    const grouped: Record<string, string[]> = {};
    for (const error of errors) {
        const params = error.params as Record<string, unknown>;
        const property = params['missingProperty'] ?? params['additionalProperty'];
        const pointer =
            base +
            (typeof property === 'string'
                ? `${error.instancePath}/${escapePointerToken(property)}`
                : error.instancePath);
        const messages = (grouped[pointer] ??= []);
        const message = error.message ?? 'is invalid';
        if (!messages.includes(message)) {
            messages.push(message);
        }
    }
    return grouped;
}

/** A value doesn't match its schema. `errors` lists the messages by JSON pointer. */
export class InvalidValueError extends Error {
    readonly errors: Record<string, string[]>;

    constructor(errors: Record<string, string[]>, message = 'The value is invalid.') {
        super(message);
        this.name = 'InvalidValueError';
        this.errors = errors;
    }
}

const sharedAjv = createAjv();

/**
 * Compiles a schema into a function that validates a value, applies the schema's defaults to a
 * copy of it and returns the copy. Throws an `InvalidValueError`.
 */
export function createValidator<T>(schema: object): (value: unknown, base?: string) => T {
    const validate = sharedAjv.compile(schema);
    return (value, base = '') => {
        const copy: unknown = value === undefined ? undefined : structuredClone(value);
        if (!validate(copy)) {
            throw new InvalidValueError(groupErrors(validate.errors ?? [], base));
        }
        return copy as T;
    };
}
