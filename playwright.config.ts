import { defineConfig, devices } from "@playwright/test";

const port = 3_207;
const fakeGLMPort = 3_208;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: [
    {
      command: "tsx scripts/fake-glm-server.ts",
      url: `http://127.0.0.1:${fakeGLMPort}/health`,
      env: { FAKE_GLM_PORT: String(fakeGLMPort) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
      url: baseURL,
      env: {
        TONE_PROVIDER: "openai-compatible",
        GLM_API_KEY: "e2e-test",
        GLM_BASE_URL: `http://127.0.0.1:${fakeGLMPort}/v1`,
        GLM_MODEL: "e2e-model",
        GLM_RESPONSE_FORMAT: "json_object",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
