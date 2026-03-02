import fs from 'fs';

// gulp-real-favicon provides generateFavicon and checkForUpdates with callback APIs
// that don't actually need gulp streams.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import realFavicon from 'gulp-real-favicon';

const FAVICON_DATA_FILE = 'favicon_data.json';

export const generateFavicon = (appTitle: string): Promise<void> => {
	return new Promise<void>((resolve, reject) => {
		realFavicon.generateFavicon({
			masterPicture: 'logo.svg',
			dest: 'images/',
			iconsPath: '/images',
			design: {
				ios: {
					pictureAspect: 'backgroundAndMargin',
					backgroundColor: '#ffffff',
					margin: '14%',
					assets: {
						ios6AndPriorIcons: false,
						ios7AndLaterIcons: false,
						precomposedIcons: false,
						declareOnlyDefaultIcon: true
					}
				},
				desktopBrowser: {
					design: 'raw'
				},
				windows: {
					pictureAspect: 'whiteSilhouette',
					backgroundColor: '#603cba',
					onConflict: 'override',
					assets: {
						windows80Ie10Tile: false,
						windows10Ie11EdgeTiles: {
							small: false,
							medium: true,
							big: false,
							rectangle: false
						}
					}
				},
				androidChrome: {
					pictureAspect: 'shadow',
					themeColor: '#ffffff',
					manifest: {
						name: appTitle,
						display: 'standalone',
						orientation: 'notSet',
						onConflict: 'override',
						declared: true
					},
					assets: {
						legacyIcon: false,
						lowResolutionIcons: false
					}
				},
				safariPinnedTab: {
					pictureAspect: 'silhouette',
					themeColor: '#5e2b97'
				}
			},
			settings: {
				scalingAlgorithm: 'Mitchell',
				errorOnImageTooSmall: false,
				readmeFile: false,
				htmlCodeFile: false,
				usePathAsIs: false
			},
			markupFile: FAVICON_DATA_FILE
		}, (err: unknown) => {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
};

export const injectFaviconMarkups = (): Promise<void> => {
	return new Promise<void>((resolve, reject) => {
		const faviconData = JSON.parse(fs.readFileSync(FAVICON_DATA_FILE).toString());
		const htmlMarkups: string[] = faviconData.favicon.html_code;
		const fileContent = fs.readFileSync('index.html');

		// Use rfg-api directly via gulp-real-favicon's underlying implementation
		// The injectFaviconMarkups on the module uses gulp streams, but rfg-api
		// exposes a callback-based version. We access it through require.
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const rfg = require('rfg-api').init();
		rfg.injectFaviconMarkups(fileContent, htmlMarkups, {}, (err: unknown, html: string) => {
			if (err) {
				reject(err);
				return;
			}
			fs.writeFileSync('index.html', html);
			resolve();
		});
	});
};

export const checkForFaviconUpdate = (): void => {
	const currentVersion = JSON.parse(fs.readFileSync(FAVICON_DATA_FILE).toString()).version;
	realFavicon.checkForUpdates(currentVersion, (err: unknown) => {
		if (err) {
			throw err;
		}
	});
};
