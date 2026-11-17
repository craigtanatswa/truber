import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fsp = fs.promises;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(scriptDir, "..");
const outputDir = path.join(sourceDir, "dist");

const EXCLUDED = new Set([
  "dist",
  "scripts",
  "README.md",
  "package.json",
  "package-lock.json",
  "node_modules",
  ".git",
  ".vercel",
  ".gitignore",
  ".vercelignore",
]);

function resolveSupportEmail() {
  const email = String(process.env.SUPPORT_EMAIL || "").trim();
  if (!email) {
    return "";
  }

  const addrSpec =
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

  if (!addrSpec.test(email)) {
    throw new Error(
      "SUPPORT_EMAIL must be a single email address with no display name, extra text or spaces.",
    );
  }

  return email;
}

function resolveSiteOrigin() {
  const configured = String(process.env.SITE_ORIGIN || "").trim();

  if (configured) {
    const value = configured.replace(/\/+$/, "");
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(
        "SITE_ORIGIN must be an absolute http(s) origin with no path other than /, no query, no hash and no credentials.",
      );
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("SITE_ORIGIN must use http or https.");
    }
    if (parsed.username || parsed.password) {
      throw new Error("SITE_ORIGIN must not contain a username or password.");
    }
    if (parsed.search || parsed.hash) {
      throw new Error("SITE_ORIGIN must not contain a query or hash.");
    }
    if (parsed.pathname !== "/" && parsed.pathname !== "") {
      throw new Error("SITE_ORIGIN must not contain a path other than /.");
    }

    return parsed.origin;
  }

  const vercelUrl = String(process.env.VERCEL_URL || "").trim();
  if (vercelUrl) {
    const host = vercelUrl
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "");
    if (host) {
      return `https://${host}`;
    }
  }

  return "http://localhost:3000";
}

function escapeHtmlAttribute(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function copyDirectory(src, dest) {
  const entries = await fsp.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (EXCLUDED.has(entry.name)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await fsp.mkdir(destPath, { recursive: true });
      await copyDirectory(srcPath, destPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

function replacementFor(marker, supportEmail, escapedEmail) {
  switch (marker) {
    case "<!-- inject:support-email -->":
      if (!supportEmail) {
        return "";
      }
      return `<p class="footer-contact"><a href="mailto:${escapedEmail}">Email support</a></p>`;

    case "<!-- inject:support-email-sentence -->":
      if (!supportEmail) {
        return "";
      }
      return `<p>For help with a trip, verification or a dispute: <a href="mailto:${escapedEmail}">Email support</a>.</p>`;

    case "<!-- inject:contact-lead -->":
      if (supportEmail) {
        return '<p class="lead">Questions about Truber or joining as a transporter? Email our support team.</p>';
      }
      return '<p class="lead">Questions about Truber or joining as a transporter? Open the web app to get started.</p>';

    case "<!-- inject:contact-support-card -->":
      if (!supportEmail) {
        return "";
      }
      return `<ul class="contact-grid">
        <li class="card" data-reveal>
          <h2 class="card-title">Support</h2>
          <p>For help with loads, quotations, trips, deliveries or registering as a transporter.</p>
          <p><a href="mailto:${escapedEmail}">Email support</a></p>
        </li>
      </ul>`;

    default:
      return null;
  }
}

async function main() {
  const supportEmail = resolveSupportEmail();
  const siteOrigin = resolveSiteOrigin();
  const escapedEmail = escapeHtmlAttribute(supportEmail);

  await fsp.rm(outputDir, { recursive: true, force: true });
  await fsp.mkdir(outputDir, { recursive: true });
  await copyDirectory(sourceDir, outputDir);

  const outputEntries = await fsp.readdir(outputDir, { withFileTypes: true });
  const htmlFiles = outputEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => path.join(outputDir, entry.name))
    .sort();

  const rewriteTargets = [
    ...htmlFiles,
    path.join(outputDir, "robots.txt"),
    path.join(outputDir, "sitemap.xml"),
  ];

  for (const file of rewriteTargets) {
    if (!fs.existsSync(file)) {
      continue;
    }

    let content = await fsp.readFile(file, "utf8");
    content = content.split("__SITE_ORIGIN__").join(siteOrigin);

    if (file.endsWith(".html")) {
      for (const marker of [
        "<!-- inject:support-email -->",
        "<!-- inject:support-email-sentence -->",
        "<!-- inject:contact-lead -->",
        "<!-- inject:contact-support-card -->",
      ]) {
        const replacement = replacementFor(marker, supportEmail, escapedEmail);
        if (replacement) {
          content = content.split(marker).join(replacement);
        } else {
          const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          content = content.replace(new RegExp(`^[ \t]*${escaped}[ \t]*\n?`, "gm"), "");
        }
      }
      content = content.replace(
        /<section class="section section--muted">\s*<div class="container">\s*<\/div>\s*<\/section>\s*/g,
        "",
      );
    }

    await fsp.writeFile(file, content, "utf8");
  }

  const leftovers = [
    "__SITE_ORIGIN__",
    "<!-- inject:",
    ["[support", "contact", "TBC]"].join(" "),
    ["truber-web", "vercel", "app"].join("."),
  ];
  for (const file of rewriteTargets) {
    if (!fs.existsSync(file)) {
      continue;
    }
    if (!file.endsWith(".html") && !file.endsWith("robots.txt") && !file.endsWith("sitemap.xml")) {
      continue;
    }
    const content = await fsp.readFile(file, "utf8");
    for (const leftover of leftovers) {
      if (content.includes(leftover)) {
        throw new Error(`Build left "${leftover}" in ${path.relative(sourceDir, file)}.`);
      }
    }
  }

  console.log(`SUPPORT_EMAIL set: ${supportEmail ? "yes" : "no"}`);
  console.log(`SITE_ORIGIN: ${siteOrigin}`);
  console.log(`HTML files written: ${htmlFiles.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
