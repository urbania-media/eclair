import { useActionRunner } from '@panneau/actions';
import { useList, useResource } from '@panneau/core';
import { useResourceList } from '@panneau/data/query';
import { ListView, getPagingProps } from '@panneau/lists';
import { Card } from '@panneau/ui';
import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';

export interface ProjectListProps {
    /** `keys` or `storages`. */
    resource: string;
    project: string;
    actions?: ReactNode;
    children?: ReactNode;
}

/**
 * A list of a resource of the project, in its page: its query stays in memory, since the page's URL
 * is the project's, and its actions run through Panneau's action runner.
 */
export function ProjectList({ resource: id, project, actions, children }: ProjectListProps) {
    const intl = useIntl();
    const { resource, list: definitionList } = useResource(id);
    const { query, list } = useList({ list: definitionList, router: null });
    const { data, error, isFetching, refetch } = useResourceList(
        id,
        { ...query, filter: { ...query.filter, project } },
        { placeholderData: (previous) => previous },
    );
    const runAction = useActionRunner(id);
    const title = resource.label.plural;
    return (
        <Card
            title={title.charAt(0).toLocaleUpperCase(intl.locale) + title.slice(1)}
            headingLevel={3}
            actions={actions}
        >
            <ListView
                {...definitionList}
                aria-label={title}
                list={list}
                items={data?.data}
                {...(data !== undefined ? getPagingProps(data.meta) : {})}
                isLoading={isFetching}
                error={error}
                onRetry={() => void refetch()}
                fields={resource.fields}
                itemTitle={resource.itemTitle}
                layouts={['table']}
                selectable={false}
                onAction={runAction}
            />
            {children}
        </Card>
    );
}
