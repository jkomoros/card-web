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
export GOOGLE_APPLICATION_CREDENTIALS="~/.firebase-keys/KEY.json"
```

Download your server-side config:

```
firebase functions:config:get > .runtimeconfig.json
```