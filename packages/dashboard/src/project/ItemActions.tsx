import { useActionRunner } from '@panneau/actions';
import { type Form as FormStore, isActionAllowedOn, useResource } from '@panneau/core';
import { useResourceItem } from '@panneau/data/query';
import { getActionHref } from '@panneau/lists';
import { Button, Icon, getNamedIcon } from '@panneau/ui';
import { Link } from 'react-aria-components';

import styles from './project.module.css';
import { useFormValue } from './useProject.ts';

export interface ItemActionsProps {
    form: FormStore;
    /** The resource of the form. */
    resource: string;
    /** The field that identifies the item in the admin API: a project's slug, a preset's name. */
    idField: string;
}

/**
 * The actions of an item placed in its form (`"placement": ["form"]`), at the top of its page.
 * Panneau's form page shows no actions yet: https://github.com/folkloreinc/panneau-js/issues/149
 */
export function ItemActions({ form, resource: id, idField }: ItemActionsProps) {
    const itemId = useFormValue(form, idField);
    const { list } = useResource(id);
    const { data: item } = useResourceItem(id, itemId);
    const runAction = useActionRunner(id);
    if (item === undefined) {
        return null;
    }
    const actions = list.actions.form.filter((action) => isActionAllowedOn(action, item));
    if (actions.length === 0) {
        return null;
    }
    return (
        <div className={styles.actions}>
            {actions.map((action) => {
                const icon =
                    action.icon !== undefined ? (
                        <Icon icon={getNamedIcon(action.icon)} size="sm" />
                    ) : null;
                if (action.kind === 'link') {
                    const href = getActionHref(action, item);
                    return href !== null ? (
                        <Link key={action.id} href={href} className={styles.actionLink}>
                            {icon}
                            {action.label}
                        </Link>
                    ) : null;
                }
                return (
                    <Button
                        key={action.id}
                        size="sm"
                        tone={action.destructive === true ? 'danger' : undefined}
                        icon={action.icon !== undefined ? getNamedIcon(action.icon) : undefined}
                        onPress={() =>
                            void runAction({ action, scope: 'item', item, count: 1 }).catch(
                                () => undefined,
                            )
                        }
                    >
                        {action.label}
                    </Button>
                );
            })}
        </div>
    );
}
