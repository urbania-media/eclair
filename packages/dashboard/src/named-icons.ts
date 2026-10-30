/**
 * Replaces `@panneau/ui/named-icons` in the build (vite.config.ts). `<Panneau>` imports Lucide's
 * whole loader as the default of its `iconLoader` prop, so the bundle gets every icon even when
 * the app passes its own loader: https://github.com/folkloreinc/panneau-js/issues/141
 */
export { iconLoader as lucideIconLoader } from './icons.ts';
