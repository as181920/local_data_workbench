import test from "node:test";
import assert from "node:assert/strict";
import {
  OZONE_PLATFORM_ENV_NAME,
  resolveLinuxOzonePlatform
} from "../dist-electron/services/core/linuxDisplay.js";

test("defaults Kylin and UKUI desktops to X11 for GTK compatibility", () => {
  assert.equal(resolveLinuxOzonePlatform("linux", {
    XDG_CURRENT_DESKTOP: "UKUI"
  }), "x11");
  assert.equal(resolveLinuxOzonePlatform("linux", {
    XDG_CURRENT_DESKTOP: "X-Generic:Kylin"
  }), "x11");
  assert.equal(resolveLinuxOzonePlatform("linux", {
    DESKTOP_SESSION: "ukui-wayland"
  }), "x11");
});

test("allows an explicit Linux display backend override", () => {
  assert.equal(resolveLinuxOzonePlatform("linux", {
    [OZONE_PLATFORM_ENV_NAME]: "wayland",
    XDG_CURRENT_DESKTOP: "UKUI"
  }), "wayland");
  assert.equal(resolveLinuxOzonePlatform("linux", {
    [OZONE_PLATFORM_ENV_NAME]: "x11"
  }), "x11");
  assert.equal(resolveLinuxOzonePlatform("linux", {
    [OZONE_PLATFORM_ENV_NAME]: "auto",
    XDG_CURRENT_DESKTOP: "UKUI"
  }), undefined);
});

test("leaves other desktops and operating systems unchanged", () => {
  assert.equal(resolveLinuxOzonePlatform("linux", {
    XDG_CURRENT_DESKTOP: "GNOME"
  }), undefined);
  assert.equal(resolveLinuxOzonePlatform("win32", {
    [OZONE_PLATFORM_ENV_NAME]: "x11",
    XDG_CURRENT_DESKTOP: "UKUI"
  }), undefined);
});
