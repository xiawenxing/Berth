#!/usr/bin/env node
// Build a minimal lucide SVG <symbol> sprite from lucide-static, containing only
// the icons Berth actually uses. Output: public/vendor/lucide.svg, referenced as
// <svg class="icon"><use href="/vendor/lucide.svg#<name>"></use></svg>.
//
// Zero-build by design: this runs as part of `npm run vendor` (which `npm start`
// invokes), the same way xterm/marked are vendored. Add an icon name below when a
// new region adopts it.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ICON_DIR = resolve(ROOT, "node_modules/lucide-static/icons");
const OUT = resolve(ROOT, "public/vendor/lucide.svg");

// Whitelist — keep alphabetised. These map to the glyphs/inline-SVGs Berth replaces.
const ICONS = [
  "arrow-right",
  "ban",        // ⊘ detach / no-project
  "check",
  "chevron-down",   // ▾
  "anchor",     // ⚓ Berth logo / empty state
  "archive",    // 📤 archive project
  "archive-restore", // unarchive
  "arrow-left", // ← back
  "ban",        // ⊘ no-project / detach / deleted
  "chevron-left",
  "chevron-right",  // ▸
  "chevron-up",
  "circle-check", // ✅ saved
  "circle-plus",
  "clock",      // 🕑 recent sessions
  "database",   // 🗄 data source / settings
  "ellipsis",   // ⋯ more menu
  "external-link", // ↗ open in Obsidian
  "file-text",  // 📄 doc link
  "folder",     // ◈ project
  "folder-open",
  "folder-plus", // existing inline "add path" icon
  "hourglass",  // ⏳ in-progress
  "house",      // nav: Now
  "inbox",      // 📥 inbox
  "layout-grid", // nav: all sessions
  "link-2",     // ⊞ linked-session count
  "list-checks", // 📋 tasks
  "moon",       // theme toggle
  "paperclip",  // 📎 context attachments
  "pencil",     // existing inline "edit" icon
  "pin",
  "play",       // ▷ launch session
  "plus",       // ⊕ ／ ＋ new
  "refresh-cw",
  "download",    // ⬇ pull (external → Berth)
  "upload",      // ⬆ push (Berth → external)
  "folder-input", // 📥 import a directory into the 无归属 bucket
  "search",
  "settings",   // ⚙ settings / data sources
  "sparkles",   // ✨ AI generate title
  "square",     // ■ kill agent
  "square-terminal", // ⊞ sessions section
  "sun",        // theme toggle
  "trash-2",    // 🗑 delete
  "triangle-alert", // ⚠️ conflict warning
  "x",          // × ／ ✕ close
];

function innerSvg(name) {
  const file = resolve(ICON_DIR, `${name}.svg`);
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(
      `lucide icon "${name}" not found at ${file}. Is lucide-static installed? (npm i -D lucide-static)`,
    );
  }
  // Grab everything between the outer <svg ...> and </svg>; that's the path data.
  const m = raw.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  if (!m) throw new Error(`could not parse <svg> body for "${name}"`);
  return m[1].trim();
}

const symbols = ICONS.map(
  (name) =>
    `  <symbol id="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n    ` +
    innerSvg(name).replace(/\n\s*/g, "\n    ") +
    `\n  </symbol>`,
).join("\n");

const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${symbols}\n</svg>\n`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, sprite);
console.log(`lucide sprite: ${ICONS.length} icons → ${OUT}`);
