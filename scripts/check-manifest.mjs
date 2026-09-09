import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const directory = resolve(process.argv[2] ?? '.output/chrome-mv3');
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.service_worker, 'background.js');
const scripts = manifest.content_scripts;
assert.equal(scripts.length, 2, 'ATS and LinkedIn need separate declarations');
const linkedin = scripts.find((script) => script.matches.includes('https://www.linkedin.com/jobs/*'));
assert.ok(linkedin, 'LinkedIn jobs declaration is present');
assert.deepEqual(linkedin.matches, ['https://www.linkedin.com/jobs/*']);
assert.notEqual(linkedin.match_origin_as_fallback, true, 'LinkedIn access must remain path restricted');
const ats = scripts.find((script) => script !== linkedin);
assert.equal(ats.match_origin_as_fallback, true);
assert.equal(ats.matches.length, 10);
assert.ok(ats.js.includes('content-scripts/ats.js'), 'Dynamic site registration depends on this asset');
for (const script of scripts) {
  assert.equal(script.all_frames, true);
  assert.equal(script.run_at, 'document_idle');
  for (const pattern of script.matches) {
    assert.ok(pattern.startsWith('https://'), `Unexpected automatic access: ${pattern}`);
    if (script.match_origin_as_fallback) {
      assert.match(pattern, /^https:\/\/[^/]+\/\*$/, `Origin fallback cannot restrict paths: ${pattern}`);
    }
  }
  for (const file of script.js) await access(join(directory, file));
}
assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'contextMenus', 'scripting', 'sidePanel', 'storage', 'unlimitedStorage'].sort());
assert.deepEqual(manifest.optional_host_permissions, ['<all_urls>']);
for (const file of ['background.js', manifest.side_panel.default_path, manifest.options_ui.page]) {
  await access(join(directory, file));
}
console.log(`Manifest smoke check passed: ${directory}`);
