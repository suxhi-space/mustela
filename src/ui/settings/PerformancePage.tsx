import { Show } from "solid-js";
import { RATING_ORDER, type Rating } from "../../lib/decor/spec";
import type { PerfPrefs } from "../../lib/device";
import { Group, Row, Select, Seg, Switch } from "../controls";
import { isDesktopApp } from "../desktop";
import { device, platform, settings, updateDevice, updateSettings } from "../store";

/**
 * Settings > Mustela > Performance: everything that trades looks for speed, in one place.
 * Defaults are light on Linux (no blur, reduced animation), where WebKitGTK is slowest.
 */
export function PerformancePage() {
  const p = () => device().perf;
  const set = (patch: Partial<PerfPrefs>) => updateDevice({ perf: { ...p(), ...patch } });
  return (
    <div class="page">
      <Group title="Animation" hint="Decorations, profile effects, frames and nameplates. Only ten move at once, and they stop when Mustela is in the background.">
        <Row label="Animations">
          <Seg label="Animations" value={p().anim} onChange={(anim) => set({ anim })}
            options={[{ v: "full", label: "Full" }, { v: "reduced", label: "Reduced" }, { v: "off", label: "Off" }]} />
        </Row>
        <Row label="Animate profiles up to" hint="Profiles rated heavier than this show as still pictures.">
          <Select<Rating> label="Animation limit" value={settings().maxRating} onChange={(maxRating) => updateSettings((s) => ({ ...s, maxRating }))}
            options={RATING_ORDER.map((r) => ({ v: r, label: r === "very-poor" ? "Everything" : r[0]!.toUpperCase() + r.slice(1) }))} />
        </Row>
        <Row label="Lighter during calls" hint="Animations slow down in a call, and again while you share or watch a stream. Decorations in the call move only while that person talks.">
          <Switch label="Lighter during calls" on={p().lighterInCalls} onChange={(lighterInCalls) => set({ lighterInCalls })} />
        </Row>
        <Row label="Keep animating in the background" hint="Off: everything holds still while another window, like a game, is in front.">
          <Switch label="Keep animating in the background" on={p().background} onChange={(background) => set({ background })} />
        </Row>
        <Row label="Follow the system's reduce motion" hint="On: when your system asks for less motion (like Windows with animation effects off), decorations and effects hold still.">
          <Switch label="Follow the system's reduce motion" on={p().systemMotion} onChange={(systemMotion) => set({ systemMotion })} />
        </Row>
      </Group>
      <Group title="Media">
        <Row label="Play GIFs and animated emoji" hint="Off: they show their first frame and play while you point at them. GIFs never play while scrolled out of view.">
          <Switch label="Play GIFs and animated emoji" on={p().gifs} onChange={(gifs) => set({ gifs })} />
        </Row>
      </Group>
      <Group title="Look">
        <Row label="Blur behind menus" hint={platform === "linux" ? "Blur is slow on Linux, so it starts off there." : "Frosted glass behind settings, menus and pop-ups. Off uses solid panels."}>
          <Switch label="Blur behind menus" on={p().blur} onChange={(blur) => set({ blur })} />
        </Row>
        <Show when={isDesktopApp()}>
          <Row label="Title bar" hint="Mustela's thin bar lets window materials reach the top edge. The system's frame matches your other apps. Restart Mustela to switch.">
            <Seg label="Title bar" value={device().titleBar} onChange={(titleBar) => updateDevice({ titleBar })}
              options={[{ v: "mustela", label: "Mustela's" }, { v: "system", label: "System's" }]} />
          </Row>
        </Show>
      </Group>
    </div>
  );
}
