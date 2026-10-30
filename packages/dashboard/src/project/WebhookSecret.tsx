import type { Form as FormStore } from '@panneau/core';
import { useDataAdapter } from '@panneau/data/query';
import { Alert, Button, Dialog, Select, Text } from '@panneau/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';

import type { WebhookSecret as Secret } from '@eclair-js/protocol';

import { CopyButton } from './ProjectKeys.tsx';
import styles from './project.module.css';
import { useProjectSlug } from './useProject.ts';

const GRACES = [86400, 3600, 604800, 0] as const;

/**
 * The webhook secret of the project, in its page: shown on demand, and changed with a grace
 * period, while the previous secret signs webhooks too.
 */
export function WebhookSecret({ form }: { form: FormStore }) {
    const intl = useIntl();
    const project = useProjectSlug(form);
    const adapter = useDataAdapter();
    const queryClient = useQueryClient();
    const [shown, setShown] = useState(false);
    const [grace, setGrace] = useState<number>(86400);
    const [confirming, setConfirming] = useState(false);
    const [pending, setPending] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const [rotated, setRotated] = useState(false);
    const key = ['eclair', 'webhook-secret', project];
    const secret = useQuery({
        queryKey: key,
        queryFn: ({ signal }) =>
            adapter.getWidgetData(`webhook-secret?project=${encodeURIComponent(project ?? '')}`, {
                signal,
            }) as Promise<Secret>,
        enabled: project !== null && shown,
    });
    if (project === null) {
        return null;
    }
    const rotate = async () => {
        setPending(true);
        setFailure(null);
        try {
            const { result } = await adapter.runAction('projects', 'rotate-webhook-secret', {
                selection: { ids: [project] },
                values: { grace },
            });
            queryClient.setQueryData(key, result as unknown as Secret);
            setShown(true);
            setRotated(true);
            setConfirming(false);
        } catch (error) {
            setFailure(error instanceof Error ? error.message : String(error));
        } finally {
            setPending(false);
        }
    };
    const value = secret.data?.webhookSecret;
    const expires = secret.data?.previousSecretExpiresAt;
    return (
        <div className={styles.webhook}>
            <Text weight="medium">{intl.formatMessage({ id: 'webhook.secret' })}</Text>
            <div className={styles.secret}>
                <code className={styles.secretValue}>
                    {shown && value !== undefined ? value : 'whsec_••••••••••••••••'}
                </code>
                <Button size="sm" onPress={() => setShown(!shown)} isPending={secret.isFetching}>
                    {intl.formatMessage({ id: shown ? 'webhook.hide' : 'webhook.show' })}
                </Button>
                {shown && value !== undefined ? <CopyButton text={value} /> : null}
            </div>
            {secret.isError ? (
                <Alert tone="danger">
                    {intl.formatMessage({ id: 'webhook.error' }, { message: secret.error.message })}
                </Alert>
            ) : null}
            {rotated ? (
                <Alert tone="success" role="status">
                    {intl.formatMessage({ id: 'webhook.rotated' })}
                </Alert>
            ) : null}
            {expires !== undefined ? (
                <Text as="p" size="sm" muted>
                    {intl.formatMessage(
                        { id: 'webhook.previousExpires' },
                        {
                            date: intl.formatDate(expires, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                            }),
                        },
                    )}
                </Text>
            ) : null}
            <div className={styles.rotate}>
                <Select
                    label={intl.formatMessage({ id: 'webhook.grace' })}
                    options={GRACES.map((seconds) => ({
                        value: String(seconds),
                        label: intl.formatMessage({ id: `webhook.grace.${seconds}` }),
                    }))}
                    value={String(grace)}
                    onChange={(selected) => setGrace(Number(selected))}
                />
                <Button icon={RefreshCw} onPress={() => setConfirming(true)}>
                    {intl.formatMessage({ id: 'webhook.rotate' })}
                </Button>
            </div>
            <Text as="p" size="sm" muted>
                {intl.formatMessage({ id: 'webhook.rotateHelp' })}
            </Text>
            <Dialog
                role="alertdialog"
                size="sm"
                isOpen={confirming}
                onOpenChange={setConfirming}
                title={intl.formatMessage({ id: 'webhook.rotate' })}
                footer={(close) => (
                    <>
                        <Button onPress={close}>
                            {intl.formatMessage({ id: 'common.cancel' })}
                        </Button>
                        <Button variant="primary" isPending={pending} onPress={() => void rotate()}>
                            {intl.formatMessage({ id: 'webhook.rotateConfirm' })}
                        </Button>
                    </>
                )}
            >
                <Text as="p">{intl.formatMessage({ id: 'webhook.rotateHelp' })}</Text>
                {failure !== null ? <Alert tone="danger">{failure}</Alert> : null}
            </Dialog>
        </div>
    );
}
