# OfferUp automation — emulator setup (one-time, macOS)

Dispatch automates OfferUp by driving the real OfferUp Android app in a standard
Android emulator over ADB (BlueStacks blocks the ADB control surface; a stock AVD
does not). This is a one-time setup. All paths assume Apple Silicon macOS.

## 1. Prerequisites (Homebrew)
```bash
brew install openjdk@17                      # sdkmanager/avdmanager need JDK 17+
brew install --cask android-commandlinetools # sdkmanager, avdmanager
```

## 2. SDK packages
```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
SDKM=/opt/homebrew/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager
yes | "$SDKM" --sdk_root="$ANDROID_HOME" \
  platform-tools emulator "platforms;android-34" \
  "system-images;android-34;google_apis_playstore;arm64-v8a"
# avdmanager resolves the SDK root from its own location, so co-locate cmdline-tools:
mkdir -p "$ANDROID_HOME/cmdline-tools"
cp -R /opt/homebrew/share/android-commandlinetools/cmdline-tools/latest "$ANDROID_HOME/cmdline-tools/latest"
```
The config the app expects lives in `src/config/android.ts` (`ANDROID`): SDK at
`~/Library/Android/sdk`, adb at `platform-tools/adb`, AVD name `dispatch_offerup`,
device serial `emulator-5554`.

## 3. Create the AVD
```bash
"$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n dispatch_offerup \
  -k "system-images;android-34;google_apis_playstore;arm64-v8a" -d pixel_6 --force
```
Edit `~/.android/avd/dispatch_offerup.avd/config.ini` and set:
```
hw.keyboard=yes          # so text entry / the host keyboard work
PlayStore.enabled=yes    # so the Play Store is available to install OfferUp
```

## 4. Boot + sign in (manual, one-time)
```bash
"$ANDROID_HOME/emulator/emulator" -avd dispatch_offerup -no-snapshot -gpu auto &
```
In the emulator: open **Play Store**, sign into your Google account, install
**OfferUp**, open it, and log into your OfferUp account. The session persists in
the AVD; Dispatch never handles credentials.

## 5. ADBKeyBoard (reliable Unicode text entry)
`adb shell input text` crashes on non-ASCII (bullets, curly quotes) that appear in
listing descriptions. ADBKeyBoard types arbitrary Unicode via broadcast. Install
the open-source APK and enable it:
```bash
ADB="$ANDROID_HOME/platform-tools/adb"
curl -L -o /tmp/ADBKeyboard.apk https://github.com/senzhk/ADBKeyBoard/raw/master/ADBKeyboard.apk
"$ADB" -s emulator-5554 install /tmp/ADBKeyboard.apk
"$ADB" -s emulator-5554 shell ime enable com.android.adbkeyboard/.AdbIME
```
Dispatch runs `ime set` to activate it before each typing step (see
`ensureAdbKeyboard` in `src/automation/android/device.ts`), so no need to set it
as the default by hand.

## 6. Daily use
- The AVD must be running with OfferUp logged in. Dispatch **cold-starts** OfferUp
  itself before each flow (`launchOfferup`: force-stop + launch → lands on home),
  so it doesn't matter what screen OfferUp was left on.
- In Dispatch's Publish tab, the OfferUp card shows **Post to OfferUp** (fills the
  listing, stops at the review screen for your tap) or **Sync price to OfferUp**
  (pushes the item's asking price to the live listing, hands-off).
- Set each item's exact OfferUp **category + subcategory** in the item form (the
  automation selects that two-level path; see `docs/offerup-categories.md`).
- Security: keep BlueStacks' unrelated ADB toggle off; the AVD's adb is local-only.

## Not yet automated
Relist (archive + fresh repost) is a deliberate follow-up — OfferUp has no native
repost, so it requires archiving the old listing and re-posting a fresh copy.
