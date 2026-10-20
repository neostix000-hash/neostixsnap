#!/usr/bin/env node
/**
 * Static sanity checks for the unpacked Chrome extension.
 * Run from the repository root: node scripts/check-extension.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = path.join(root, 'extension');
const errors = [];
const warnings = [];
let checkedFiles = 0;

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function walk(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}

const manifestPath = path.join(extensionDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('Missing extension/manifest.json');
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error(`manifest.json is not valid JSON: ${error.message}`);
  process.exit(1);
}

if (manifest.manifest_version !== 3) fail('manifest_version must be 3.');
if (manifest.name !== 'NeostixSnap') fail('Unexpected extension name.');
if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version || ''))) {
  fail('manifest version must use the x.y.z format.');
}
if (!manifest.background?.service_worker) fail('Missing MV3 background.service_worker.');
if (manifest.background?.type !== 'module') fail('background.type must be "module".');
if (!manifest.action?.default_popup) fail('Missing action.default_popup.');
if (!manifest.options_ui?.page) fail('Missing options_ui.page.');
if (!manifest.commands?.['capture-snap']) fail('Missing capture-snap command.');
if (!manifest.permissions?.includes('activeTab')) fail('Missing activeTab permission.');
if (!manifest.permissions?.includes('scripting')) fail('Missing scripting permission.');
if (!manifest.permissions?.includes('storage')) fail('Missing storage permission.');
if (manifest.permissions?.includes('<all_urls>') || manifest.permissions?.includes('tabs')) {
  warn('The extension requests a broad permission that may not be necessary.');
}

const referenced = new Set();
for (const [size, iconPath] of Object.entries(manifest.icons || {})) {
  referenced.add(`icons ${size}: ${iconPath}`);
  const full = path.join(extensionDir, iconPath);
  if (!existsSync(full)) fail(`Manifest icon does not exist: ${iconPath}`);
}
for (const iconPath of Object.values(manifest.action?.default_icon || {})) {
  if (!existsSync(path.join(extensionDir, iconPath))) {
    fail(`Action icon does not exist: ${iconPath}`);
  }
}
if (manifest.background?.service_worker) {
  referenced.add(manifest.background.service_worker);
  if (!existsSync(path.join(extensionDir, manifest.background.service_worker))) {
    fail(`Service worker does not exist: ${manifest.background.service_worker}`);
  }
}
if (manifest.action?.default_popup && !existsSync(path.join(extensionDir, manifest.action.default_popup))) {
  fail(`Popup does not exist: ${manifest.action.default_popup}`);
}
if (manifest.options_ui?.page && !existsSync(path.join(extensionDir, manifest.options_ui.page))) {
  fail(`Options page does not exist: ${manifest.options_ui.page}`);
}

const files = walk(extensionDir);
const htmlFiles = files.filter((file) => file.endsWith('.html'));
const jsFiles = files.filter((file) => file.endsWith('.js'));
const cssFiles = files.filter((file) => file.endsWith('.css'));
const jsonFiles = files.filter((file) => file.endsWith('.json'));

for (const file of jsonFiles) {
  try {
    JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${path.relative(root, file)} is not valid JSON: ${error.message}`);
  }
}

const inlineHandlerRe =
  /\son(?:click|dblclick|change|input|submit|load|error|focus|blur|keydown|keyup|keypress|pointerdown|pointerup|pointermove|mouseover|mouseout|contextmenu)\s*=/i;
const externalRefRe = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
const scriptTagRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const styleTagRe = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
const inlineStyleAttrRe = /\sstyle\s*=\s*["']/i;

for (const file of htmlFiles) {
  checkedFiles += 1;
  const relative = path.relative(root, file);
  const html = readFileSync(file, 'utf8');
  if (/<script[^>]*\btype=["']module["'][^>]*\bsrc=/i.test(html) === false && /<script/i.test(html)) {
    fail(`${relative} has a script tag without a module src.`);
  }
  if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html)) {
    fail(`${relative} contains an inline script, which MV3 CSP blocks.`);
  }
  if (inlineHandlerRe.test(html)) {
    fail(`${relative} contains an inline event handler.`);
  }
  if (styleTagRe.test(html)) fail(`${relative} contains an inline <style> block.`);
  if (inlineStyleAttrRe.test(html)) {
    warn(`${relative} contains a style attribute; confirm it is static presentation only.`);
  }

  let match;
  while ((match = externalRefRe.exec(html))) {
    const ref = match[1].trim();
    if (
      !ref ||
      ref.startsWith('#') ||
      ref.startsWith('data:') ||
      ref.startsWith('http://') ||
      ref.startsWith('https://') ||
      ref.startsWith('mailto:') ||
      ref.startsWith('chrome:') ||
      ref.startsWith('javascript:')
    ) {
      if (ref.startsWith('javascript:')) fail(`${relative} contains a javascript: URL.`);
      continue;
    }
    const clean = decodeURIComponent(ref.split('#')[0].split('?')[0]);
    if (!clean) continue;
    const target = path.resolve(path.dirname(file), clean);
    if (!existsSync(target)) {
      fail(`${relative} references a missing file: ${ref}`);
    }
  }
}

for (const file of cssFiles) {
  checkedFiles += 1;
  const css = readFileSync(file, 'utf8');
  const relative = path.relative(root, file);
  if (/@import\s+url\(\s*["']?https?:/i.test(css)) {
    fail(`${relative} imports remote CSS, which MV3 remote-code rules forbid.`);
  }
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (const char of css) {
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth < 0) break;
    }
  }
  if (depth !== 0) fail(`${relative} has unbalanced braces.`);
}

for (const file of jsFiles) {
  checkedFiles += 1;
  const relative = path.relative(root, file);
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    fail(`${relative} failed syntax check:\n${result.stderr || result.stdout}`);
  }
  const source = readFileSync(file, 'utf8');
  if (/\beval\s*\(/.test(source) || /\bnew\s+Function\s*\(/.test(source)) {
    fail(`${relative} uses eval or new Function, which MV3 forbids.`);
  }
  if (/sk-[A-Za-z0-9]{16,}/.test(source)) {
    fail(`${relative} looks like it contains a provider API key.`);
  }
}

// Validate PNG dimensions without external libraries.
for (const iconPath of Object.values(manifest.icons || {})) {
  const full = path.join(extensionDir, iconPath);
  if (!existsSync(full)) continue;
  const buffer = readFileSync(full);
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') {
    fail(`${iconPath} is not a PNG file.`);
    continue;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== height) fail(`${iconPath} is not square (${width}x${height}).`);
  const expected = Number.parseInt(path.basename(iconPath, '.png').replace(/\D/g, ''), 10);
  if (expected && width !== expected) {
    fail(`${iconPath} is ${width}px wide; expected ${expected}px.`);
  }
}

if (files.some((file) => file.endsWith('.map'))) {
  warn('Source maps are present in the extension package.');
}

if (!existsSync(path.join(extensionDir, 'assets', 'logo.svg'))) {
  warn('extension/assets/logo.svg is missing.');
}

console.log(`Checked ${checkedFiles} HTML/CSS/JS files and ${files.length} extension files.`);
for (const item of referenced) console.log(`  manifest → ${item}`);
if (warnings.length) {
  console.log('\nWarnings:');
  for (const warning of warnings) console.log(`  ⚠ ${warning}`);
}
if (errors.length) {
  console.error('\nErrors:');
  for (const error of errors) console.error(`  ✖ ${error}`);
  process.exit(1);
}
console.log('\n✓ Extension checks passed.');
