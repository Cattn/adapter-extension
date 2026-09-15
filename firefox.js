import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const chromeOnlyPermissions = new Set(['sidePanel', 'identity.email', 'offscreen']);

const prefix = '[adapter-extension:firefox]';
const compatibilityName = '__adapterExtensionFirefox';
const compatibilitySource = `globalThis.${compatibilityName} ??= {};
globalThis.${compatibilityName}.sidePanel ??= {
	open: () => browser.sidebarAction.open(),
	close: () => browser.sidebarAction.close(),
	toggle: () => browser.sidebarAction.toggle(),
	getOptions: async (details = {}) => ({ path: await browser.sidebarAction.getPanel(details) }),
	setOptions: ({ path, enabled, ...details } = {}) => {
		if (enabled === false) return browser.sidebarAction.close();
		if (path !== undefined) details.panel = path;
		return Object.keys(details).length > 0
			? browser.sidebarAction.setPanel(details)
			: Promise.resolve();
	},
	setPanelBehavior: ({ openPanelOnActionClick } = {}) => {
		const compatibility = globalThis.${compatibilityName};
		if (openPanelOnActionClick && !compatibility.actionClickListener) {
			compatibility.actionClickListener = () => browser.sidebarAction.toggle();
			browser.action.onClicked.addListener(compatibility.actionClickListener);
		} else if (!openPanelOnActionClick && compatibility.actionClickListener) {
			browser.action.onClicked.removeListener(compatibility.actionClickListener);
			delete compatibility.actionClickListener;
		}
		return Promise.resolve();
	}
};
globalThis.${compatibilityName}.getProfileUserInfo ??= (...args) => {
	const result = { email: '', id: '' };
	const callback = args.find((argument) => typeof argument === 'function');
	if (callback) {
		callback(result);
		return;
	}
	return Promise.resolve(result);
};
`;

function warn(message) {
	console.warn(`${prefix} ${message}`);
}

function warnInferred(field, value, documentation) {
	warn(
		`${field} was inferred as ${JSON.stringify(value)} for this build. Add it to manifest.json permanently. ${documentation}`
	);
}

function inferRequiredFields(manifest) {
	if (manifest.manifest_version === undefined) {
		if (manifest.background?.service_worker || manifest.action || manifest.side_panel) {
			manifest.manifest_version = 3;
			warnInferred(
				'manifest_version',
				manifest.manifest_version,
				'https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/manifest_version'
			);
		} else {
			warn(
				'manifest_version is required and could not be inferred from the manifest. https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/manifest_version'
			);
		}
	}

	if (!manifest.name) {
		const inferredName =
			manifest.short_name ||
			manifest.action?.default_title ||
			manifest.browser_action?.default_title ||
			manifest.sidebar_action?.default_title;

		if (inferredName) {
			manifest.name = inferredName;
			warnInferred(
				'name',
				manifest.name,
				'https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/name'
			);
		} else {
			warn(
				'name is required and could not be inferred from the manifest. https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/name'
			);
		}
	}

	if (!manifest.version) {
		if (/^\d+(?:\.\d+){0,3}$/.test(manifest.version_name ?? '')) {
			manifest.version = manifest.version_name;
			warnInferred(
				'version',
				manifest.version,
				'https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/version'
			);
		} else {
			warn(
				'version is required and could not be inferred from the manifest. https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/version'
			);
		}
	}
}

function updateFirefoxSettings(manifest) {
	const legacyGecko = manifest.applications?.gecko;
	manifest.browser_specific_settings ??= {};

	if (legacyGecko && !manifest.browser_specific_settings.gecko) {
		manifest.browser_specific_settings.gecko = { ...legacyGecko };
	}

	const gecko = manifest.browser_specific_settings.gecko;
	if (!gecko?.id && manifest.manifest_version === 3) {
		warn(
			'browser_specific_settings.gecko.id is required to sign a Manifest V3 extension. https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings'
		);
	}

	if (!gecko?.data_collection_permissions?.required) {
		warn(
			'browser_specific_settings.gecko.data_collection_permissions.required is required for new AMO submissions. https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings'
		);
	}
}

function updateBackground(manifest) {
	if (!manifest.background?.service_worker) return;

	manifest.background.scripts ??= [manifest.background.service_worker];
	delete manifest.background.service_worker;
}

function updateSidebar(manifest) {
	if (!manifest.side_panel) return;

	const defaultPanel = manifest.side_panel.default_path;
	if (!defaultPanel) {
		warn(
			'side_panel.default_path is required to create Firefox sidebar_action.default_panel. https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/sidebar_action'
		);
		return;
	}

	manifest.sidebar_action ??= {
		default_panel: defaultPanel,
		default_title: manifest.name,
		default_icon: manifest.action?.default_icon ?? manifest.icons
	};
	delete manifest.side_panel;

	if (!manifest.action) {
		manifest.action = {
			default_title: manifest.name,
			default_icon: manifest.icons
		};
		warnInferred(
			'action',
			manifest.action,
			'https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/action'
		);
	}
}

function stripChromeOnlyPermissions(manifest) {
	if (!manifest.permissions) return;

	manifest.permissions = manifest.permissions.filter(
		(permission) => !chromeOnlyPermissions.has(permission)
	);
}

function addIdentityRedirectHost(manifest) {
	if (!(manifest.permissions ?? []).includes('identity')) return;

	const geckoId = manifest.browser_specific_settings?.gecko?.id;
	if (!geckoId) return;

	const hash = crypto.createHash('sha1').update(geckoId).digest('hex');
	const host = `https://${hash}.extensions.allizom.org/*`;

	manifest.host_permissions ??= [];
	if (manifest.host_permissions.includes(host)) return;

	manifest.host_permissions.push(host);
	warn(`Added ${host} to host_permissions for this Firefox build only.`);
}

function uniqueConcat(existing, additions) {
	return [...new Set([...(existing ?? []), ...additions])];
}

function applyOptionalPermissions(manifest, options) {
	if (options.permissions?.add?.length) {
		manifest.permissions = uniqueConcat(manifest.permissions, options.permissions.add);
	}

	if (options.permissions?.remove?.length) {
		const remove = new Set(options.permissions.remove);
		manifest.permissions = (manifest.permissions ?? []).filter(
			(permission) => !remove.has(permission)
		);
	}

	if (options.hostPermissions?.add?.length) {
		manifest.host_permissions = uniqueConcat(
			manifest.host_permissions,
			options.hostPermissions.add
		);
	}
}

function updateDefaultLocale(outputDir, manifest) {
	const localesDir = path.join(outputDir, '_locales');
	if (!fs.existsSync(localesDir) || manifest.default_locale) return;

	const locales = fs
		.readdirSync(localesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	const defaultLocale = locales.find((locale) => /^en(?:[_-]|$)/i.test(locale)) ?? locales[0];

	if (defaultLocale) {
		manifest.default_locale = defaultLocale;
		warnInferred(
			'default_locale',
			manifest.default_locale,
			'https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/default_locale'
		);
	} else {
		warn(
			'default_locale is required when _locales exists and no locale could be inferred. https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/default_locale'
		);
	}
}

function patchManifest(outputDir, options = {}) {
	const manifestPath = path.join(outputDir, 'manifest.json');
	if (!fs.existsSync(manifestPath)) {
		warn(`No manifest.json was found in ${outputDir}.`);
		return undefined;
	}

	let manifest;
	try {
		manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
	} catch (error) {
		warn(`manifest.json could not be parsed: ${error.message}`);
		return undefined;
	}

	inferRequiredFields(manifest);
	updateFirefoxSettings(manifest);
	updateBackground(manifest);
	updateSidebar(manifest);
	stripChromeOnlyPermissions(manifest);
	addIdentityRedirectHost(manifest);
	updateDefaultLocale(outputDir, manifest);
	applyOptionalPermissions(manifest, options);

	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
	return manifest;
}

function validateReplacements(replacements) {
	if (!Array.isArray(replacements)) {
		throw new TypeError(`${prefix} apiReplacements must be an array.`);
	}

	for (const replacement of replacements) {
		const validFind = typeof replacement?.find === 'string' || replacement?.find instanceof RegExp;
		const validReplace =
			typeof replacement?.replace === 'string' || typeof replacement?.replace === 'function';

		if (!validFind || !validReplace) {
			throw new TypeError(
				`${prefix} each apiReplacement must contain a string or RegExp find and a string or function replace.`
			);
		}
	}
}

function applyReplacement(source, replacement) {
	if (typeof replacement.find === 'string') {
		return source.replaceAll(replacement.find, replacement.replace);
	}

	return source.replace(replacement.find, replacement.replace);
}

function patchJavascript(outputDir, apiReplacements) {
	const files = [];
	const directories = [outputDir];

	while (directories.length > 0) {
		const directory = directories.pop();
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				directories.push(entryPath);
			} else if (entry.isFile() && entry.name.endsWith('.js')) {
				files.push(entryPath);
			}
		}
	}

	for (const filePath of files) {
		let source = fs.readFileSync(filePath, 'utf-8');
		for (const replacement of apiReplacements) {
			source = applyReplacement(source, replacement);
		}

		source = source.replaceAll('.innerHTML =', '["innerHTML"] =');

		const usesSidePanel = /\b(?:chrome|browser)\.sidePanel\b/.test(source);
		const usesProfileUserInfo =
			/\b(?:chrome|browser)\.identity\.getProfileUserInfo\b/.test(source);

		source = source
			.replace(
				/\b(?:chrome|browser)\.identity\.getProfileUserInfo\b/g,
				`globalThis.${compatibilityName}.getProfileUserInfo`
			)
			.replace(
				/\b(?:chrome|browser)\.sidePanel\b/g,
				`globalThis.${compatibilityName}.sidePanel`
			);

		if (
			(usesSidePanel || usesProfileUserInfo) &&
			!source.startsWith(`globalThis.${compatibilityName}`)
		) {
			source = `${compatibilitySource}\n${source}`;
		}

		fs.writeFileSync(filePath, source, 'utf-8');
	}
}

export async function applyFirefoxSupport(outputDir, options = {}) {
	const apiReplacements = options.apiReplacements ?? [];
	validateReplacements(apiReplacements);

	patchManifest(outputDir, options);
	patchJavascript(outputDir, apiReplacements);
}
