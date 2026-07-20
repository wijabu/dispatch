import pkg from "../../package.json";

// Single source of truth for the app version (from package.json). Shown in the
// header so you can confirm a running build is current — bump package.json's
// "version" with each release and the badge updates on the next rebuild.
export const APP_VERSION = pkg.version;
