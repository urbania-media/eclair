import { type Form as FormStore, useResource } from '@panneau/core';
import { useCreateItem } from '@panneau/data/query';
import { Form } from '@panneau/forms';
import { Button, Dialog, Text } from '@panneau/ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';

import { ProjectList } from './ProjectList.tsx';
import { useProjectSlug } from './useProject.ts';

function AddStorage({ project }: { project: string }) {
    const intl = useIntl();
    const { form } = useResource('storages');
    const create = useCreateItem('storages');
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button size="sm" icon={Plus} onPress={() => setOpen(true)}>
                {intl.formatMessage({ id: 'storages.add' })}
            </Button>
            <Dialog
                title={intl.formatMessage({ id: 'storages.add' })}
                isOpen={open}
                onOpenChange={setOpen}
                size="md"
            >
                <Text as="p" muted>
                    {intl.formatMessage({ id: 'storages.credentials' })}
                </Text>
                <Form
                    aria-label={intl.formatMessage({ id: 'storages.add' })}
                    fields={form.fields.filter((field) => !field.readOnly)}
                    mode="create"
                    submitLabel={intl.formatMessage({ id: 'storages.save' })}
                    onSubmit={(values) => create.mutateAsync({ ...values, project })}
                    onSubmitted={() => setOpen(false)}
                />
            </Dialog>
        </>
    );
}

/** The storages of the project, in its page, without their credentials. */
export function ProjectStorages({ form }: { form: FormStore }) {
    const intl = useIntl();
    const project = useProjectSlug(form);
    if (project === null) {
        return null;
    }
    return (
        <ProjectList
            resource="storages"
            project={project}
            actions={<AddStorage project={project} />}
        >
            <Text as="p" size="sm" muted>
                {intl.formatMessage({ id: 'storages.temporary' })}
            </Text>
        </ProjectList>
    );
}
