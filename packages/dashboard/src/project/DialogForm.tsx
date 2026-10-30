import type { ReactNode } from 'react';

/**
 * Holds a form in a dialog of the project's page. The dialog is a portal, but React events still
 * bubble through it: without this, submitting the dialog's form submits the project's form too,
 * https://github.com/folkloreinc/panneau-js/issues/146
 */
export function DialogForm({ children }: { children: ReactNode }) {
    return <div onSubmit={(event) => event.stopPropagation()}>{children}</div>;
}
