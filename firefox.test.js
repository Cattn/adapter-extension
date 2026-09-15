import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyFirefoxSupport } from './firefox.js';

function createOutputDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-firefox-'));
}

function writeBuild(outputDir, { manifest, files = {} }) {
	fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest));
	for (const [relativePath, contents] of Object.entries(files)) {
		const filePath = path.join(outputDir, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, contents);
	}
}

function readManifest(outputDir) {
	return JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf-8'));
}

test('translates a Chrome extension build for Firefox', async () => {
	const outputDir = createOutputDir();

	try {
		writeBuild(outputDir, {
			manifest: {
				short_name: 'Fixture',
				version_name: '1.2.3',
				background: { service_worker: 'worker.js' },
				side_panel: { default_path: 'index.html' },
				permissions: ['sidePanel', 'storage']
			},
			files: {
				'worker.js':
					'chrome.sidePanel.open({ tabId: 1 }); chrome.identity.getProfileUserInfo(); chrome.exampleApi();'
			}
		});

		await applyFirefoxSupport(outputDir, {
			apiReplacements: [{ find: 'chrome.exampleApi', replace: 'browser.exampleApi' }]
		});

		const manifest = readManifest(outputDir);
		const source = fs.readFileSync(path.join(outputDir, 'worker.js'), 'utf-8');

		assert.equal(manifest.manifest_version, 3);
		assert.equal(manifest.name, 'Fixture');
		assert.equal(manifest.version, '1.2.3');
		assert.deepEqual(manifest.background.scripts, ['worker.js']);
		assert.equal(manifest.background.service_worker, undefined);
		assert.equal(manifest.sidebar_action.default_panel, 'index.html');
		assert.equal(manifest.action.default_title, 'Fixture');
		assert.deepEqual(manifest.permissions, ['storage']);
		assert.match(source, /__adapterExtensionFirefox\.sidePanel/);
		assert.match(source, /__adapterExtensionFirefox\.getProfileUserInfo/);
		assert.match(source, /browser\.exampleApi/);
		new Function(source);
	} finally {
		fs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('adds action when converting side_panel without one', async () => {
	const outputDir = createOutputDir();

	try {
		writeBuild(outputDir, {
			manifest: {
				name: 'Panel',
				icons: { 16: 'icon-16.png', 48: 'icon-48.png' },
				side_panel: { default_path: 'index.html' }
			}
		});

		await applyFirefoxSupport(outputDir);

		const manifest = readManifest(outputDir);
		assert.equal(manifest.side_panel, undefined);
		assert.deepEqual(manifest.sidebar_action, {
			default_panel: 'index.html',
			default_title: 'Panel',
			default_icon: { 16: 'icon-16.png', 48: 'icon-48.png' }
		});
		assert.deepEqual(manifest.action, {
			default_title: 'Panel',
			default_icon: { 16: 'icon-16.png', 48: 'icon-48.png' }
		});
	} finally {
		fs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('leaves an existing action unchanged when converting side_panel', async () => {
	const outputDir = createOutputDir();

	try {
		const action = {
			default_title: 'Open panel',
			default_icon: { 16: 'toolbar.png' }
		};
		writeBuild(outputDir, {
			manifest: {
				name: 'Panel',
				icons: { 16: 'icon-16.png' },
				action,
				side_panel: { default_path: 'index.html' }
			}
		});

		await applyFirefoxSupport(outputDir);

		assert.deepEqual(readManifest(outputDir).action, action);
	} finally {
		fs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('replaces background.service_worker with scripts', async () => {
	const outputDir = createOutputDir();

	try {
		writeBuild(outputDir, {
			manifest: {
				name: 'Worker',
				background: { service_worker: 'worker.js' }
			}
		});

		await applyFirefoxSupport(outputDir);

		const manifest = readManifest(outputDir);
		assert.deepEqual(manifest.background, { scripts: ['worker.js'] });
		assert.equal('service_worker' in manifest.background, false);
	} finally {
		fs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('strips Chrome-only permissions rejected by Firefox', async () => {
	const outputDir = createOutputDir();

	try {
		writeBuild(outputDir, {
			manifest: {
				name: 'Permissions',
				side_panel: { default_path: 'index.html' },
				permissions: ['sidePanel', 'identity.email', 'offscreen', 'storage', 'tabs']
			}
		});

		await applyFirefoxSupport(outputDir);

		assert.deepEqual(readManifest(outputDir).permissions, ['storage', 'tabs']);
	} finally {
		fs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('adds the hashed Firefox identity redirect host when identity and gecko.id are set', async () => {
	const outputDir = createOutputDir();
	const geckoId = 'addon@example.com';
	const hash = createHash('sha1').update(geckoId).digest('hex');

	try {
		writeBuild(outputDir, {
			manifest: {
				name: 'Identity',
				permissions: ['identity', 'storage'],
				host_permissions: ['https://example.com/*'],
				browser_specific_settings: {
					gecko: { id: geckoId }
				}
			}
		});

		await applyFirefoxSupport(outputDir);

		assert.deepEqual(readManifest(outputDir).host_permissions, [
			'https://example.com/*',
			`https://${hash}.extensions.allizom.org/*`
		]);
	} finally {
		fs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('does not add the identity redirect host without the identity permission', async () => {
	const outputDir = createOutputDir();

	try {
		writeBuild(outputDir, {
			manifest: {
				name: 'No identity',
				permissions: ['storage'],
				browser_specific_settings: {
					gecko: { id: 'addon@example.com' }
				}
			}
		});

		await applyFirefoxSupport(outputDir);

		assert.equal(readManifest(outputDir).host_permissions, undefined);
	} finally {
		fs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('rewrites bundled .innerHTML assignments', async () => {
	const outputDir = createOutputDir();

	try {
		writeBuild(outputDir, {
			manifest: { name: 'HTML' },
			files: {
				'scripts/immutable/bundle.js': 'function render(el, html) { el.innerHTML = html; }'
			}
		});

		await applyFirefoxSupport(outputDir);

		const source = fs.readFileSync(
			path.join(outputDir, 'scripts', 'immutable', 'bundle.js'),
			'utf-8'
		);
		assert.match(source, /el\["innerHTML"\] = html;/);
		assert.doesNotMatch(source, /\.innerHTML =/);
	} finally {
		fs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('applies optional permission and host permission lists', async () => {
	const outputDir = createOutputDir();

	try {
		writeBuild(outputDir, {
			manifest: {
				name: 'Optional',
				permissions: ['storage', 'tabs', 'cookies'],
				host_permissions: ['https://example.com/*']
			}
		});

		await applyFirefoxSupport(outputDir, {
			permissions: {
				add: ['cookies', 'alarms'],
				remove: ['tabs']
			},
			hostPermissions: {
				add: ['https://example.com/*', 'https://api.example.com/*']
			}
		});

		const manifest = readManifest(outputDir);
		assert.deepEqual(manifest.permissions, ['storage', 'cookies', 'alarms']);
		assert.deepEqual(manifest.host_permissions, [
			'https://example.com/*',
			'https://api.example.com/*'
		]);
	} finally {
		fs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('runs custom apiReplacements before built-in JavaScript rewrites', async () => {
	const outputDir = createOutputDir();

	try {
		writeBuild(outputDir, {
			manifest: { name: 'Replacements' },
			files: {
				'app.js': 'el.innerHTML = html; chrome.exampleApi();'
			}
		});

		await applyFirefoxSupport(outputDir, {
			apiReplacements: [
				{ find: '.innerHTML =', replace: '.textContent =' },
				{ find: 'chrome.exampleApi', replace: 'browser.exampleApi' }
			]
		});

		const source = fs.readFileSync(path.join(outputDir, 'app.js'), 'utf-8');
		assert.match(source, /el\.textContent = html;/);
		assert.match(source, /browser\.exampleApi\(\);/);
		assert.doesNotMatch(source, /\["innerHTML"\]/);
		assert.doesNotMatch(source, /chrome\.exampleApi/);
	} finally {
		fs.rmSync(outputDir, { recursive: true, force: true });
	}
});
