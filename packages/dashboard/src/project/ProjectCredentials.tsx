import { type Form as FormStore, useResource } from '@panneau/core';
import { useCreateItem } from '@panneau/data/query';
import { Form } from '@panneau/forms';
import { Button, Dialog, Text } from '@panneau/ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';

import { ProjectList } from './ProjectList.tsx';
import { useProjectSlug } from './useProject.ts';

function AddCredentials({ project }: { project: string }) {
    const intl = useIntl();
    const { form } = useResource('credentials');
    const create = useCreateItem('credentials');
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button size="sm" icon={Plus} onPress={() => setOpen(true)}>
                {intl.formatMessage({ id: 'credentials.add' })}
            </Button>
            <Dialog
                title={intl.formatMessage({ id: 'credentials.add' })}
                isOpen={open}
                onOpenChange={setOpen}
                size="md"
            >
                <Text as="p" muted>
                    {intl.formatMessage({ id: 'credentials.encrypted' })}
                </Text>
                <Form
                    aria-label={intl.formatMessage({ id: 'credentials.add' })}
                    fields={form.fields.filter((field) => !field.readOnly)}
                    mode="create"
                    submitLabel={intl.formatMessage({ id: 'credentials.save' })}
                    onSubmit={(values) => create.mutateAsync({ ...values, project })}
                    onSubmitted={() => setOpen(false)}
                />
            </Dialog>
        </>
    );
}

/** The project's credentials for embed providers, in its page, without their values. */
export function ProjectCredentials({ form }: { form: FormStore }) {
    const intl = useIntl();
    const project = useProjectSlug(form);
    if (project === null) {
        return null;
    }
    return (
        <ProjectList
            resource="credentials"
            project={project}
            actions={<AddCredentials project={project} />}
        >
            <Text as="p" size="sm" muted>
                {intl.formatMessage({ id: 'credentials.fallback' })}
            </Text>
        </ProjectList>
    );
}
