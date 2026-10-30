import { type Form as FormStore, useResource } from '@panneau/core';
import { useCreateItem } from '@panneau/data/query';
import { Form } from '@panneau/forms';
import { Alert, Button, Dialog, Stack, Text } from '@panneau/ui';
import { Check, Copy, Plus } from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';

import { DialogForm } from './DialogForm.tsx';
import { ProjectList } from './ProjectList.tsx';
import styles from './project.module.css';
import { useProjectSlug } from './useProject.ts';

/** Copies a text, and says so for a moment. */
export function CopyButton({ text }: { text: string }) {
    const intl = useIntl();
    const [copied, setCopied] = useState(false);
    return (
        <Button
            size="sm"
            icon={copied ? Check : Copy}
            onPress={() => {
                void navigator.clipboard.writeText(text).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2000);
                });
            }}
        >
            {intl.formatMessage({ id: copied ? 'webhook.copied' : 'webhook.copy' })}
        </Button>
    );
}

function NewKey({ project }: { project: string }) {
    const intl = useIntl();
    const { form } = useResource('keys');
    const create = useCreateItem('keys');
    const [open, setOpen] = useState(false);
    const [token, setToken] = useState<string | null>(null);
    const close = () => {
        setOpen(false);
        setToken(null);
    };
    return (
        <>
            <Button size="sm" icon={Plus} onPress={() => setOpen(true)}>
                {intl.formatMessage({ id: 'keys.new' })}
            </Button>
            <Dialog
                title={intl.formatMessage({ id: 'keys.new' })}
                isOpen={open}
                onOpenChange={(isOpen) => (isOpen ? setOpen(true) : close())}
                // The key is shown once: the dialog stays until the operator says they copied it.
                isDismissable={token === null}
                isKeyboardDismissDisabled={token !== null}
            >
                {token === null ? (
                    <DialogForm>
                        <Form
                            aria-label={intl.formatMessage({ id: 'keys.new' })}
                            fields={form.fields.filter((field) => !field.readOnly)}
                            mode="create"
                            submitLabel={intl.formatMessage({ id: 'keys.create' })}
                            onSubmit={async (values) => {
                                const item = await create.mutateAsync({ ...values, project });
                                setToken(typeof item.token === 'string' ? item.token : '');
                                return item;
                            }}
                        />
                    </DialogForm>
                ) : (
                    <Stack gap={4}>
                        <Alert tone="warning">{intl.formatMessage({ id: 'keys.created' })}</Alert>
                        <div className={styles.secret}>
                            <code className={styles.secretValue}>{token}</code>
                            <CopyButton text={token} />
                        </div>
                        <Button variant="primary" onPress={close}>
                            {intl.formatMessage({ id: 'keys.done' })}
                        </Button>
                    </Stack>
                )}
            </Dialog>
        </>
    );
}

/** The API keys of the project, in its page: create one, shown once, or revoke one. */
export function ProjectKeys({ form }: { form: FormStore }) {
    const intl = useIntl();
    const project = useProjectSlug(form);
    if (project === null) {
        return <Text muted>{intl.formatMessage({ id: 'project.newFirst' })}</Text>;
    }
    return <ProjectList resource="keys" project={project} actions={<NewKey project={project} />} />;
}
