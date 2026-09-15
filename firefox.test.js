import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyFirefoxSupport } from './firefox.js';

test('translates a Chrome extension build for Firefox', async () => {
	const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-firefox-'));

	try {
		fs.writeFileSync(
			path.join(outputDir, 'manifest.json'),
			JSON.stringify({
				short_name: 'Fixture',
				version_name: '1.2.3',
				background: { service_worker: 'worker.js' },
				side_panel: { default_path: 'index.html' },
				permissions: ['sidePanel', 'storage']
			})
		);
		fs.writeFileSync(
			path.join(outputDir, 'worker.js'),
			'chrome.sidePanel.open({ tabId: 1 }); chrome.identity.getProfileUserInfo(); chrome.exampleApi();'
		);

		await applyFirefoxSupport(outputDir, {
			apiReplacements: [{ find: 'chrome.exampleApi', replace: 'browser.exampleApi' }]
		});

		const manifest = JSON.parse(
			fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf-8')
		);
		const source = fs.readFileSync(path.join(outputDir, 'worker.js'), 'utf-8');

		assert.equal(manifest.manifest_version, 3);
		assert.equal(manifest.name, 'Fixture');
		assert.equal(manifest.version, '1.2.3');
		assert.deepEqual(manifest.background.scripts, ['worker.js']);
		assert.equal(manifest.background.service_worker, 'worker.js');
		assert.equal(manifest.sidebar_action.default_panel, 'index.html');
		assert.deepEqual(manifest.permissions, ['storage']);
		assert.match(source, /__adapterExtensionFirefox\.sidePanel/);
		assert.match(source, /__adapterExtensionFirefox\.getProfileUserInfo/);
		assert.match(source, /browser\.exampleApi/);
		new Function(source);
	} finally {
		fs.rmSync(outputDir, { recursive: true, force: true });
	}
});
