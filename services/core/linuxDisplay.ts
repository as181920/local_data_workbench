export const OZONE_PLATFORM_ENV_NAME = "LOCAL_DATA_WORKBENCH_OZONE_PLATFORM";

export type OzonePlatform = "x11" | "wayland";

export function resolveLinuxOzonePlatform(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): OzonePlatform | undefined {
  if (platform !== "linux") return undefined;

  const requested = env[OZONE_PLATFORM_ENV_NAME]?.trim().toLowerCase();
  if (requested === "x11" || requested === "wayland") return requested;
  if (requested === "auto") return undefined;

  const desktop = [
    env.XDG_CURRENT_DESKTOP,
    env.XDG_SESSION_DESKTOP,
    env.DESKTOP_SESSION
  ].filter(Boolean).join(":").toLowerCase();

  return /(^|[^a-z0-9])(kylin|ukui)([^a-z0-9]|$)/.test(desktop) ? "x11" : undefined;
}
