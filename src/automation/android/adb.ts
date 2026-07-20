import { execFile } from "child_process";
import { promisify } from "util";
import { ANDROID } from "@/config/android";

const run = promisify(execFile);

export interface UiNode {
  testId: string;
  text: string;
  contentDesc: string;
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
      contentDesc: attr("content-desc"),
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

// Some controls (e.g. OfferUp's Edit "Save" button) carry no testId/text — only
// an accessibility content-desc. Match a clickable one by exact content-desc.
export function findByContentDesc(
  nodes: UiNode[],
  desc: string
): UiNode | undefined {
  return nodes.find((n) => n.contentDesc === desc);
}

export function findByTextContains(
  nodes: UiNode[],
  substr: string
): UiNode | undefined {
  return nodes.find((n) => n.text.includes(substr) || n.testId.includes(substr));
}

// Pure line-splitter shared by typeText: ADBKeyBoard's broadcast input does
// NOT turn embedded newlines into line breaks on-device (they arrive as a
// literal "\n" glyph), so each line has to be typed separately with an
// explicit ENTER keyevent between lines.
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
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
  // Pins the emulator's GPS via the emulator console (`adb emu geo fix`). Order
  // is longitude then latitude. Used to give Facebook Marketplace a fixed selling
  // location without real device location.
  geoFix(lon: number, lat: number) {
    return this.exec(["emu", "geo", "fix", String(lon), String(lat)]);
  }
  // Types via ADBKeyBoard (com.android.adbkeyboard/.AdbIME) so arbitrary
  // Unicode (bullets, curly quotes, em dashes, emoji) reaches the field
  // intact — plain `adb shell input text` chokes on non-ASCII. ADBKeyBoard's
  // broadcast doesn't turn an embedded "\n" into a real line break, so each
  // line is sent as its own broadcast with an explicit ENTER keyevent (66)
  // between lines.
  async typeText(text: string): Promise<void> {
    const lines = splitLines(text);
    for (let i = 0; i < lines.length; i++) {
      // Skip the broadcast for a blank line — base64("") is "" and
      // `am broadcast --es msg` errors on an empty value. The ENTER below
      // still creates the blank line between paragraphs.
      if (lines[i].length > 0) {
        const b64 = Buffer.from(lines[i], "utf8").toString("base64");
        await this.shell(["am", "broadcast", "-a", "ADB_INPUT_B64", "--es", "msg", b64]);
      }
      if (i < lines.length - 1) {
        await this.shell(["input", "keyevent", "66"]);
      }
    }
  }

  // Clears the currently focused field via ADBKeyBoard's clear broadcast.
  async clearText(): Promise<void> {
    await this.shell(["am", "broadcast", "-a", "ADB_CLEAR_TEXT"]);
  }
}
