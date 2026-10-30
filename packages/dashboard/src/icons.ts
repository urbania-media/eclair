import type { IconComponent, NamedIconLoader } from '@panneau/ui';
import {
    Ban,
    ChartLine,
    CircleCheck,
    CircleOff,
    Folder,
    HardDrive,
    KeyRound,
    Layers,
    LogOut,
    Trash2,
} from 'lucide-react';

/**
 * The icons that the definition names. Panneau loads every Lucide icon by default, each in its own
 * chunk: the image would ship about 1,900 files for a dozen icons.
 */
const icons: Record<string, IconComponent> = {
    ban: Ban,
    'chart-line': ChartLine,
    'circle-check': CircleCheck,
    'circle-off': CircleOff,
    folder: Folder,
    'hard-drive': HardDrive,
    'key-round': KeyRound,
    layers: Layers,
    'log-out': LogOut,
    'trash-2': Trash2,
};

export const iconLoader: NamedIconLoader = (name) => Promise.resolve(icons[name] ?? null);
