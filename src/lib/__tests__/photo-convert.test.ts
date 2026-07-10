import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { convertHeicToJpeg, isHeic } from "../photo-convert";

const run = promisify(execFile);

// 1x1 transparent PNG
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-convert-"));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("isHeic", () => {
  it("detects heic and heif extensions case-insensitively", () => {
    expect(isHeic("IMG_4021.HEIC")).toBe(true);
    expect(isHeic("photo.heif")).toBe(true);
    expect(isHeic("photo.jpg")).toBe(false);
    expect(isHeic("photo.heic.jpg")).toBe(false);
  });
});

describe("convertHeicToJpeg", () => {
  it("converts a real HEIC to JPEG and removes the original", async () => {
    // Build a genuine HEIC via macOS sips (same tool the converter uses)
    const pngPath = path.join(dir, "seed.png");
    const heicPath = path.join(dir, "photo.heic");
    await fs.writeFile(pngPath, Buffer.from(PNG_BASE64, "base64"));
    await run("sips", ["-s", "format", "heic", pngPath, "--out", heicPath]);

    const jpegPath = await convertHeicToJpeg(heicPath);

    expect(jpegPath).toBe(path.join(dir, "photo.jpg"));
    const bytes = await fs.readFile(jpegPath);
    // JPEG magic number
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    expect(bytes[2]).toBe(0xff);
    // original HEIC is gone
    await expect(fs.access(heicPath)).rejects.toThrow();
  });
});
