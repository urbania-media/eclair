import type { IconComponent, NamedIconLoader } from '@panneau/ui';
import { LogOut } from 'lucide-react';

/**
 * The icons that the definition names. Panneau loads every Lucide icon by default, each in its own
 * chunk: the image would ship about 1,900 files for a dozen icons.
 */
const icons: Record<string, IconComponent> = {
    'log-out': LogOut,
};

export const iconLoader: NamedIconLoader = (name) => Promise.resolve(icons[name] ?? null);
