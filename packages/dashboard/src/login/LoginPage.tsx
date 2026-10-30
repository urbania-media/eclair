import { type DataAdapter, UnauthorizedError } from '@panneau/data';
import { Alert, Button, Card, Heading, Icon, Stack, Text, TextInput } from '@panneau/ui';
import { Zap } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

import type { MessageId } from '../messages/index.ts';
import styles from './LoginPage.module.css';

export type LoginNotice = 'sessionEnded' | 'signedOut';

export interface LoginPageProps {
    adapter: DataAdapter;
    /** Why the login page shows: the server refused the token, or the operator signed out. */
    notice?: LoginNotice | null;
}

/**
 * Signing in to the dashboard: the operator pastes the server's admin token. Panneau 5 has no
 * login page for a backend whose sign-in isn't an email and a password yet, so the dashboard has
 * its own, in Panneau's components: https://github.com/folkloreinc/panneau-js/issues/136
 */
export function LoginPage({ adapter, notice = null }: LoginPageProps) {
    const intl = useIntl();
    const message = (id: MessageId, values?: Record<string, string>) =>
        intl.formatMessage({ id }, values);
    const [token, setToken] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const title = message('login.title');
    useEffect(() => {
        document.title = title;
    }, [title]);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
            // The token is the password of Panneau's credentials: the adapter keeps it once the
            // server accepts it, and the app then shows the dashboard.
            await adapter.login({ email: '', password: token });
        } catch (caught) {
            setError(
                caught instanceof UnauthorizedError
                    ? message('login.invalid')
                    : message('login.error', {
                          message: caught instanceof Error ? caught.message : String(caught),
                      }),
            );
            setPending(false);
        }
    };

    return (
        <main className={styles.page}>
            <Card className={styles.card}>
                <form onSubmit={(event) => void submit(event)}>
                    <Stack gap={4}>
                        <div className={styles.brand}>
                            <Icon icon={Zap} />
                            <Heading level={1} size={3}>
                                {title}
                            </Heading>
                        </div>
                        {notice !== null ? (
                            <Alert
                                tone={notice === 'sessionEnded' ? 'warning' : 'info'}
                                role="status"
                            >
                                {message(
                                    notice === 'sessionEnded'
                                        ? 'login.sessionEnded'
                                        : 'login.signedOut',
                                )}
                            </Alert>
                        ) : null}
                        <Text as="p" muted>
                            {intl.formatMessage(
                                { id: 'login.intro' },
                                {
                                    code: (chunks) => <code className={styles.code}>{chunks}</code>,
                                },
                            )}
                        </Text>
                        <TextInput
                            label={message('login.token')}
                            type="password"
                            name="token"
                            autoComplete="current-password"
                            autoFocus
                            isRequired
                            value={token}
                            onChange={setToken}
                            errors={error !== null ? [error] : undefined}
                        />
                        <Button type="submit" variant="primary" isPending={pending} fullWidth>
                            {message('login.submit')}
                        </Button>
                    </Stack>
                </form>
            </Card>
        </main>
    );
}
