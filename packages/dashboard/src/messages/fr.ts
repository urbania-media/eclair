import type { Messages } from './en.ts';

export const fr: Messages = {
    'app.name': 'Eclair',
    'session.user': 'Jeton admin',

    'login.title': 'Se connecter à Eclair',
    'login.intro':
        'Collez le jeton admin du serveur, <code>ECLAIR_ADMIN_TOKEN</code>. Il reste dans cet onglet seulement, jusqu’à ce que vous le fermiez ou vous déconnectiez.',
    'login.token': 'Jeton admin',
    'login.submit': 'Se connecter',
    'login.invalid': 'Ce n’est pas le jeton admin du serveur.',
    'login.error': 'Le serveur n’a pas répondu : {message}',
    'login.sessionEnded': 'Le serveur a refusé le jeton admin. Reconnectez-vous.',
    'login.signedOut': 'Vous êtes déconnecté.',

    'signOut.label': 'Se déconnecter',
    'signOut.pending': 'Déconnexion…',
};
