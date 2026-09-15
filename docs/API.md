# Firefox API

The Firefox option translates common Chrome extension behavior after SvelteKit finishes building. Chrome builds are unchanged when the option is disabled.

## API and custom options

### Enable the defaults

Set `firefox` to `true`:

```js
adapter({
	pages: 'extension',
	assets: 'extension',
	firefox: true,
	firefoxBuildScript: 'build-firefox'
})
```

`firefoxBuildScript` defaults to `build-firefox`. Firefox transformations run when that npm script is active, or when `ADAPTER_EXTENSION_FIREFOX=1` is set. Chrome builds stay unchanged unless one of those conditions is true.

```sh
ADAPTER_EXTENSION_FIREFOX=1 vite build
```

This enables:

- Firefox manifest validation and safe inference of required fields
- `background.scripts` generation from `background.service_worker`, then removal of `service_worker` (Firefox MV3 / `web-ext` / AMO reject the Chrome key)
- `side_panel` conversion to `sidebar_action`
- An inferred toolbar `action` (`default_title` from `name`, `default_icon` from `icons`) when converting `side_panel` and `action` is missing, so Firefox has a button for the side-panel shim. An existing `action` is left alone.
- Removal of Chrome-only permissions Firefox rejects: `sidePanel`, `identity.email`, and `offscreen`
- When `permissions` includes `identity` and `browser_specific_settings.gecko.id` is set, a Firefox-build-only host permission `https://<sha1(gecko.id)>.extensions.allizom.org/*` (hex SHA-1, matching `identity.getRedirectURL()`). This is not added to the Chrome source manifest. If `gecko.id` is missing, the host is skipped and the existing warning still applies.
- Compatibility handling for `chrome.sidePanel` and `browser.sidePanel`
- A build warning when generated JavaScript uses `identity.getProfileUserInfo` (Chrome-only; not shimmed). Silence with `firefox.warnIdentityProfile: false`
- Rewriting `.innerHTML =` to `["innerHTML"] =` in generated `.js` files so Firefox extension CSP does not reject bundled Svelte output

When a manifest field is inferred, the build prints the inferred value, a reminder to add it permanently, and a link to the relevant MDN documentation. If a required value cannot be safely inferred, the adapter warns without inventing a value. The identity redirect host is logged as Firefox-build-only and should not be copied into the Chrome source `manifest.json`.

### Optional permission lists

After the built-in manifest transforms, add or remove Firefox-only permissions:

```js
adapter({
	pages: 'extension',
	assets: 'extension',
	firefox: {
		permissions: {
			add: ['cookies'],
			remove: ['storage']
		},
		hostPermissions: {
			add: ['https://example.com/*']
		}
	}
})
```

`add` concatenates and deduplicates. `remove` filters matching permission strings. Use this instead of a one-off patch script for Firefox-only permissions.

### `identity.getProfileUserInfo`

This API is Chrome-only. The adapter does not rewrite or stub it. If generated JavaScript still contains `chrome.identity.getProfileUserInfo` or `browser.identity.getProfileUserInfo`, the Firefox build prints a warning to add a feature-detect fallback.

Silence that warning after you have a fallback:

```js
adapter({
	pages: 'extension',
	assets: 'extension',
	firefox: {
		warnIdentityProfile: false
	}
})
```

### Add custom replacements

Pass `apiReplacements` when an extension uses an API or expression that needs different Firefox behavior:

```js
adapter({
	pages: 'extension',
	assets: 'extension',
	firefox: {
		apiReplacements: [
			{
				find: 'chrome.exampleApi',
				replace: 'browser.firefoxApi'
			}
		]
	}
})
```

Each replacement has:

- `find`: a string or `RegExp`
- `replace`: a string or synchronous replacement function

A string `find` replaces every occurrence. A regular expression follows normal JavaScript replacement behavior, so include the `g` flag when every match should be changed.

Custom replacements run against every generated `.js` file before the built-in Firefox replacements, including `.innerHTML =` → `["innerHTML"] =`.

### Regular expression replacements

Use a regular expression when arguments or formatting can vary:

```js
firefox: {
	apiReplacements: [
		{
			find: /chrome\.exampleApi\.open\((.*?)\)/g,
			replace: 'browser.firefoxApi.launch($1)'
		}
	]
}
```

Keep expressions as narrow as possible. Broad patterns can unintentionally modify strings, dependencies, or unrelated APIs in the generated bundle.

### Replacement functions

Use a function when the replacement depends on captured values:

```js
firefox: {
	apiReplacements: [
		{
			find: /chrome\.exampleApi\.setValue\((.*?)\)/g,
			replace: (_match, value) => `browser.firefoxApi.update({ value: ${value} })`
		}
	]
}
```

Replacement functions use the standard `[String.prototype.replace](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String/replace)` callback arguments and must return replacement source code synchronously.

### Manifest values that require developer input

Some Firefox values cannot be inferred accurately from Chrome metadata:

- `browser_specific_settings.gecko.id` is required to sign Manifest V3 extensions.
- `browser_specific_settings.gecko.data_collection_permissions.required` is required for new AMO submissions.

Add these values to the source `manifest.json` rather than relying on generated-build changes:

```json
{
	"browser_specific_settings": {
		"gecko": {
			"id": "extension@example.com",
			"data_collection_permissions": {
				"required": ["none"]
			}
		}
	}
}
```

Only declare `none` when the extension does not collect or transmit the data categories defined by Mozilla. See `[browser_specific_settings](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)` for valid declarations.

## Finding and adapting incompatible extension code

Use this process before adding replacements. It is suitable for developers and coding agents reviewing an extension.

### 1. Search the source

Search JavaScript, TypeScript, Svelte files, and the manifest:

```sh
rg -n "\bchrome\.|\bbrowser\." src static
rg -n '"(side_panel|background|permissions|host_permissions|content_security_policy)"' static
```

Adjust the directories to match the project. Also search standalone background scripts and files copied directly into the extension output.

Build the extension and repeat the API search against the generated directory:

```sh
npm run build
rg -n "\bchrome\.|\bbrowser\." extension
```

Searching both locations matters because dependencies and generated bundles may introduce API usage that is absent from the source.

### 2. Check actual browser compatibility

For every API and manifest key found:

1. Check the [MDN WebExtensions API index](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API).
2. Check [Chrome incompatibilities](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities).
3. Open the API's browser compatibility section and verify each method, event, argument, and return type.
4. Check the extension's minimum Firefox version when evaluating support.

Do not replace every `chrome.` namespace with `browser.`. Firefox supports much of the `chrome` namespace for compatibility, and a blanket replacement can break callback-based code or change error handling.

### 3. Classify each result

For each match, decide whether it is:

- Fully compatible and needs no change
- Already handled by the adapter
- Compatible under a different Firefox API
- Partially compatible and needs argument or result translation
- Unsupported and needs a fallback or disabled feature
- A manifest-only difference rather than a JavaScript API difference

The built-in adapter already handles common side-panel calls and `.innerHTML =` assignments in generated JavaScript. Do not add duplicate replacements for those APIs unless the extension requires different behavior. `identity.getProfileUserInfo` is not shimmed; add a feature-detect fallback in extension source.

### 4. Choose the smallest safe replacement

Use a string replacement only for an exact namespace or method rename:

```js
{
	find: 'chrome.exampleApi.get',
	replace: 'browser.firefoxApi.get'
}
```

Use a regular expression when call syntax needs to change:

```js
{
	find: /chrome\.exampleApi\.open\(\{\s*path:\s*(.*?)\s*\}\)/g,
	replace: 'browser.firefoxApi.open($1)'
}
```

Use a replacement function when captured arguments require restructuring:

```js
{
	find: /chrome\.exampleApi\.update\((.*?),\s*(.*?)\)/g,
	replace: (_match, id, value) =>
		`browser.firefoxApi.update({ id: ${id}, value: ${value} })`
}
```

If a replacement would require parsing nested JavaScript, tracking variable types, or changing control flow, update the extension source instead. Regular expressions are not a safe JavaScript parser.

### 5. Preserve behavior

Confirm that the Firefox replacement retains:

- Promise or callback behavior expected by the caller
- Error handling
- Event listener registration and removal
- Required permissions
- Tab and window scoping
- User-gesture requirements
- Equivalent return values

When no equivalent Firefox API exists, use an explicit fallback. Do not silently report success if the feature did not run.

### 6. Configure and verify

Add the reviewed replacements to the Firefox options:

```js
firefox: {
	apiReplacements: [
		{
			find: 'chrome.exampleApi',
			replace: 'browser.firefoxApi'
		}
	]
}
```

Then:

1. Run the Firefox build.
2. Review every adapter warning.
3. Search the generated output again for the incompatible API.
4. Run `[web-ext lint](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/)`.
5. Load the generated extension temporarily in Firefox.
6. Exercise each changed feature and inspect the browser console.
7. Verify the Chrome build separately to ensure Firefox transformations were not enabled for it.

An agent completing this process should report the APIs found, supporting compatibility documentation, replacements added, remaining unsupported behavior, and the verification performed.