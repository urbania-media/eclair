import { createContext, use } from 'react';

/** Signs the operator out: the token is forgotten, and the login page says so. */
export const SignOutContext = createContext<() => void>(() => undefined);

export function useSignOut(): () => void {
    return use(SignOutContext);
}
