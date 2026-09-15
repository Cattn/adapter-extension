# adapter-extension

Svelte adapter that makes chrome extension support easier

## Installation

`npm i -D @cattn/adapter-extension`

## Usage

### Svelte Config

Your `svelte.config.js` should look something like this. Feel free to change the adapter values, these are just my suggested ones.

```js
import adapter from '@cattn/adapter-extension';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		appDir: 'scripts',
		adapter: adapter({
			// default options are shown. On some platforms
			// these options are set automatically — see below
			pages: 'extension',
			assets: 'extension',
			fallback: undefined,
			precompress: false,
			strict: true,
			firefox: true,
		}),
		output: {
			bundleStrategy: 'single'
		}
	},
};

export default config;
```

Also, make sure you have `routes/+layout.ts` created, with the following

```js
export const prerender = true;
```

### Chrome Manifest Options

Make sure in your chrome manifest, you have the following (you can change `<all_urls>` to whatever set of URLs your extension will be active on. Also, `scripts` may be different depending on your `appDir` value.)

> Note: This is only needed if your extension is intended to run in the background of the page. If your extension is a sidebar/popup, this won't be needed.)

```json
"content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["scripts/init.js"]
    }
  ],
```

Also, I'd recommend putting your `manifest.json`, and any other seperate scripts, in your `static/` folder, as that will be copied directly into your build folder, allowing for a seamless build.

### Firefox Support

Set `firefox: true` and add a `build-firefox` npm script:

```js
adapter({
	pages: 'extension',
	assets: 'extension',
	firefox: true,
	firefoxBuildScript: 'build-firefox'
})
```

```json
{
	"scripts": {
		"build": "vite build",
		"build-firefox": "vite build"
	}
}
```

The adapter applies Firefox changes only when running `npm run build-firefox`, so regular Chrome builds remain unchanged. `firefoxBuildScript` defaults to `build-firefox` and can be changed to match another npm script name.

Firefox support translates Chrome side panels and background service workers, patches common incompatible API calls, fills required manifest values when they can be inferred, and warns when a value must be supplied manually.

Manifest V3 extensions intended for signing must provide `browser_specific_settings.gecko.id`. New AMO submissions must also declare `browser_specific_settings.gecko.data_collection_permissions.required`.

Custom API replacements can be strings, regular expressions, or replacement functions:

```js
adapter({
	pages: 'extension',
	assets: 'extension',
	firefoxBuildScript: 'build-firefox',
	firefox: {
		apiReplacements: [
			{
				find: 'chrome.exampleApi',
				replace: 'browser.firefoxApi'
			},
			{
				find: /chrome\.otherApi\.open\((.*?)\)/g,
				replace: (_match, value) => `browser.otherApi.launch(${value})`
			}
		]
	}
})
```

Custom replacements run only for Firefox builds and before the built-in compatibility replacements.

See the [Firefox API documentation](docs/api.md) for complete options and compatibility-review instructions.

## Other info

This adapter uses `adapter-static` under the hood, with a few modifications to make building for chrome extensions slightly less painful.

With this, you can use chrome extension APIs directly in your svelte app.

## Why not an existing adapter?

Honestly, I felt that existing adapters either entrenched too much on how my code was built, or had weird requirements. This adapter attempts to be as minimal as possible, providing exactly what's necessary to build your svelte app in an extension-friendly format. It also should support different browser's extension formats much easier!

Also, most other packages I found were out of date/not made with Svelte 5 in mind.