import type { Form } from '@panneau/core';
import { useFormState } from '@panneau/forms';

/** A value of the form as it was loaded, as text: `null` when empty, such as while creating. */
export function useFormValue(form: Form, name: string): string | null {
    const { initialValues } = useFormState(form);
    const value = initialValues[name];
    return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * The slug of the project of a form, for the components of its layout: `null` while it is being
 * created. The slug is `createOnly`, so it is in the form's values once the project exists.
 */
export function useProjectSlug(form: Form): string | null {
    return useFormValue(form, 'slug');
}
