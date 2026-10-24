import { render } from "solid-js/web";
import { App } from "./ui/App";
import { CallWindow } from "./ui/call/CallWindow";
import { startAppearance, loadLocalAppearance } from "./ui/store";
import "@fontsource-variable/nunito";
import "./ui/styles.css";

const popout = new URLSearchParams(location.search).has("popout");
if (popout) {
  loadLocalAppearance();
  startAppearance();
  render(() => <CallWindow />, document.getElementById("root")!);
} else {
  render(() => <App />, document.getElementById("root")!);
}
