import { Heading, Text } from '@panneau/ui';
import { type ReactNode, useEffect } from 'react';

import styles from './pages.module.css';

export interface PageLayoutProps {
    title: string;
    intro?: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
}

/**
 * The frame of a plugin page, as Panneau draws its resource pages: `@panneau/app` doesn't export
 * its page header and layout yet, https://github.com/folkloreinc/panneau-js/issues/145
 */
export function PageLayout({ title, intro, actions, children }: PageLayoutProps) {
    useEffect(() => {
        document.title = `${title} · Eclair`;
    }, [title]);
    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <div className={styles.headerTitle}>
                    <Heading level={1}>{title}</Heading>
                    {intro !== undefined ? (
                        <Text as="p" muted>
                            {intro}
                        </Text>
                    ) : null}
                </div>
                {actions !== undefined ? (
                    <div className={styles.headerActions}>{actions}</div>
                ) : null}
            </header>
            {children}
        </div>
    );
}
