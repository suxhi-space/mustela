import { render } from "solid-js/web";
import { App } from "../ui/App";
import "../ui/styles.css";
import { installGlobalContextMenu } from "../ui/menu";

/** Desktop (Windows, macOS, Linux, and the web on a computer): windows, right-click menus, hover. */
export function start(root: HTMLElement) {
  document.documentElement.dataset.ui = "desktop";
  installGlobalContextMenu();
  render(() => <App />, root);
}
