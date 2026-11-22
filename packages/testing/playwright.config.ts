import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);

const apiPort = process.env.API_PORT ?? "4000";
const webPort = process.env.WEB_PORT ?? "3000";
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: {
    baseURL: webOrigin,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-dark",
      use: { ...devices["Pixel 7"], defaultBrowserType: "chromium", colorScheme: "dark" },
    },
  ],
  webServer: [
    {
      cwd: root,
      command: "pnpm --filter @vetx/api start",
      env: { API_PORT: apiPort },
      url: `${apiOrigin}/health/ready`,
    },
    {
      cwd: root,
      command: "pnpm --filter @vetx/web-staff start --hostname 127.0.0.1",
      env: { API_INTERNAL_URL: apiOrigin, PORT: webPort },
      url: `${webOrigin}/es`,
    },
  ],
});
