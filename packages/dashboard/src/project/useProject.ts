import type { Form } from '@panneau/core';
import { useFormState } from '@panneau/forms';

/**
 * The slug of the project of a form, for the components of its layout: `null` while it is being
 * created. The slug is `createOnly`, so it is in the form's values once the project exists.
 */
export function useProjectSlug(form: Form): string | null {
    const { initialValues } = useFormState(form);
    const slug = initialValues.slug;
    return typeof slug === 'string' && slug !== '' ? slug : null;
}
