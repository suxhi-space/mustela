import type { JSX } from "solid-js";

/** Small stroke icons on a 24 grid. Hand-drawn so there is no icon font to ship. */
const P: Record<string, string> = {
  hash: "M5 9h14M5 15h14M10 4 8 20M16 4l-2 16",
  speaker: "M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4ZM15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8",
  plus: "M12 5v14M5 12h14",
  check: "m5 12.5 4.5 4.5L19 7.5",
  close: "m6 6 12 12M18 6 6 18",
  back: "m14.5 5-7 7 7 7",
  right: "m9.5 5 7 7-7 7",
  down: "m6 9.5 6 6 6-6",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16.5 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.6.8 2.7 2.5 3 5.2",
  mic: "M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3ZM6 11.5a6 6 0 0 0 12 0M12 17.5V21",
  video: "M3.5 7.5h10v9h-10zM13.5 11l7-3.5v9l-7-3.5",
  screen: "M3 5h18v11H3zM8 20h8M12 16v4",
  send: "M12 19V6M6 11.5 12 5.5l6 6",
  chat: "M4 5h16v11H9.5L5 20v-4H4z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20.5c.8-4 3.6-6 7.5-6s6.7 2 7.5 6",
  palette: "M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 2-.8 2-1.7 0-1.5-1.5-1.6-1.5-3 0-1 .8-1.8 1.8-1.8H17a3.5 3.5 0 0 0 3.5-3.5C20.5 6.6 16.8 3.5 12 3.5ZM7.5 11h.01M10 7.5h.01M14.5 7.5h.01",
  swap: "M7 7h12l-3-3M17 17H5l3 3",
  logout: "M10 4H5v16h5M14 8l4 4-4 4M18 12H9",
  home: "M4 11 12 4l8 7M6 9.5V20h4.5v-5.5h3V20H18V9.5",
  friends: "M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2 20c.6-3.6 3.2-5.5 6.5-5.5S14.4 16.4 15 20M17 8v6M14 11h6",
  note: "M6 3.5h9l4 4V20.5H6zM15 3.5V8h4M9 12h7M9 16h5",
  file: "M6.5 3.5h7.5l4.5 4.5v12.5h-12zM14 3.5V8h4.5",
  download: "M12 4v11M7 10.5l5 5 5-5M5 20h14",
  reply: "M10 7 4.5 12 10 17M5 12h9a5.5 5.5 0 0 1 5.5 5.5V19",
  "arrow-in": "M4 12h11M11 7l5 5-5 5M19 4v16",
  smile: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM8.5 14a4.3 4.3 0 0 0 7 0M9 9.5h.01M15 9.5h.01",
  "smile-plus": "M20.3 11A8.5 8.5 0 1 1 13 3.6M8.5 14a4.3 4.3 0 0 0 7 0M9 9.5h.01M15 9.5h.01M19 2.5v5M16.5 5h5",
  pencil: "M15.5 4.5l4 4L8 20H4v-4zM13.5 6.5l4 4",
  copy: "M8.5 8.5h11v11h-11zM15.5 8.5v-4h-11v11h4",
  trash: "M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 13.5h9l1-13.5M10 10.5v6M14 10.5v6",
  at: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm0 0v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1",
  "plus-circle": "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 8v8M8 12h8",
  bell: "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0",
  popout: "M14 4h6v6M20 4l-8 8M18 14v5H5V6h5",
  hangup: "M3 15c2-3.5 6-5 9-5s7 1.5 9 5l-2.5 2-3-1.5V13c-1-.4-2.3-.6-3.5-.6s-2.5.2-3.5.6v2.5L5.500 17z",
  sparkle: "M12 3.5 14 10l6.5 2-6.5 2L12 20.5 10 14 3.5 12 10 10z",
};

export function Icon(props: { name: keyof typeof P | string; size?: number; class?: string; style?: JSX.CSSProperties }) {
  return (
    <svg class={`ic ${props.class ?? ""}`} width={props.size ?? 20} height={props.size ?? 20} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style={props.style}>
      <path d={P[props.name] ?? ""} />
    </svg>
  );
}
