import { execSync } from "node:child_process";
import { defineConfig } from "vite";

function getCommitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function getBuildTimeJst(): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date()).replace(/\//g, "-") + " JST";
}

export default defineConfig({
  base: "/arcane-descent/",
  define: {
    __BUILD_TIME_JST__: JSON.stringify(getBuildTimeJst()),
    __COMMIT_HASH__: JSON.stringify(getCommitHash())
  }
});
