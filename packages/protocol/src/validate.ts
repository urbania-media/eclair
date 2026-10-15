import addFormatsModule from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js';

import { jsonSchema } from './document.ts';
import type { components } from './generated/openapi.ts';
import { JSON_SCHEMA_ID } from './version.ts';

type Schemas = components['schemas'];

export type SchemaName = keyof Schemas;

export interface ValidationError {
    /** JSON pointer to the invalid value (`/tasks/h264/op`). The empty string is the value itself. */
    pointer: string;
    message: string;
}

export type ValidationResult<T> =
    { valid: true; value: T } | { valid: false; errors: ValidationError[] };

// ajv-formats is CommonJS: its default export is under `default`.
const addFormats = addFormatsModule as unknown as typeof addFormatsModule.default;

let ajv: Ajv2020 | undefined;
const validators = new Map<SchemaName, ValidateFunction>();

function getValidator(name: SchemaName): ValidateFunction {
    let validator = validators.get(name);
    if (validator === undefined) {
        if (ajv === undefined) {
            ajv = new Ajv2020({ allErrors: true });
            addFormats(ajv);
            ajv.addSchema(jsonSchema);
        }
        validator = ajv.compile({ $ref: `${JSON_SCHEMA_ID}#/$defs/${name}` });
        validators.set(name, validator);
    }
    return validator;
}

function escapePointerToken(token: string): string {
    return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Points at the missing or unexpected property itself rather than at its parent object. */
function toValidationError(error: ErrorObject): ValidationError {
    const params = error.params as Record<string, unknown>;
    const property =
        params['missingProperty'] ?? params['additionalProperty'] ?? params['propertyName'];
    const pointer =
        typeof property === 'string'
            ? `${error.instancePath}/${escapePointerToken(property)}`
            : error.instancePath;
    return { pointer, message: error.message ?? 'is invalid' };
}

/**
 * Validates a value against one of the protocol's schemas (`JobRequest`, `PresetRequest`…). It
 * doesn't change the value: defaults are not applied.
 */
export function validate<N extends SchemaName>(
    name: N,
    value: unknown,
): ValidationResult<Schemas[N]> {
    const validator = getValidator(name);
    if (validator(value)) {
        return { valid: true, value: value as Schemas[N] };
    }
    const errors = (validator.errors ?? []).map(toValidationError);
    const unique = new Map(errors.map((error) => [`${error.pointer}\n${error.message}`, error]));
    return { valid: false, errors: [...unique.values()] };
}

/** Groups validation errors by pointer, as in the `errors` member of a `Problem`. */
export function toProblemErrors(errors: ValidationError[]): Record<string, string[]> {
    const grouped: Record<string, string[]> = {};
    for (const { pointer, message } of errors) {
        (grouped[pointer] ??= []).push(message);
    }
    return grouped;
}
