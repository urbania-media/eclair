import { Spinner, Stack, Text } from '@panneau/ui';
import { useEffect } from 'react';
import { useIntl } from 'react-intl';

import { useSignOut } from '../session.tsx';

/**
 * Signs out when it opens: the shell of Panneau 5 has no sign-out yet, so the menu links to this
 * page: https://github.com/folkloreinc/panneau-js/issues/137
 */
export function SignOutPage() {
    const intl = useIntl();
    const signOut = useSignOut();
    useEffect(() => {
        signOut();
    }, [signOut]);
    return (
        <Stack gap={2} align="center" role="status">
            <Spinner />
            <Text>{intl.formatMessage({ id: 'signOut.pending' })}</Text>
        </Stack>
    );
}
