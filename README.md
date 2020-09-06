# Card Web
This project is the webapp that powers https://thecompendium.cards

The project is messy, with lots of intricate details and designs captured as a messy collection of issues. This is to [minimize my activation energy](https://thecompendium.cards/c/incremental-work-minimizes-activation-cost) for this hobby project, but it might be overwhelming for others. Nevertheless, please feel free to comment and participate!

The app is possible to run an instance of with some configuration, but there's still some pieces missing that aren't generalized. If you have any interest in standing up an instance on your own that is blocked, issue #164 tracks the work to make it fully general. Please chime in there and I'll prioritize that work!

The web app has a number of advanced features that aren't immediately obvious in the UI, or visible to non-editors. You can learn more about them [here](https://github.com/jkomoros/card-web/wiki/Advanced-Functionality). The features make it possible to use this less as a CMS and more as a personal knowledge garden.

## Getting set up

### First Run

Download this repository and cd into it.

Run `npm install` to install all of the dependencies.

Run `npm install -g firebase-tools gulp polymer-cli` (you can skip any of those that you already have installed)

Run `cp config.SAMPLE.json config.SECRET.json`

Go to https://console.firebase.google.com. Create a new project. On the project overview, where it says "Get started by adding Firebase to your app", tap the web icon.  Give it a nickname. Tap set up. In the code snippet that appears, copy the JSON blob that is assigned to the `firebaseConfig` variable.

Paste that JSON blob in your `config.SECRET.json` file, where the sample "firebase" value is. You might have to change the formatting to make it valid JSON. (You can read more about all of the valid settings for this in the Config file keys section later in this README).

Run `gulp inject-config`. This copies the config you just set into various static files in the project.

Go back to the Firebase console. Go to the project overview for your app. Tap the Database item in the navigation to the right. Tap 'Create Database'. Choose Production Mode. Tap next. Pick the location (the default is fine for US--if you change it, set that in your config `region` (see below)). Tap Done.

In the navigation to the right, go to Authentication. Tap 'Set up sign-in method'. Next to the Google row, tap the edit icon. **Toggle the Enable toggle**. Give the project a descriptive name and pick an email. (You can change these both later). Hit Save.

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

## Extra Credit

This section describes things that you don't have to do, but are a good idea

### Limiting access

The default app settings allow anyone to view published cards on the site. But
sometimes you don't want that. It's possible to configure your
config.SECRET.json to prevent access by default.

If you want to allow access only for users who explicitly have been granted
access, add the following inside of your config.SECRET.json:

```
  "permissions" : {
	  "all" : {
		  "viewApp": false
	  }
  }
```
Then, for each user you want to give access, manually add a permissions object (like you did to create the first admin account), and add "viewApp": true to them.

Of course that's a pain. Sometimes you want to give viewApp access to anyone
with an email account from your company. To do that, add the following to your config:

```
  "user_domain" : "mycompany.com",
  "permissions" : {
	  "all" : {
		  "viewApp": false
	  },
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

To send a tweet outside of the normal schedule, load up the Firebase functions console, tap the three dots next to the autoTweet function, choose View in Cloud Scheduler, and hit 'Run Now'.

## Config file keys

**Re-run `gulp inject-config` every time you change the config file!**

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

### user_domain

If this is set, then it allows you to apply special permissions for users whose
email is from the given domain. Used in conjunction with
permissions.signed_in_domain.

This value should be the part after the `@` sign in an email. For example, for
'bob@mycompany.com', the value for this would by 'mycompany.com'.

### permissions

If you want to override the default BASE_PERMISSIONS of the webapp, for example
to make it so users must be explicitly whitelisted to view the app at all, then
put an object there with all of the true/false keys you want to override. See
src/permissions.js.BASE_PERMISSIONS for an enumeration of all of the keys and
what they mean.

The different permissions objects are maps that are sub-keys of this: 'all',
'anonymous', 'signed_in', 'signed_in_domain'.

This progression from 'all' to 'signed_in_domain' all build on one another. Each
successive level may ADD permissions, but not remove them. This means that the
configuration you provide at any level must all have 'true'.

#### permissions.all 

The override permissions for all users. This is how you override the base
permissions, since it applies to ALL users, including non-signed-in ones.

#### permissions.anonymous

The override permissions for users who are signed in AT LEAST anonymously (it
also applies if they're signed in with a real login). By default every user who
visits the web app is signed in anonyously, so in practice this applies for
everyone.

The web app defines its own permissions that apply at this tier in
src/permissions.js.BASE_USER_TYPE_ANONYMOUS_PERMISSIONS. Keys you provide here
will supercede those.

#### permissions.signed_in

The override permissions for users who are signed in AND the sign in has a
username and email attached. Note that this means these permissions layer on top
of the overrides provided for permissions.anonymous.

The web app defines its own permissions that apply at this tier in
src/permissions.js.BASE_USER_TYPE_SIGNED_IN_PERMISSIONS. Keys you provide here
will supercede those.

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

## Favicons

When logo.svg has changed, run `gulp generate-favicon`. Then merge the values in images/site.webmanifest into /manifest.json

TODO: make the manifest.json output be merged automatically in that flow

When index.html has changed, run `gulp inject-favicon-markups`, then manually change the point to the manifest ot be to `manifest.json` instead of `/images/site.webmanifest`

TODO: make the favicon injection be part of the build flow

## Design

The card-web-app reads from the URL and then calls navigate() based on it. Navigate figures out which view needs to be ensured it is loaded, and then sets state.app.page to that viewer, state.app.location to the entire location, and state.app.pageExtra to the stuff after the first part of page, so e.g. '/c/this-stuff-is/included-in-page-extra'.

That then causes card-view to be activated, with a different page-extra, which it then tells the store to show a specific card. It also checks to ensure that the URL showing is the actual card name; if not it silently updates it.

When you want to navigate to a card, you use actions/navigateToCard, which uses history.pushState, and then calls the router to extract out the URL and operate.
