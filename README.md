# complexity-compendium
Simple forwarder for complexity-compendium.com

### Updating slides

Run `Create snapshot` in the sheet.

Copy/paste the output from the dialog at end into slides.json, check in, and deploy.

### Developing

`firebase serve`

### Deploying

`firebase deploy`


### Setting up new computer

Install firebase tools: 

`npm install -g firebase-tools`

`firebase use complexity-compendium`


## New webapp

### Developing

`cd webapp`

`polymer serve`

### Deploying

TODO


### Backing up

Instructions are here: https://firebase.google.com/docs/firestore/manage-data/export-import (see that for initial set up)

Run `gcloud config set project complexity-compendium`

Run `gcloud beta firestore export gs://complexity-compendium-backup`


### Restoring a back up

Run `gcloud config set project dev-complexity-compendium` (if running in devmode)

Run `gcloud beta firestore import gs://complexity-compendium-backup/[EXPORT_PREFIX]/` where EXPORT-PREFIX is the name of the folder you want to import.

### Setting up a new computer

See above, also `cd webapp`, `npm install`

