import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { ANDROID } from "@/config/android";
import { Adb } from "./adb";

const run = promisify(execFile);
const g = globalThis as unknown as { __dispatchEmu?: Promise<Adb> | null };

async function deviceOnline(): Promise<boolean> {
  try {
    const { stdout } = await run(ANDROID.adbPath, ["-s", ANDROID.deviceSerial, "get-state"]);
    return stdout.trim() === "device";
  } catch { return false; }
}

async function bootedFlag(adb: Adb): Promise<boolean> {
  const out = await adb.shell(["getprop", "sys.boot_completed"]).catch(() => "");
  return out.trim() === "1";
}

export function ensureBooted(): Promise<Adb> {
  if (g.__dispatchEmu) {
    // Cached singleton may point at a device that died or was quit since boot;
    // re-validate liveness before trusting it, mirroring browser.ts's close-event reset.
    return g.__dispatchEmu.then(async (adb) => {
      if (await deviceOnline()) return adb;
      g.__dispatchEmu = null;
      return ensureBooted();
    });
  }
  g.__dispatchEmu = (async () => {
    const adb = new Adb();
    if (!(await deviceOnline())) {
      // windowed but not focused; -no-snapshot for a clean session
      spawn(ANDROID.emulatorPath, ["-avd", ANDROID.avdName, "-no-snapshot", "-gpu", "auto"], {
        detached: true, stdio: "ignore",
      }).unref();
    }
    // wait up to 120s for boot
    for (let i = 0; i < 40; i++) {
      if (await deviceOnline() && await bootedFlag(adb)) return adb;
      await new Promise((r) => setTimeout(r, 3000));
    }
    g.__dispatchEmu = null;
    throw new Error("emulator did not boot within 120s");
  })().catch((e) => { g.__dispatchEmu = null; throw e; });
  return g.__dispatchEmu;
}

export async function foregroundEmulator(): Promise<void> {
  // The emulator app on macOS; bring its window forward for the review gate.
  await run("open", ["-a", "qemu-system-aarch64"]).catch(() => {});
}

export async function isOfferupLoggedOut(adb: Adb): Promise<boolean> {
  const nodes = await adb.dumpUi();
  // Logged-in shows the bottom tab bar; its absence => logged out / wall.
  return !nodes.some((n) => n.testId.startsWith("tab-bar-widget.tab"));
}
