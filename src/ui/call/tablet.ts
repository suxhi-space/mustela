import { adaptMedia } from "../../lib/tabletQueries";
import { createSignal } from "solid-js";
import { MOBILE_UI } from "../target";

/**
 * Tablets in a call (the mobile build, wider than a phone):
 *  - held upright: the phone's call screen, full screen, the call or its chat one at a time
 *  - small tablets (about 7 inches) always get the phone's call screen
 *  - bigger ones held sideways: the desktop look (the chat beside the call, the channel list on the left), plus a full-screen
 *    button that switches to the phone's call screen across the whole tablet, a mix of the two like Discord's
 *    tablet app
 * Computers never use any of this.
 */
// Small tablets (about 7 inches, under ~640px tall sideways) feel more like a big phone: they keep the phone call
// screen sideways too, rather than the desktop look squeezed in.
const mq = typeof matchMedia === "function" ? matchMedia(adaptMedia("(min-width: 901px) and (min-height: 641px)")) : null;
const [sideways, setSideways] = createSignal(!!mq?.matches);
mq?.addEventListener("change", () => { setSideways(mq.matches); if (!mq.matches) setTabletFull(false); });

/** A tablet held sideways (in the mobile build). */
export const landscapeTablet = () => MOBILE_UI && sideways();
/** A sideways tablet's call switched to full screen. */
export const [tabletFull, setTabletFull] = createSignal(false);
/** Whether the call uses the phone's call screen, given whether the screen is phone-sized. */
export const phoneCall = (phoneWidth: boolean) => phoneWidth || (MOBILE_UI && (!landscapeTablet() || tabletFull()));
