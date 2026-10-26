# BK Tennis Club

Website for [@bktennisclub](https://www.instagram.com/bktennisclub/), a free, beginner-friendly tennis club: *where tennis transcends into community.*

Static HTML/CSS/JS (no build step) served by a small Node/Express server that also handles
member sign-ups and SMS. The styling is a placeholder until the full design pass.

## Structure

```
public/
  index.html   page content, including the sign-up form (#enroll)
  styles.css   styles (colors/tokens at the top)
  events.js    event list: edit this to add/remove events
  main.js      nav toggle, renders events, submits the sign-up form
  admin.html   admin page at /admin: members, send texts, replies
  admin.js
server/
  index.js     Express server: static files + /api routes
  phone.js     US/Canada phone number normalizing
Dockerfile     Node image for Cloud Run (listens on $PORT)
```

## How sign-ups and SMS work

```
Sign-up form ──POST /api/enroll──────────▶ Cloud Run ──▶ Firestore members/{+1phone}
                                              │
Admin page ──POST /api/admin/broadcast────────┤──▶ Twilio Messaging Service ──▶ members' phones
                                              │
Member replies ──Twilio webhook──▶ POST /api/sms/inbound
                                     STOP/START → updates smsOptIn
                                     anything else → Firestore inbound/ (shown on /admin)
```

- **Firestore** `members` collection, keyed by phone number in E.164 form (`+17185550123`).
  Each opt-in stores the exact consent wording, its version, time, IP and user agent as proof of consent.
- **Twilio** sends the texts. Its Advanced Opt-Out handles the STOP/START/HELP auto-replies, and
  the webhook mirrors opt-outs into Firestore so broadcasts skip those numbers.
- **/admin** is protected by `ADMIN_TOKEN`. It shows sign-ups, sends a test text to one number,
  then to every subscriber, lists replies, and exports members to CSV.
- Without Twilio settings the server logs texts instead of sending them (handy for local testing).

## Local preview

```sh
npm install
npm start          # http://localhost:8080
npm test
```

Sign-ups need Firestore. Locally, run the emulator and point the server at it:

```sh
npx firebase-tools emulators:start --only firestore --project demo-bktc
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GOOGLE_CLOUD_PROJECT=demo-bktc \
  ADMIN_TOKEN=dev PORT=8090 npm start
```

## Environment variables

| Name | Purpose |
| --- | --- |
| `ADMIN_TOKEN` | Password for `/admin`. Use a long random string. |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token (also used to verify webhook signatures) |
| `TWILIO_MESSAGING_SERVICE_SID` | Messaging Service (`MG...`) that holds the club's number |
| `PUBLIC_URL` | Public site URL, e.g. `https://bktennisclub.com` (for webhook signature checks) |

## One-time setup

### 1. Google Cloud

```sh
gcloud config set project YOUR_PROJECT_ID
PROJECT=$(gcloud config get project)
gcloud services enable run.googleapis.com firestore.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com
gcloud firestore databases create --location=nam5

# Secrets (paste each value, then press Ctrl-D)
gcloud secrets create ADMIN_TOKEN --data-file=-
gcloud secrets create TWILIO_AUTH_TOKEN --data-file=-

# Let the Cloud Run service account use Firestore and read the secrets
SA=$(gcloud projects describe $PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/datastore.user
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
```

### 2. Twilio

1. Create a Twilio account and buy a local or toll-free number.
2. Create a **Messaging Service** and add the number to it.
3. **Register before texting members.** US carriers block unregistered business texts:
   - Local (10DLC) number: register an A2P 10DLC brand and campaign (a low-volume brand fits a
     small club). Use the sign-up form URL as the opt-in proof and `CONSENT_TEXT` in
     `server/index.js` as the opt-in wording.
   - Toll-free number: submit toll-free verification instead.

   Approval usually takes days to a couple of weeks.
4. In the Messaging Service, set incoming messages to send a webhook (HTTP POST) to
   `https://YOUR_DOMAIN/api/sms/inbound`.

### 3. Deploy to Cloud Run

```sh
gcloud run deploy bktennisclub \
  --source . \
  --region us-east1 \
  --allow-unauthenticated \
  --set-env-vars PUBLIC_URL=https://YOUR_DOMAIN,TWILIO_ACCOUNT_SID=AC...,TWILIO_MESSAGING_SERVICE_SID=MG... \
  --set-secrets ADMIN_TOKEN=ADMIN_TOKEN:latest,TWILIO_AUTH_TOKEN=TWILIO_AUTH_TOKEN:latest
```

Map a custom domain with
`gcloud beta run domain-mappings create --service bktennisclub --domain YOURDOMAIN`
or put it behind a load balancer.

## Adding an event

Add an object to `public/events.js`. Events with a date before today automatically move to "Past events".

## TODO

- Real photos (from Instagram/TikTok) for the hero and about sections
- Group chat invite link (currently points to Instagram DMs)
- Confirm regular Friday-night session time and courts
- Full visual design pass
- Optional: put /admin behind Identity-Aware Proxy (Google sign-in) instead of a shared token
