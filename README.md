# Card Web
This project is the webapp that powers https://thecompendium.cards

The project is messy, with lots of intricate details and designs captured as a messy collection of issues. This is to [minimize my activation energy](https://thecompendium.cards/c/incremental-work-minimizes-activation-cost) for this hobby project, but it might be overwhelming for others. Nevertheless, please feel free to comment and participate!

The app is possible to run an instance of with some configuration, but there's still some pieces missing that aren't generalized. If you have any interest in standing up an instance on your own that is blocked, issue #164 tracks the work to make it fully general. Please chime in there and I'll prioritize that work!

The web app has a number of advanced features that aren't immediately obvious in the UI, or visible to non-editors. You can learn more about them [here](https://github.com/jkomoros/card-web/wiki/Advanced-Functionality). The features make it possible to use this less as a CMS and more as a personal knowledge garden.

## Getting set up

### First Run

Download this repository and cd into it.

Run `npm install` to install all of the dependencies.

Run `npm install -g firebase-tools gulp` (you can skip any of those that you already have installed)

Also run `npm install` in the `functions/` directory.

Install the `gcloud` and `gsutil` commands by following the instructiosn at https://cloud.google.com/sdk/docs/install . (That one set of instructions will install both)

Run `cp config.SAMPLE.json config.SECRET.json`

Go to https://console.firebase.google.com. Create a new project. On the project overview, where it says "Get started by adding Firebase to your app", tap the web icon.  Give it a nickname. Tap set up. In the code snippet that appears, copy the JSON blob that is assigned to the `firebaseConfig` variable.

Paste that JSON blob in your `config.SECRET.json` file, where the sample "firebase" value is. You might have to change the formatting to make it valid JSON. (You can read more about all of the valid settings for this in the Config file keys section later in this README).

Run `npm run generate:config`. This copies the config you just set into various static files in the project.

Go back to the Firebase console. Go to the project overview for your app. Tap the Firestore Database item in the navigation to the right. Tap 'Create Database'. Choose Production Mode. Tap next. Pick the location (the default is fine for US--if you change it, set that in your config `region` (see below)). Tap Done.

In the navigation to the right, go to Authentication. Tap 'Set up sign-in method'. Next to the Google row, tap the edit icon. **Toggle the Enable toggle**. Give the project a descriptive name and pick an email. (You can change these both later). Hit Save.  

By default (unless you set disable_anonymous_login to your config.SECRET.json) anonymous users will be enabled, and you must also configure that sign in method. In the Firebase Authentication tab, under the Sign-in method, go to Anonymous and enable it.

In the navigation to the right, go to the Storage tab. Tap 'Get Started'. Click Next. It will show you a location selection, which you can't change (since you set it in an earlier step). Tap 'Done'.

Run `gulp set-up-deploy`

Run `npm run start` to run the server.

Visit https://localhost:8081/maintenance in your browser.

On the page that loads, tap the button that says "Sign in with your Google account". **Sign in with the account you want to be the super-user admin for the web app**.

You now must configure the app so that that user is an admin.

Go to https://console.firebase.google.com. Go to the Authentication tab. You should see a single row with your username. Copy the User UID (the copy button next to it will copy it for you without whitespace).

Now go to the database tab. Tap 'Start Collection'. Name it `permissions` and hit next. Into the Document ID field, paste your uid you copied in the last step. Add a field called `admin`, set it to Boolean, and leave the value as true. From now on you won't need to edit permissions directly for other users but can modify them from `/permissions` when logged in as an admin.

Load https://localhost:8081/maintenance again in your browser. You should see a number of buttons. Tap **Initial SetUp**.

Once it completes, tab the 'Main' tab. You're now set up, and can start editing the starter card that was added in that section!

### First deploy

Up until now, the web app was only visible on your local computer.

To deploy to production, run `gulp release`. 

After the full deploy is done, the webapp will be visible to anyone at https://your-project-id.web.app/ ! The only people who will be able to edit cards, tags, and sections will be you (or anyone else you listed as an admin in the console).

Please email me at alex@komoroske.com if you actually start using the web app, so I know that I should start investing in tagging specific stable releases, make sure maintenance taksks are clear, etc.

Also check out 'Keeping up to date' to keep your instance current.

### Keeping up to date

Once you've deployed your instance, you should periodically upgrade it with the latest changes.

To do that, `cd` to the directory where you have the webapp checked out. Then run `git pull` and then `gulp release`.

You will likely have to run maintenance tasks on your instance to upgrade the data model. (The gulp command will remind you). 

To do that, go to https://your-project-domain/maintenance , hard refresh
(Cmd-Shift-R) to make sure you have the recently-deployed version, and then run
any maintenance tasks it tells you to. Note that you might need to run multiple in a row. Run them until it says 'No tasks to run'.

## Extra Credit

This section describes things that you don't have to do, but are a good idea

### Limiting access

The default app settings you copied over from config.SAMPLE.json allow anyone to
view published cards on the site. But sometimes you don't want that. It's
possible to configure your config.SECRET.json to prevent access by default.

Each permission defaults to off (false) until set explicitly to true in the
cascade.

If you want to allow access only for users who explicitly have been granted
access, remove the 'viewApp' key from 'all' block:

```
  "permissions" : {
	  "all" : {},
	  //other configs remain the same
  }
```
Then, you'll have to give each user view access. You can do that by going to
YOUR-DOMAIN.com/permissions, where you can add viewApp permissions to other
users.

Of course that's a pain. Sometimes you want to give viewApp access to anyone
with an email account from your company. To do that, add the following to your config:

```
  "user_domain" : "mycompany.com",
  "permissions" : {
	  "all" : {},
	  //Other configs remain the same
	  "signed_in_domain": {
		  "viewApp": true
	  }
  }
```

See more in the config section of README for the keys and what they mean.

### Backups

It's a good idea to back up your database often so if something goes wrong, you can roll back to a recent known good state.

The first thing to do is create a cloud storage bucket to save the backups. (This next section is a walk through of the instructions at https://firebase.google.com/docs/firestore/manage-data/export-import)

Go to https://console.cloud.google.com . Verify the project for your firebase project is showing. Open the navigation menu and go to Billing. Then Link a billing account.

Now in the navigation menu, select Cloud Storage. Click Create Bucket and create a bucket with default settings. Remember the name of the bucket you created.

In your `config.SECRET.json`, add `"backup_bucket_name" : "BUCKET_NAME_HERE"`.

Ensure you have the `gcloud` command line app installed: https://cloud.google.com/sdk/install

Run `gulp backup` to run a backup. You can choose to give it a descriptive name at the prompt to make it easier to remember why you ran the backup, or just hit enter.

Once this is all set up, every time you run `gulp release` it will automatically save a backup.


#### Restoring a back up

Every so often it makes sense to reset the dev database with the most recent prod backup.

Do that with `gulp reset-dev`.

You might see an error message about permissions. If you do, take note of the service-account in the error message that needs permission. It will look like `service-DESTINATION-FIREBASE-PROJECT-NUMBEr@gcp-sa-firestore.iam.gserviceaccount.com` where DESTINATION-FIREBASE-PROJECT-NUMBER is the number of the project that is trying to import and can be found at https://console.firebase.google.com on the Project Settings > Project number.

Go to `https://console.cloud.google.com/storage/browser/[BACKUP_BUCKET_NAME];tab=permissions` and hit the 'Add' button, then in the dialog, paste in that service account number as the Principal and give it the role of `Firestore Service Agent`.

See also https://cloud.google.com/datastore/docs/export-import-entities#service_agent_migration for more on this permissions issue.

If you don't have a dev/prod account, just a prod one, it will ask for confirmation before resetting the database.

### Dev and Prod

By default, your `config.SECRET.json` will only configure a single firebase project. But if you're going to be doing serious work in your instance, or especially if you'll be hacking on the web app code, it's a good idea to have seperate dev and prod instances.

To do that, create a separate firebase project in firebase and then modify your `config.SECRET.json` so that instead of the "firebase" key having the one project's config, it instead has two keys: "dev" and "prod", each with their corresponding keys.

When you do this, you'll want to do *most* of the set-up steps described for a
new project, but not run the set-up maintence task.

Note that the uid's for users will be different for the same Google accounts in dev and prod. The best pattern is to add an additional `{admin:true}` in the prod `permissions` table for the primary account's uid in the dev project, too. That way when you restore a backup from prod, you have admin rights configured for both parties.

When you do this, you can run `gulp reset-dev` to copy over the last backup from prod into dev.

### Emailing on messages or stars

You can set up your instance so you get an email when someone stars a card or comments on it.

To do that, go to Postmark and get it set up, which takes awhile and lots of
confirmation emails.  Part of the set up is configuring the email that the
emails will appear to come from.

Then run the following:

```
gulp firebase-ensure-prod
firebase functions:config:set postmark.key="YOUR-SECRET-KEY-HERE"
firebase functions:config:set email.to="emailaccountyouwantalertssentto@gmail.com"
firebase functions:config:set email.from="emailaccountitshouldcomefrom@gmail.com"
```

### Twitter bot

If you also want to set up auto-tweeting, you'll need to set additional values,
with the values for your app (generated from the specific bot account you want
to tweet from) from here: https://developer.twitter.com/en/apps
```
gulp firebase-ensure-prod
firebase functions:config:set twitter.consumer_key="YOUR-SECRET-KEY"
firebase functions:config:set twitter.consumer_secret="YOUR-SECRET-KEY"
firebase functions:config:set twitter.access_token_key="YOUR-SECRET-KEY"
firebase functions:config:set twitter.access_token_secret="YOUR-SECRET-KEY"
```

You also need to add the `twitter_handle` property in your `config.SECRET.json`
to the name of the handle (without the @ sign).

If your firebase project name starts with `dev-` or ends with `-dev` then it
will update the db and pretend like it tweeted, but not actually post anything
to twitter.

If you want to configure a twitter handle but disable it from tweeting or
fetching tweet engagement (e.g. you don't want to pay the egregious monthly fee
to use the Twitter API), add a `disable_twitter` key and set it to true. If you
had already deployed, then you will need to delete the `autoTweet` and
`fetchTweetEngagement` cloud functions.

To send a tweet outside of the normal schedule, load up the Firebase functions console, tap the three dots next to the autoTweet function, choose View in Cloud Scheduler, and hit 'Run Now'.

## Config file keys

**Re-run `npm run generate:config` every time you change the config file!**

### firebase

The firebase key is where you put the firebase config.

If you only have a prod configuration, you can just put the config right here.

If you have a prod and dev sub configuration, then you can have two sub keys,
firebase.dev and firebase.prod, each of which have their own config.

### firebase.dev

This is where your firebase project config should go for the dev version of the project. This is the 'staging' server with throw-away data.

### firebase.prod

This is where your firebase project config should go for the prod version of the project, with real data and visible to the world.

### app_title

The name of your app, to show up in the titlebar of the web page, the web app
header, and in the manifest. If the string starts with 'The ' then the The will
be rendered a lighter color in the header.

### app_description

The description of your application, for use in the meta tag.

### google_analytics

The ID to use for Google Analytics reporting.

### disable_persistence

By default, the web app will enable persistence for Firestore, meaning that it
will keep a local cache of the database contents for each client. This can
sometimes interact oddly with certain configurations. If this is set to true,
then persistence will not be enabled. That might cause slightly slower
second-load performance. Defaults to false.

### disable_anonymous_login

By default, when a user visits the webapp, they are "signed in" to an anonymous
account. This allows them to register reads, stars, and reading lists even
before they sign in. Later, they can properly sign in to their real account and
merge the state they accumulated in the anonymous account with their real one.

However, if you want them to either be fully logged out (no ability to star or
mark read) or fully logged in, you can set this value to true.

Note that if this is false (the default) then you need to enable Anonymous Sign
in as a method in Firebase's Authentication console.

### disable_service_worker

If you don't want to use a service worker, set this to true. By default it will
use a service worker.

### disable_callable_cloud_functions

The webapp uses two minor callable cloud functions. One checks to see if a
proposed slug for a card is legal, even checking cards the current user doesn't
have permission to see. The other checks that maintenance mode is not enabled.
These are both two very uncommon cases.

Some environments do not allow httpsCallable functions by default, so this
setting, if true, means to not even try. This could have wrong behavior in those
edge cases, but it allows it to run in those restricted environments.

### user_domain

If this is set, then it allows you to apply special permissions for users whose
email is from the given domain. Used in conjunction with
permissions.signed_in_domain.

This value should be the part after the `@` sign in an email. For example, for
'bob@mycompany.com', the value for this would by 'mycompany.com'.

### permissions

Permissions of the web app are set based on the contents of the permissions
block in config.SECRET.json. You likely have reasonable defaults set based on
what you copied from config.SAMPLE.json.

Each permission defaults to false until it is set to true in the cascade, after
which it is true from that point onward in the cascade.

The different permissions objects are maps that are sub-keys of this: 'all',
'anonymous', 'signed_in', 'signed_in_domain'.

This progression from 'all' to 'signed_in_domain' all build on one another. Each
successive level may ADD permissions, but not remove them. This means that the
configuration you provide at any level must only have 'true' keys.

After those four blocks, each user also might have specific extra permissions
set on their user object. You can visit https://YOUR-DOMAIN.com/permissions to
manually modify permissions for individual users (for everything other than
setting someone as an admin).

You can see all of the permission keys that can be set in each block by visiting
src/permissions.js

#### permissions.all 

The override permissions for all users. This is how you override the base
permissions, since it applies to ALL users, including non-signed-in ones.

#### permissions.anonymous

The override permissions for users who are signed in AT LEAST anonymously (it
also applies if they're signed in with a real login). By default every user who
visits the web app is signed in anonyously (unless disable_anonymous_signin is
true), so in practice this often applies for everyone.

#### permissions.signed_in

The override permissions for users who are signed in AND the sign in has a
username and email attached. Note that this means these permissions layer on top
of the overrides provided for permissions.anonymous.

#### permissions.signed_in_domain

The override permissions for users who are signed in AND the sign in has a
username and email attached AND that email's domain matches the
config.user_domain. Note that this means these permissions layer on top of the
overrides provided for permissions.signed_in and permissions.anonymous.

You'd typically do this if you wanted to, for example, only give view access to
people signing in with an email account tied to 'mycompany.com'.

### twitter_handle (optional)

If you have a twitter bot configured, the handle of the bot (not including @). Emits metadata in index.html, but also used as a signal for whether the cloud functions related to twitter bots need to be deployed (they require billing to be enabled).

### backup_bucket_name (optional)

The name of the bucket within google cloud storage to store and retrieve buckets from.

You need to create this bucket within your project. (If you have both dev and
prod projects it should be within the prod project).

Required if you want to backup or restore a backup

### tag_releases

A boolean. If true, `gulp release` will tag releases. Should only be set to true if you have repo edit privileges to the repo you cloned from.

### region

The default region for firebase is `us-central1`. However, if you use a different region, provide it here.

### tabs
If provided, should be an array of tab config objects. See src/tabs.js for more on the valid fields and what they mean.

You can also use tab_overrides, which might be easier and more future-proof if
you want to keep most of the defaults, just adding one or two tabs.

By default, the first item in the tab collection will be selected if users visit
and no other thing is provided. You can set 'default' to true one of the items.
If you want a section other than the first section to be the default, set
`default:true` on the section via the firestore editor.

For example, if you had an instance that was primarily a glossary, you might set it to:
```
[
	{
		"expand": "working-notes"
	},
	{
		"expand": "concepts",
		"default": true
	}
]
```

That would set it so only two tabs show up, and the second one will be loaded up
when the app loads up and no other collection is provided. (If you omitted the
'default', then the first tab would be selected)

Note that if you have an object in the array that is only an expand name, you
can replace it with just the strong of the expand. So
```
[
	{
		expand: "working-notes"
	}
]
```
and
```
[
	"working-notes"
]
```
are equivalent.

### tab_overrides

If provided, should be an object with a shape like:

```
{
	"before": {
		"default_end_tabs": {
			collection: "everything/working-notes",
			icon: "SAVE_ICON"
		}
	}
}
```

The above config would inject a TabConfigItem with the given shape immediately before "default_end_tabs".

You can also have a "after" object with similar shapes.

## Favicons

When logo.svg has changed, run `gulp generate-favicon`. Then merge the values in images/site.webmanifest into /manifest.json

TODO: make the manifest.json output be merged automatically in that flow

When index.html has changed, run `gulp inject-favicon-markups`, then manually change the point to the manifest ot be to `manifest.json` instead of `/images/site.webmanifest`

TODO: make the favicon injection be part of the build flow

## Design

The card-web-app reads from the URL and then calls navigate() based on it. Navigate figures out which view needs to be ensured it is loaded, and then sets state.app.page to that viewer, state.app.location to the entire location, and state.app.pageExtra to the stuff after the first part of page, so e.g. '/c/this-stuff-is/included-in-page-extra'.

That then causes card-view to be activated, with a different page-extra, which it then tells the store to show a specific card. It also checks to ensure that the URL showing is the actual card name; if not it silently updates it.

When you want to navigate to a card, you use actions/navigateToCard, which uses history.pushState, and then calls the router to extract out the URL and operate.

## SEO

card-web creates a single page app. That means that the descriptions and metadata that show up on social platforms will be constant and not related to the specific card.

The solution to this is to generate at deploy time many copies of index.html, one for each published card. These contain Open Graph markup so that even before the single page app loads the title and description of the linked card can be fetched by social services.

You can opt into this behavior by adding "seo": true in your `config.SECRET.json` file, and answering yes to the deploy prompts that ask if you want to generate SEO pages (or running it manually with `npm run generate:seo:pages`). Every time you change your cards and want the previews updated you should rerun.

## OpenAI fine-tuning

It's possible to export your cards in a way suitable for fine-tuning an OpenAI model. The results aren't great. The results sound superficially like you but are mostly vapid, and regress to the mean of corporate speak in a way that almost feels like it cheapens your actual cards.

Conceptually waht it does is take all of the content and working-notes cards in your collection. It generates a prompt that is the most disctintive words in each card (the fingerprint, the TF-IDF), and then a 'completion' of the body of the card. Then, to generate a new card you can hand it just a few distinctive words and it will generate content.

The general instructions for fine-tuning are here: https://beta.openai.com/docs/guides/fine-tuning

To generate a fine-tuning file, go to `https://DOMAIN/maintenance` and then tap the `export-fine-tuning-examples` button. This will download a JSONL file with prompts and completions based on all of your working notes and content cards.

Run `pip3 install --upgrade openai` to install openai.

Run `export OPENAI_API_KEY="<OPENAI_API_KEY>"` (or add to your `.bash_profile`).

Run `openai tools fine_tunes.prepare_data -q -f <LOCAL_FILE>` to prepare the file for use (e.g. removing fields like the the card id). This will produce a file named like the training file but with `_prepared` just before the extensiuon.

Run `openai api fine_tunes.create -m davinci -t <PATH_TO_PREPARED_FILE>` (You can replace `davinci` with a different, cheaper model like `curie` if you'd like)

Then once you have the model to get a completed bit of content, run `openai api completions.create -m <MODEL_NAME> --stop "#END#" --max-tokens 512 -p "word1 word2 word3\n\n#START#\n\n"` (replacing the name of the model and the words you want to use ot seed it)

You can also do an export appropriate for importing into https://github.com/dglazkov/polymath via the `export-polymath-data` action.

## OpenAI AI Features

In `config.SECRET.json` add a key called `openai_api_key`. This will allow users with the proper permissions to do OpenAI API calls with your budget.

The features show up in two places currently:
 - **Summarize a collection of cards** - In the zippy in the cards collection, a button will show up to Summarize Cards with AI. This will attempt to summarize as many cards as fit in the context window into text that could be used for a new card.
 - **Suggest a card title** - When editing a card, flip to the content tab and hit the AI button next to the title field to suggest a title for the card based on the card's body.

 ## Embedding Similarity

 It's possible to enable a deeper similarity score for cards by using embeddings.

 To do so you will need to provide an OpenAI_API_Key and also configure Qdrant, which is used as the vector database.

 Go to https://cloud.qdrant.io and create a cluster. You can create small clusters (which should be more than sufficient) for free. Choose Google Cloud Platform option. You'll also need to generate an API key that gives access to that cluster.

 Add to the `config.SECRET.json` the following configuration:

```
{
  //...other configuration

  //openai_api_key must also be set
  "openai_api_key": "${YOUR_OPENAI_API_KEY}"
  "qdrant": {
	"cluster_url": "https://${YOUR_CLUSTER_ID}.us-east4-0.gcp.cloud.qdrant.io",
	"api_key": "${YOUR_QDRANT_API_KEY}"
  }
}
```

You can run `gulp configure-qdrant` to run the configuration and set up the endpoint. It will also be run for you automatically on the next deploy.

You also need to set these keys on the cloud function:

```
gulp firebase-ensure-dev
firebase functions:config:set qdrant.cluster_url="YOUR-URL-HERE"
firebase functions:config:set qdrant.api_key="YOUR-SECRET-KEY-HERE"
```

```
gulp firebase-ensure-prod
firebase functions:config:set qdrant.cluster_url="YOUR-URL-HERE"
firebase functions:config:set qdrant.api_key="YOUR-SECRET-KEY-HERE"
```
