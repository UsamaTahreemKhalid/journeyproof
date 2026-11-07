import { createHash } from "node:crypto";
import { mapSchema, type MapDocument } from "../map/schema.js";
import { mountExplorer } from "./client.js";
import { viewerShell } from "./shell.js";
import { viewerStyle } from "./style.js";
export function renderExplorer(map: MapDocument) {
  const data = JSON.stringify(mapSchema.parse(map)).replace(
    /[<>&\u2028\u2029]/g,
    (char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  const script = `try { (${mountExplorer.toString()})(JSON.parse(document.getElementById('map-data').textContent)); } catch { document.getElementById('flow-name').textContent='Map could not be loaded'; document.getElementById('context').textContent='Malformed map data. Rebuild the local report.'; document.getElementById('graph-area').hidden=true; }`;
  const hash = (value: string) =>
    "'sha256-" + createHash("sha256").update(value).digest("base64") + "'";
  return `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${hash(script)}; style-src ${hash(viewerStyle)}; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>JourneyProof · Evidence Explorer</title><style>${viewerStyle}</style></head><body>${viewerShell}<script id="map-data" type="application/json">${data}</script><script>${script}</script></body></html>`;
}
