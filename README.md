# BK Tennis Club

Website for [@bktennisclub](https://www.instagram.com/bktennisclub/), a free, beginner-friendly tennis club: *where tennis transcends into community.*

Live at **https://bktennisclub.com**.

- **Public site**: static pages in `public/`, styled with the "Clubhouse Checkers" design.
- **Text sign-ups**: people join SMS groups from the homepage form.
- **Admin** (`/admin`): sign in with an emailed link to send texts to groups (from your own phone, or through Twilio once it's set up), and manage contacts and groups.

## Structure

```
public/            site pages, styles and scripts (served as-is)
  admin/           the admin dashboard (HTML/CSS/JS)
  events.js        event list: edit this to add/remove events
  privacy.html     privacy policy   (required for carrier SMS approval)
  terms.html       SMS terms        (required for carrier SMS approval)
server/
  index.js         entry point: picks the store and SMS sender, seeds starter groups
  app.js           Express app: static files, /api, /api/admin, /webhooks/twilio
  routes/          public sign-up API, admin API, Twilio webhooks
  store/           Firestore (production) and in-memory (local/tests) data stores
  sms.js           Twilio sender (disabled in manual mode)
  blast.js         Twilio blasts, and manual send lists
  lib/             phone parsing, SMS segment counting, keywords, message copy
test/              node:test suite
```

## Local development

```sh
npm install
npm run dev        # http://localhost:8080, in-memory data, manual sending mode
npm test
```

Locally the site runs in manual mode. `npm run dev` sets `DEV_ADMIN_EMAIL`, which adds a "Continue as local dev" button
on `/admin` so you can skip Google sign-in. That shortcut is ignored on Cloud Run.

## How texting works

There are two modes. The site picks automatically: **manual** until Twilio
credentials are set, then **Twilio**.

**Manual mode (current).** For a small list, texts go out from an organizer's own phone.
1. Someone signs up on the homepage (name, US mobile, groups, consent checkbox) and
   is **subscribed** right away, with a consent record (wording, time, IP).
2. In `/admin` → Send, write the message, pick groups, and hit **Prepare texts**.
3. On your phone, tap each person's **Text** button: Messages opens with their number
   and personalized text filled in. Send, come back, tap the next. Ticks are saved,
   so History → Continue picks up where you left off.
4. If someone replies STOP to your phone, click **Stop texts** on them in Contacts.

**Twilio mode.** Same admin, but sending is automatic.
1. Sign-ups are **pending** until they reply YES to a confirmation text.
2. Blasts go straight out through Twilio to subscribed members of the chosen groups.
3. STOP/START/HELP replies are handled by Twilio's opt-out management and recorded
   here. All replies show in the Replies tab, and delivery receipts update each blast.

In both modes `{first_name}` is filled in per person, and "Reply STOP to opt out" is
appended unless unticked. Admins can stop texting someone but can't opt them back in.

## Configuration (Cloud Run environment)

| Variable | What it is |
| --- | --- |
| `PUBLIC_BASE_URL` | `https://bktennisclub.com`. Used for Twilio webhook URLs and signature checks |
| `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `FIREBASE_APP_ID` | Firebase web app config for the admin's email-link sign-in (public values) |
| `ADMIN_EMAILS` | Comma-separated emails allowed into `/admin` |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token. Stored in Secret Manager as `twilio-auth-token` |
| `TWILIO_MESSAGING_SERVICE_SID` | The Messaging Service (`MG…`) that holds the club's number |

Data lives in Firestore (Native mode, database `(default)`) in project
`tennis-club-512223`. The service runs as `bktennisclub-run@tennis-club-512223.iam.gserviceaccount.com`.

## One-time setup

### Admin sign-in (email links)
Admins type their email on `/admin` and get a one-time sign-in link (Firebase
Authentication, which also sends the email). Anyone can request a link, but only
emails in `ADMIN_EMAILS` get past the server.

Firebase console (project `tennis-club-512223`) → **Authentication**:
1. **Sign-in method → Email/Password**: enable it, and enable **Email link (passwordless sign-in)**.
2. **Settings → Authorized domains**: `bktennisclub.com` and `www.bktennisclub.com`.

To add an admin, add their email to `ADMIN_EMAILS` (see Deploy).

### Twilio
1. Create a Twilio account and buy a US local number.
2. Create a **Messaging Service** and add the number to it. Under the service's
   Integration settings, set **Incoming messages → Send a webhook** to
   `https://bktennisclub.com/webhooks/twilio/inbound`.
3. Register for **A2P 10DLC** (Brand + Campaign). Use the homepage form as the
   opt-in, and link `https://bktennisclub.com/terms` and `/privacy`. Carriers
   approve in roughly 1–3 weeks; US texts are blocked until then.
4. Optional: in the Messaging Service's Advanced Opt-Out, set the HELP reply to the
   text in `server/lib/sms-text.js` (`messages.help`).
5. Add the credentials (see Deploy) and redeploy. The admin switches to Twilio mode.

## Deploy

```sh
gcloud run deploy bktennisclub --source . \
  --project tennis-club-512223 --region us-east1
```

Environment variables and secrets are kept on the service between deploys. To change them:

```sh
gcloud run services update bktennisclub --project tennis-club-512223 --region us-east1 \
  --update-env-vars '^##^ADMIN_EMAILS=a@x.com,b@y.com'

# Twilio
printf %s "$TWILIO_AUTH_TOKEN" | gcloud secrets versions add twilio-auth-token --data-file=- --project tennis-club-512223
gcloud run services update bktennisclub --project tennis-club-512223 --region us-east1 \
  --update-env-vars TWILIO_ACCOUNT_SID=AC...,TWILIO_MESSAGING_SERVICE_SID=MG... \
  --update-secrets TWILIO_AUTH_TOKEN=twilio-auth-token:latest
```

Domain: registered through Cloud Domains in the same project, DNS in the Cloud DNS
zone `bktennisclub-com`. Both `bktennisclub.com` and `www.bktennisclub.com` are
Cloud Run domain mappings.

## Adding an event

Add an object to `public/events.js`. Events dated before today automatically move to "Past events".

## TODO

- Real photos for the gallery
- Confirm the regular Friday-night session time and courts
