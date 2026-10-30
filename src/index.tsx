import { render } from "solid-js/web";
import { App } from "./ui/App";
import "@fontsource-variable/nunito";
// Name-style fonts. Each is only downloaded by the page when a name on screen uses it.
import "@fontsource-variable/lora";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/dancing-script";
import "@fontsource/righteous";
import "./ui/styles.css";
import { installGlobalContextMenu } from "./ui/menu";

installGlobalContextMenu();

render(() => <App />, document.getElementById("root")!);
