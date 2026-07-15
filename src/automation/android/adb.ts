import { execFile } from "child_process";
import { promisify } from "util";
import { ANDROID } from "@/config/android";

const run = promisify(execFile);

export interface UiNode {
  testId: string;
  text: string;
  className: string;
  bounds: [number, number, number, number];
  center: [number, number];
}

const BOUNDS_RE = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/;

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#10;": "\n",
};
const XML_ENTITY_RE = /&amp;|&lt;|&gt;|&quot;|&#39;|&#10;/g;

// uiautomator XML attribute values keep entities raw (e.g. OfferUp category
// labels contain literal "&amp;" for "Home & Garden"). Decode so downstream
// text matching (findByTextContains, category-sheet matching) works against
// the real display string.
function decodeXmlEntities(s: string): string {
  return s.replace(XML_ENTITY_RE, (m) => XML_ENTITIES[m]);
}

export function parseUiTree(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  // uiautomator emits flat self-describing <node .../> elements; regex over
  // attributes is sufficient and avoids an XML dep.
  const nodeRe = /<node\b[^>]*>/g;
  for (const m of xml.matchAll(nodeRe)) {
    const tag = m[0];
    const attr = (name: string) =>
      decodeXmlEntities(new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? "");
    const b = BOUNDS_RE.exec(attr("bounds"));
    if (!b) continue;
    const bounds: [number, number, number, number] = [
      +b[1],
      +b[2],
      +b[3],
      +b[4],
    ];
    nodes.push({
      testId: attr("resource-id"),
      text: attr("text"),
      className: attr("class"),
      bounds,
      center: [
        Math.floor((bounds[0] + bounds[2]) / 2),
        Math.floor((bounds[1] + bounds[3]) / 2),
      ],
    });
  }
  return nodes;
}

export function findByTestId(
  nodes: UiNode[],
  testId: string
): UiNode | undefined {
  return nodes.find((n) => n.testId === testId);
}

export function findByTextContains(
  nodes: UiNode[],
  substr: string
): UiNode | undefined {
  return nodes.find((n) => n.text.includes(substr) || n.testId.includes(substr));
}

// `input text` on-device chokes on non-ASCII (NullPointerException on the
// uiautomator side), and OfferUp descriptions routinely carry bullets, curly
// quotes, dashes, and ellipses from copy/paste. Transliterate the common
// cases to their ASCII equivalents, then drop anything else outside the
// printable ASCII range rather than let it reach the device shell.
const ASCII_TRANSLITERATIONS: Record<string, string> = {
  "•": "-", // •
  "‘": "'", // '
  "’": "'", // '
  "“": '"', // "
  "”": '"', // "
  "–": "-", // –
  "—": "-", // —
  "…": "...", // …
  " ": " ", // non-breaking space
};

export function asciiNormalize(s: string): string {
  let out = "";
  for (const ch of s) {
    const replacement = ASCII_TRANSLITERATIONS[ch];
    if (replacement !== undefined) {
      out += replacement;
      continue;
    }
    if (ch.codePointAt(0)! <= 126) out += ch;
  }
  return out;
}

// Wrap `s` in single quotes for the DEVICE shell, escaping any embedded
// single quote as close-quote/escaped-quote/reopen-quote so the whole thing
// survives `adb shell` -> device `sh -c` as one literal argument.
function deviceSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export class Adb {
  constructor(private serial = ANDROID.deviceSerial) {}
  private args(rest: string[]) {
    return ["-s", this.serial, ...rest];
  }
  async exec(rest: string[]): Promise<string> {
    const { stdout } = await run(ANDROID.adbPath, this.args(rest));
    return stdout;
  }
  shell(cmd: string[]) {
    return this.exec(["shell", ...cmd]);
  }
  push(local: string, remote: string) {
    return this.exec(["push", local, remote]);
  }
  async screencap(dest: string): Promise<void> {
    const { stdout } = await run(ANDROID.adbPath, this.args(["exec-out", "screencap", "-p"]), {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    (await import("fs")).writeFileSync(dest, stdout);
  }
  async dumpUi(): Promise<UiNode[]> {
    await this.shell(["uiautomator", "dump", "/sdcard/ui.xml"]);
    const xml = await this.exec(["exec-out", "cat", "/sdcard/ui.xml"]);
    return parseUiTree(xml);
  }
  tap(x: number, y: number) {
    return this.shell(["input", "tap", String(x), String(y)]);
  }
  tapNode(n: UiNode) {
    return this.tap(n.center[0], n.center[1]);
  }
  async typeText(text: string): Promise<void> {
    const normalized = asciiNormalize(text);
    if (normalized === "") return;
    const lines = normalized.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 0) {
        await this.shell([`input text ${deviceSingleQuote(line)}`]);
      }
      if (i < lines.length - 1) {
        await this.shell(["input", "keyevent", "66"]);
      }
    }
  }
}
