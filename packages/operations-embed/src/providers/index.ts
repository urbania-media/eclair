import type { ProviderModule } from '../common.ts';
import { dailymotion } from './dailymotion.ts';
import { instagram } from './instagram.ts';
import { soundcloud } from './soundcloud.ts';
import { spotify } from './spotify.ts';
import { tiktok } from './tiktok.ts';
import { vimeo } from './vimeo.ts';
import { youtube } from './youtube.ts';

/** The providers of the plugin, by name. */
export const PROVIDERS: ReadonlyMap<string, ProviderModule> = new Map(
    [youtube, vimeo, dailymotion, soundcloud, spotify, tiktok, instagram].map((module) => [
        module.provider.name,
        module,
    ]),
);
