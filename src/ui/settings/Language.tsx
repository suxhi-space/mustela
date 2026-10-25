import { fmtDate, fmtTime } from "../../lib/time";
import { Group, Row, Seg, Select } from "../controls";
import { settings, updateSettings } from "../store";

/** Stoat's "Language", plus how times and dates are written. */
export function LanguagePage() {
  const loc = () => settings().locale;
  const set = (p: Partial<ReturnType<typeof loc>>) => updateSettings((s) => ({ ...s, locale: { ...s.locale, ...p } }));
  const sample = new Date(2026, 9, 24, 15, 4);
  return (
    <div class="page">
      <Group title="Language" hint="Mustela is in English for now. Messages are never translated or changed.">
        <Row icon="globe" label="Interface language"><Select label="Interface language" value="en" options={[{ v: "en", label: "English" }]} onChange={() => {}} /></Row>
      </Group>
      <Group title="Time and date" hint="Follows your account to every device.">
        <Row label="Clock" hint={(loc(), `Example: ${fmtTime(sample)}`)}>
          <Seg label="Clock" value={loc().time} onChange={(time) => set({ time })} options={[{ v: "auto", label: "System" }, { v: "12", label: "12-hour" }, { v: "24", label: "24-hour" }]} />
        </Row>
        <Row label="Dates" hint={(loc(), `Example: ${fmtDate(sample)}`)}>
          <Seg label="Dates" value={loc().date} onChange={(date) => set({ date })} options={[{ v: "auto", label: "System" }, { v: "us", label: "M/D/Y" }, { v: "eu", label: "D/M/Y" }, { v: "iso", label: "Y-M-D" }]} />
        </Row>
      </Group>
    </div>
  );
}
