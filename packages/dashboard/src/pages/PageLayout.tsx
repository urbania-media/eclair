import { PageLayout as Layout, PageHeader } from '@panneau/app';
import { Text } from '@panneau/ui';
import type { ReactNode } from 'react';

export interface PageLayoutProps {
    title: string;
    intro?: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
}

/** A plugin page in the frame of Panneau's resource pages: its header, an intro, its content. */
export function PageLayout({ title, intro, actions, children }: PageLayoutProps) {
    return (
        <Layout>
            <PageHeader title={title} actions={actions} />
            {intro !== undefined ? (
                <Text as="p" muted>
                    {intro}
                </Text>
            ) : null}
            {children}
        </Layout>
    );
}
