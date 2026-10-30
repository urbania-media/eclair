/** The dashboard's messages in English, the source of the message ids. ICU message syntax. */
export const en = {
    'app.name': 'Eclair',
    'session.user': 'Admin token',

    'login.title': 'Sign in to Eclair',
    'login.intro':
        "Paste the server's admin token, <code>ECLAIR_ADMIN_TOKEN</code>. It stays in this tab only, until you close it or sign out.",
    'login.token': 'Admin token',
    'login.submit': 'Sign in',
    'login.invalid': "This isn't the server's admin token.",
    'login.error': "The server didn't answer: {message}",
    'login.sessionEnded': 'The server refused the admin token. Sign in again.',
    'login.signedOut': 'You signed out.',

    'signOut.label': 'Sign out',
    'signOut.pending': 'Signing out…',
} as const;

export type MessageId = keyof typeof en;
export type Messages = Record<MessageId, string>;
