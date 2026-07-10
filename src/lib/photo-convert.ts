import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const run = promisify(execFile);

export function isHeic(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ext === ".heic" || ext === ".heif";
}

// Chromium can't decode HEIC and marketplaces want JPEG, so convert at
// intake using macOS's built-in sips. Returns the new .jpg path.
export async function convertHeicToJpeg(inputPath: string): Promise<string> {
  const jpegPath = inputPath.replace(/\.[^.]+$/, ".jpg");
  await run("sips", ["-s", "format", "jpeg", inputPath, "--out", jpegPath]);
  await fs.unlink(inputPath);
  return jpegPath;
}
