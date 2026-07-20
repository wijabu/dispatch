import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { ANDROID } from "@/config/android";
import { FACEBOOK } from "@/config/facebook";
import { Adb } from "./adb";

const run = promisify(execFile);
const g = globalThis as unknown as {
  __dispatchEmu?: Promise<Adb> | null;
  __dispatchAndroidInProgress?: boolean;
};

// One Android automation flow at a time — mirrors acquireFillLock/
// releaseFillLock in src/automation/browser.ts, but for the emulator instead
// of the Playwright browser context.
export function acquireAndroidLock(): boolean {
  if (g.__dispatchAndroidInProgress) return false;
  g.__dispatchAndroidInProgress = true;
  return true;
}

export function releaseAndroidLock(): void {
  g.__dispatchAndroidInProgress = false;
}

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

// Launch OfferUp on a clean home screen. A warm `monkey` resume can drop us on
// a sub-screen with no tab bar, and blindly pressing back to find home risks
// backing out of the app entirely (observed). Cold-start instead: force-stop
// then launch always lands on the home tab deterministically. The caller's
// polling login check absorbs the launch splash.
export async function launchOfferup(adb: Adb): Promise<void> {
  await adb.shell(["am", "force-stop", "com.offerup"]);
  await adb.shell([
    "monkey", "-p", "com.offerup", "-c", "android.intent.category.LAUNCHER", "1",
  ]);
  await new Promise((r) => setTimeout(r, 6000)); // let the launch splash clear
}

// Logged-in OfferUp shows the bottom tab bar. Poll for it: a single dump can
// transiently fail ("could not get idle state") or catch the launch splash,
// and neither means logged out. Only conclude logged-out if the tab bar is
// persistently absent.
export async function isOfferupLoggedOut(adb: Adb): Promise<boolean> {
  for (let i = 0; i < 8; i++) {
    try {
      const nodes = await adb.dumpUi();
      if (nodes.some((n) => n.testId.startsWith("tab-bar-widget.tab"))) return false;
    } catch {
      // transient dump failure — retry
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return true;
}

// Launch the Facebook app on a clean home screen — cold-start (force-stop then
// launch) for the same deterministic landing as launchOfferup. Facebook is
// heavier, so allow a longer splash. The caller's polling login check absorbs it.
export async function launchFacebook(adb: Adb): Promise<void> {
  await adb.shell(["am", "force-stop", FACEBOOK.packageName]);
  await adb.shell([
    "monkey", "-p", FACEBOOK.packageName, "-c", "android.intent.category.LAUNCHER", "1",
  ]);
  await new Promise((r) => setTimeout(r, 7000));
}

// Facebook's logged-out screen shows a prominent "Log in" / "Create new account"
// prompt. Poll (a single dump can catch the splash or transiently fail); once we
// have a real dump, decide from it. Default to logged-IN if uncertain — a false
// login_required would needlessly bail an otherwise-fine run, and a genuinely
// logged-out session surfaces as a downstream failure with a screenshot.
export async function isFacebookLoggedOut(adb: Adb): Promise<boolean> {
  for (let i = 0; i < 8; i++) {
    try {
      const nodes = await adb.dumpUi();
      if (nodes.length) {
        return nodes.some(
          (n) =>
            /^(Log in|Log In|Create new account)$/.test(n.text) ||
            /^(Log in|Create new account)$/.test(n.contentDesc)
        );
      }
    } catch {
      // transient dump failure — retry
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

// Idempotent self-heal: makes sure ADBKeyBoard is the active IME before any
// typing step runs, in case the emulator's default IME changed since setup.
// Installing + enabling ADBKeyBoard itself is a one-time manual setup step
// and NOT this function's job — it only flips the active IME.
export async function ensureAdbKeyboard(adb: Adb): Promise<void> {
  await adb.shell(["ime", "set", ANDROID.adbKeyboardIme]);
}
