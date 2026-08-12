import { inject, type InjectionKey } from "vue";

// PrimeVue overlays (Dialog, Select panel) teleport out of the component tree.
// They cannot render inside the plugin page body, because Caido hides it while
// another page is active and the picker is opened from the request context
// menu. They are teleported into this host instead: a <body>-level element
// carrying the plugin's scope class, so the CSS wrapped by postcss-prefixwrap
// (see vite.config.ts) still applies to them.
export const overlayHostKey: InjectionKey<HTMLElement> = Symbol("dispatch-overlay-host");

export function useOverlayHost(): HTMLElement {
  const host = inject(overlayHostKey);
  if (!host) throw new Error("Overlay host not provided");
  return host;
}
