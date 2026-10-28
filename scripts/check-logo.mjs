#!/usr/bin/env node
// Checks that the Navbar logo ships in the production build and loads on every kind of page.
//
//   npm run build && node scripts/check-logo.mjs
//
// 1. The hashed logo file is in apps/web/dist/assets and the built JS references it.
// 2. The production server (what `npm start` runs: apps/api/dist/index.js, web and API on one port) starts on a
//    throwaway database in mock demo mode.
// 3. Headless Chromium loads /, /transparency, /login, /admin (after logging in) and a fresh claim link, and on each
//    asserts that the Navbar's <img alt="Asiri"> is visible and decoded (naturalWidth > 0), with no 404 anywhere in
//    the network log.
//
// Exits 1 with a message saying what is missing. Set CHECK_BASE_URL (plus CHECK_ADMIN_EMAIL, CHECK_ADMIN_PASSWORD)
// to check a server that is already running instead. Needs a browser: `npx playwright install chromium`, or an
// installed Chrome or Edge, which is used as a fallback.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "apps/web/dist");
const SERVER = path.join(ROOT, "apps/api/dist/index.js");

const fail = (msg) => {
  console.error(`\ncheck-logo: FAILED\n  ${msg}\n`);
  process.exitCode = 1;
  throw new Error(msg);
};
const ok = (msg) => console.log(`  ok  ${msg}`);

// ---------- 1. the build ----------
console.log("check-logo: build output");
if (!existsSync(path.join(DIST, "index.html"))) fail("apps/web/dist/index.html is missing. Run `npm run build` first.");
const assets = readdirSync(path.join(DIST, "assets"));
const logoFile = assets.find((f) => /^logo-mark-[\w-]+\.png$/.test(f));
if (!logoFile) fail(`No hashed logo (logo-mark-<hash>.png) in apps/web/dist/assets. Found: ${assets.join(", ")}`);
ok(`apps/web/dist/assets/${logoFile}`);
const referencing = [...assets.filter((f) => f.endsWith(".js")).map((f) => path.join("assets", f)), "index.html"].filter((f) =>
  readFileSync(path.join(DIST, f), "utf8").includes(logoFile),
);
if (referencing.length === 0) fail(`apps/web/dist/assets/${logoFile} exists but no built JS or HTML references it.`);
ok(`referenced by ${referencing.join(", ")}`);
for (const icon of ["favicon.png", "apple-touch-icon.png"]) {
  if (!existsSync(path.join(DIST, icon))) fail(`apps/web/dist/${icon} is missing (it comes from apps/web/public).`);
}
ok("favicon.png and apple-touch-icon.png are in apps/web/dist");

// ---------- 2. the server ----------
let base = process.env.CHECK_BASE_URL?.replace(/\/+$/, "");
let email = process.env.CHECK_ADMIN_EMAIL;
let password = process.env.CHECK_ADMIN_PASSWORD;
let server;
let dataDir;

async function startServer() {
  if (!existsSync(SERVER)) fail("apps/api/dist/index.js is missing. Run `npm run build` first.");
  const port = Number(process.env.CHECK_PORT ?? 8799);
  base = `http://localhost:${port}`;
  email = "logo-check@example.com";
  password = randomBytes(12).toString("hex");
  dataDir = mkdtempSync(path.join(tmpdir(), "asiri-logo-"));
  // NODE_ENV=development only because production refuses logins over plain HTTP; the built bundle is the same.
  const env = {
    ...process.env,
    PORT: String(port),
    PUBLIC_WEB_URL: base,
    NODE_ENV: "development",
    DEMO_MODE: "true",
    ZCASH_MODE: "mock",
    ZCASH_NETWORK: "testnet",
    PRICE_SOURCE: "fixed",
    ADMIN_EMAIL: email,
    ADMIN_PASSWORD: password,
    SESSION_SECRET: randomBytes(32).toString("hex"),
    DATABASE_PATH: path.join(dataDir, "check.db"),
    TREASURY_DATA_DIR: path.join(dataDir, "treasury"),
    ANTHROPIC_API_KEY: "",
  };
  server = spawn(process.execPath, [SERVER], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) fail(`The server exited early:\n${log}`);
    const up = await fetch(`${base}/api/health`).then((r) => r.ok, () => false);
    if (up) return ok(`production server on ${base}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`The server did not answer on ${base} within 15 s:\n${log}`);
}

async function launchBrowser() {
  const attempts = [{}, { channel: "chrome" }, { channel: "msedge" }];
  for (const opts of attempts) {
    try {
      return await chromium.launch(opts);
    } catch {
      // try the next browser
    }
  }
  fail("No browser found. Run `npx playwright install chromium`, or install Chrome or Edge.");
}

async function main() {
  if (base) {
    if (!email || !password) fail("CHECK_BASE_URL needs CHECK_ADMIN_EMAIL and CHECK_ADMIN_PASSWORD.");
    ok(`using the running server at ${base}`);
  } else {
    await startServer();
  }

  // ---------- 3. the pages ----------
  console.log("check-logo: pages");
  const browser = await launchBrowser();
  const notFound = [];
  const failures = [];
  const watch = (page) => {
    page.on("response", (r) => r.status() === 404 && notFound.push(`${r.status()} ${r.url()}`));
    // ERR_ABORTED is the browser dropping a request when the page navigates on; it is not a missing file.
    page.on("requestfailed", (r) => !/ERR_ABORTED/.test(r.failure()?.errorText ?? "") && failures.push(`${r.failure()?.errorText ?? "failed"} ${r.url()}`));
  };
  const checkLogo = async (page, label) => {
    const img = page.locator('header img[alt="Asiri"]').first();
    try {
      await img.waitFor({ state: "visible", timeout: 10_000 });
    } catch {
      fail(`${label}: no visible Navbar logo (header img[alt="Asiri"]) at ${page.url()}`);
    }
    const state = await img.evaluate(async (el) => {
      if (!el.complete) await new Promise((r) => el.addEventListener("load", r, { once: true }));
      return { natural: el.naturalWidth, src: el.getAttribute("src"), w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height };
    });
    if (!(state.natural > 0)) fail(`${label}: the logo <img> did not load (naturalWidth 0, src ${state.src})`);
    if (!state.src?.includes(logoFile)) fail(`${label}: the logo src is ${state.src}, not the hashed build file ${logoFile}`);
    if (state.h < 28 || state.h > 40) fail(`${label}: the logo is ${state.h}px tall; expected 28 to 40 px`);
    ok(`${label.padEnd(14)} logo loaded, ${Math.round(state.w)}x${Math.round(state.h)} px, ${state.src}`);
  };

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  watch(page);
  for (const [route, label] of [
    ["/", "home"],
    ["/transparency", "transparency"],
    ["/login", "login"],
  ]) {
    await page.goto(base + route, { waitUntil: "networkidle" });
    await checkLogo(page, label);
  }

  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/admin$/, { timeout: 10_000 }).catch(() => fail("Logging in did not reach /admin."));
  await page.waitForLoadState("networkidle");
  await checkLogo(page, "admin");

  // A payout to claim: fund the mock treasury, create a small payout, open its link in a fresh context.
  const created = await page.evaluate(async () => {
    const post = (url, body) =>
      fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({
        status: r.status,
        body: await r.json().catch(() => null),
      }));
    const fund = await post("/api/dev/mock-donate", { amountZat: 50_000_000 });
    await post("/api/admin/sync", {});
    const payout = await post("/api/admin/payouts", { amount: 5, currency: "USD", category: "food" });
    return { fund: fund.status, status: payout.status, link: payout.body?.link };
  });
  if (created.status !== 201 || !created.link) fail(`Could not create a payout to claim (mock-donate ${created.fund}, create ${created.status}).`);
  const claimCtx = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
  const claimPage = await claimCtx.newPage();
  watch(claimPage);
  await claimPage.goto(created.link, { waitUntil: "networkidle" });
  await checkLogo(claimPage, "claim (360px)");
  const adminLinks = await claimPage.locator("header a", { hasText: /dashboard|new payout|reports|log out/i }).count();
  if (adminLinks > 0) fail("claim: the Navbar shows organizer links; the claim page must show the logo only.");
  ok("claim          no organizer links in the Navbar");

  await browser.close();
  if (notFound.length) fail(`404s in the network log:\n  ${notFound.join("\n  ")}`);
  if (failures.length) fail(`Failed requests in the network log:\n  ${failures.join("\n  ")}`);
  ok("no 404s or failed requests");
  console.log(`\ncheck-logo: passed (logo ${logoFile})`);
}

try {
  await main();
} catch (err) {
  if (!process.exitCode) {
    console.error(`\ncheck-logo: FAILED\n  ${err?.message ?? err}\n`);
    process.exitCode = 1;
  }
} finally {
  if (server && server.exitCode === null) server.kill();
  // The server holds the SQLite file open until it exits; remove the throwaway data once it has.
  if (dataDir) setTimeout(() => { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* left in the temp folder */ } }, 1000);
}
