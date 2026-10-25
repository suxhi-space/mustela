import qrcode from "qrcode-generator";

/** An SVG QR code (black on white with a quiet zone, so phone cameras read it in dark mode too). */
export function qrSvg(text: string): string {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), pad = 4, size = n + pad * 2;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x + pad} ${y + pad}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
