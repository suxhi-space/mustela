import { render } from "solid-js/web";
import { App } from "../ui/App";
import "../ui/styles.css";
import { installGlobalContextMenu } from "../ui/menu";
import { installTooltips } from "../ui/tooltips";
import { startPerfLog } from "../ui/perfLog";

/** Desktop (Windows, macOS, Linux, and the web on a computer): windows, right-click menus, hover. */
export function start(root: HTMLElement) {
  document.documentElement.dataset.ui = "desktop";
  installGlobalContextMenu();
  installTooltips();
  startPerfLog(); // Settings > Advanced > Copy performance report
  render(() => <App />, root);
}
