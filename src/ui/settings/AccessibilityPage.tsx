import type { A11yPrefs } from "../../lib/device";
import { Group, Row, Seg, Slider, Switch } from "../controls";
import { device, look, updateDevice, updateLook } from "../store";

/**
 * Accessibility, gathered in one place (some of these also live where they always were, like the text
 * size under Appearance): text you can read, motion you can stop, colour and contrast.
 */
export function AccessibilityPage() {
  const a = () => device().a11y;
  const set = (p: Partial<A11yPrefs>) => updateDevice({ a11y: { ...a(), ...p } });
  const text = () => device().text;
  return (
    <div class="page">
      <Group title="Text" hint="These change how messages read on this device.">
        <Row label="Message text size"><Slider label="Message text size" min={12} max={22} value={text().size} suffix="px" onChange={(size) => updateDevice({ text: { ...text(), size } })} /></Row>
        <Row label="Space between message groups"><Slider label="Space between message groups" min={0} max={24} value={text().spacing} suffix="px" onChange={(spacing) => updateDevice({ text: { ...text(), spacing } })} /></Row>
        <Row label="Easier-to-read messages" hint="A little heavier and more spaced out.">
          <Switch label="Easier-to-read messages" on={a().readable} onChange={(readable) => set({ readable })} />
        </Row>
        <Row label="Bigger text on touch screens" hint="Phones and tablets read a size up.">
          <Switch label="Bigger text on touch screens" on={a().touchText} onChange={(touchText) => set({ touchText })} />
        </Row>
        <Row label="Always underline links"><Switch label="Always underline links" on={a().underlineLinks} onChange={(underlineLinks) => set({ underlineLinks })} /></Row>
      </Group>
      <Group title="Density">
        <Row label="Interface density" hint="How much room everything has.">
          <Seg label="Interface density" value={device().density} onChange={(density) => updateDevice({ density })}
            options={[{ v: "compact", label: "Compact" }, { v: "default", label: "Default" }, { v: "comfy", label: "Roomy" }]} />
        </Row>
        <Row label="Message layout">
          <Seg label="Message layout" value={device().layout} onChange={(layout) => updateDevice({ layout })} options={[{ v: "cozy", label: "Cozy" }, { v: "compact", label: "Compact" }]} />
        </Row>
      </Group>
      <Group title="Color and contrast">
        <Row label="Contrast">
          <Seg label="Contrast" value={String(look().contrast)} onChange={(c) => updateLook({ contrast: +c })}
            options={[{ v: "-1", label: "Reduced" }, { v: "0", label: "Normal" }, { v: "0.5", label: "More" }, { v: "1", label: "High" }]} />
        </Row>
        <Row label="Names in role colors" hint="Off: everyone's name is in the normal text color.">
          <Switch label="Names in role colors" on={a().roleColors} onChange={(roleColors) => set({ roleColors })} />
        </Row>
      </Group>
      <Group title="Motion" hint="Decorations, effects, frames and nameplates, and the little animations around the app.">
        <Row label="Reduce motion">
          <Seg label="Reduce motion" value={a().reduceMotion} onChange={(reduceMotion) => set({ reduceMotion })}
            options={[{ v: "off", label: "Off" }, { v: "system", label: "Like my system" }, { v: "on", label: "On" }]} />
        </Row>
      </Group>
    </div>
  );
}
