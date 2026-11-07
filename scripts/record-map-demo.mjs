/* global document, window */
import { chromium } from "playwright";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const root = resolve("."),
  out = join(root, ".journeyproof/map-demo"),
  manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
const browser = await chromium.launch({ headless: true });
const fileUrl = (kind) => {
  assert(
    /^map-[a-f0-9]{20}$/.test(manifest[kind].mapId),
    "Safe map ID required",
  );
  return pathToFileURL(
    join(root, ".journeyproof/runs/maps", manifest[kind].mapId, "index.html"),
  ).href;
};
async function overlay(page) {
  await page.evaluate(() => {
    const ns = "http://www.w3.org/2000/svg",
      cursor = document.createElementNS(ns, "svg"),
      arrow = document.createElementNS(ns, "path");
    cursor.id = "demo-cursor";
    cursor.setAttribute("viewBox", "0 0 24 24");
    arrow.setAttribute("d", "M5 3L19 12L12 13L9 20L5 3Z");
    arrow.setAttribute("fill", "white");
    arrow.setAttribute("stroke", "black");
    arrow.setAttribute("stroke-width", "1.5");
    cursor.append(arrow);
    Object.assign(cursor.style, {
      position: "fixed",
      zIndex: "999999",
      pointerEvents: "none",
      width: "24px",
      height: "24px",
      left: "0",
      top: "0",
      filter: "drop-shadow(1px 2px 2px #0008)",
    });
    document.body.append(cursor);
    document.addEventListener("mousemove", (event) => {
      cursor.style.left = event.clientX + "px";
      cursor.style.top = event.clientY + "px";
    });
    const bar = document.createElement("div");
    bar.id = "demo-subtitle";
    Object.assign(bar.style, {
      position: "fixed",
      bottom: "0",
      left: "0",
      right: "0",
      zIndex: "999998",
      pointerEvents: "none",
      padding: "13px 20px",
      font: "600 17px/1.5 system-ui",
      textAlign: "center",
      color: "#eef4ed",
      background: "#0a1019ed",
      borderTop: "1px solid #5b7850",
    });
    document.body.append(bar);
  });
}
async function story(page, recording) {
  const pause = (ms) => (recording ? delay(ms) : Promise.resolve());
  const subtitle = async (text, ms = 0) => {
    console.log(text);
    await page.locator("#demo-subtitle").evaluate((element, value) => {
      element.textContent = value;
    }, text);
    await pause(ms);
  };
  const move = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    assert(box, "Control must be visible");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: 12,
    });
    await pause(300);
  };
  const click = async (locator) => {
    await move(locator);
    await locator.click();
    await pause(600);
  };
  const select = async (label, value) => {
    const control = page.getByLabel(label, { exact: true });
    await move(control);
    await control.selectOption(value);
    await pause(700);
  };
  const graph = async () => {
    await page.locator(".explorer").evaluate((element) =>
      window.scrollTo({
        top: element.getBoundingClientRect().top + window.scrollY - 16,
        behavior: "smooth",
      }),
    );
    await pause(1100);
  };
  await page.goto(fileUrl("healthy"));
  await overlay(page);
  await page.waitForFunction(
    () => document.querySelectorAll("#nodes button").length > 0,
  );
  await subtitle(
    "Step 1 — A real admission journey passed all 15 steps.",
    5500,
  );
  await graph();
  await subtitle(
    "Step 2 — Follow the recorded pages and explicit actions.",
    6000,
  );
  await select("State", "linked_unvisited");
  await subtitle(
    "This guide was linked, but never visited. It is not verified.",
    6500,
  );
  await click(page.getByRole("button", { name: "Reset filters", exact: true }));
  await page.goto(fileUrl("comparison"));
  await overlay(page);
  await subtitle(
    "Step 3 — Compare the healthy run with an actual HTTP 500 failure.",
    5500,
  );
  await graph();
  await select("Run", manifest.broken.runId);
  await pause(2200);
  await select("State", "observed_failed");
  await subtitle(
    "Step 4 — Approval is the first failed step; later assertions were not reached.",
    5500,
  );
  await click(
    page
      .locator("#nodes button.action")
      .filter({ hasText: "approve admission" }),
  );
  await page.waitForSelector("#details:not([hidden])");
  assert(
    (await page.locator("#detail-content").innerText()).includes(
      "observed HTTP 500",
    ),
  );
  await subtitle(
    "The inspector shows the observed HTTP status and real run provenance.",
    6500,
  );
  await click(
    page.getByRole("button", { name: "Preview screenshot", exact: true }),
  );
  await page
    .locator("#details")
    .evaluate((element) =>
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" }),
    );
  await subtitle(
    "Step 5 — Inspect the actual masked screenshot. Evidence stays local.",
    6500,
  );
  await click(
    page.getByRole("button", { name: "Close evidence details", exact: true }),
  );
  await click(page.getByRole("button", { name: "Reset filters", exact: true }));
  const search = page.getByLabel("Search", { exact: true });
  await move(search);
  await search.fill("");
  await search.pressSequentially("approve", { delay: 35 });
  await subtitle(
    "Search connects a failing step to its page. Role labels are descriptive only.",
    5000,
  );
  await click(page.getByRole("button", { name: "Reset filters", exact: true }));
  await click(page.getByRole("button", { name: "Toggle light or dark theme" }));
  await pause(2300);
  await click(page.getByRole("button", { name: "Toggle light or dark theme" }));
  await page
    .locator("#comparison")
    .evaluate((element) =>
      element.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  await subtitle(
    "JourneyProof maps what happened. HTTP 500 is evidence, not a root-cause diagnosis.",
    6500,
  );
}
try {
  // Discover and rehearse against the actual exported UI before recording anything.
  const rehearsal = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await rehearsal.newPage();
  await page.goto(fileUrl("comparison"));
  const discovery = await page
    .locator("input,select,button")
    .evaluateAll((elements) =>
      elements
        .filter((e) => e.id)
        .map((e) => ({
          tag: e.tagName,
          id: e.id,
          label: e.getAttribute("aria-label"),
          text: e.textContent.trim().slice(0, 90),
        })),
    );
  await writeFile(
    join(out, "recording-ui-discovery.json"),
    JSON.stringify(discovery, null, 2),
  );
  for (const label of ["Run", "Role", "State", "Transitions", "Search"])
    assert(await page.getByLabel(label, { exact: true }).isVisible(), label);
  await story(page, false);
  await rehearsal.close();
  console.log("Rehearsal passed against the real offline report.");
  if (!process.argv.includes("--rehearse")) {
    await writeFile(
      join(out, "recording-sources.json"),
      JSON.stringify(manifest, null, 2),
    );
    const scratch = await mkdtemp(join(out, "recording-"));
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: scratch, size: { width: 1280, height: 720 } },
    });
    const recorded = await context.newPage();
    try {
      await story(recorded, true);
    } finally {
      await context.close();
    }
    const webm = join(out, "journeyproof-week3.webm");
    await recorded.video().saveAs(webm);
    await rm(scratch, { recursive: true });
    const metadata = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration:stream=codec_name,width,height",
          "-of",
          "json",
          webm,
        ],
        { encoding: "utf8" },
      ),
    );
    const seconds = Number(metadata.format.duration);
    assert(
      seconds >= 60 && seconds <= 90,
      `Actual recording duration ${seconds}s`,
    );
    assert.equal(metadata.streams[0].width, 1280);
    assert.equal(metadata.streams[0].height, 720);
    const encoders = execFileSync("ffmpeg", ["-hide_banner", "-encoders"], {
      encoding: "utf8",
    });
    const encoder = encoders.includes("libx264") ? "libx264" : "libopenh264";
    const mp4 = join(out, "journeyproof-week3.mp4");
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-i",
        webm,
        "-c:v",
        encoder,
        ...(encoder === "libx264" ? ["-preset", "fast"] : ["-b:v", "2000k"]),
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-an",
        mp4,
      ],
      { stdio: "ignore" },
    );
    const mp4Metadata = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration:stream=codec_name,width,height",
          "-of",
          "json",
          mp4,
        ],
        { encoding: "utf8" },
      ),
    );
    assert.equal(mp4Metadata.streams[0].codec_name, "h264");
    const proof = {
      mp4Metadata,
      ...metadata,
      sourceRunIds: [manifest.healthy.runId, manifest.broken.runId],
      comparisonMapId: manifest.comparison.mapId,
      webm: "journeyproof-week3.webm",
      mp4: "journeyproof-week3.mp4",
      rehearsal: "passed",
      captions: "English",
      audio: false,
    };
    await writeFile(
      join(out, "recording-proof.json"),
      JSON.stringify(proof, null, 2),
    );
    console.log(
      `Verified actual recording: ${seconds}s, 1280x720, WebM and MP4.`,
    );
  }
} finally {
  await browser.close();
}
