# Development

This readme has information on patterns for developing.

## Running Cloud Functions locally

Ensure you're using dev not prod:

```
firebase use <DEV_PROJECT_ID>
```

Make sure you have admin credentials (https://firebase.google.com/docs/functions/local-shell):

Generate a key and downlaod it to e.g. `~/.firebase-keys/KEY.json`

```
#the path has to be fully specified
export GOOGLE_APPLICATION_CREDENTIALS="/Users/<USERNAME>/.firebase-keys/KEY.json"
```

Download your server-side config:

```
firebase functions:config:get > .runtimeconfig.json
```

Run the shell:

```
firebase functions:shell
```

Within the shell, call the cloudfunction:

```
screenshot.get('CARD-ID')
```

Note that there screenshot.js's DISABLE_SCREENSHOT_CACHE can be set to true
during development. Also note that puppeteer can be launched with headless:false
and slowMo:100 to view what's going on.