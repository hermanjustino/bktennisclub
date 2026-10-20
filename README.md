# BK Tennis Club

Website for [@bktennisclub](https://www.instagram.com/bktennisclub/), a free, beginner-friendly tennis club: *where tennis transcends into community.*

Plain static HTML/CSS/JS with no build step. The styling is a placeholder until the full design pass.

## Structure

```
public/
  index.html   page content
  styles.css   styles (colors/tokens at the top)
  events.js    event list: edit this to add/remove events
  main.js      nav toggle + renders events into Upcoming/Past
Dockerfile     nginx image for Cloud Run
nginx/         nginx config (listens on $PORT)
```

## Local preview

```sh
npx serve public
# or
python3 -m http.server -d public 8000
```

## Adding an event

Add an object to `public/events.js`. Events with a date before today automatically move to "Past events".

## Deploy to Google Cloud

### Option A: Cloud Run (recommended)

```sh
gcloud config set project YOUR_PROJECT_ID
gcloud run deploy bktennisclub \
  --source . \
  --region us-east1 \
  --allow-unauthenticated
```

Cloud Build builds the `Dockerfile` and Cloud Run serves it. Map a custom domain with
`gcloud beta run domain-mappings create --service bktennisclub --domain YOURDOMAIN`
or put it behind a load balancer.

### Option B: Cloud Storage static bucket

```sh
gcloud storage buckets create gs://YOUR_BUCKET --location=us-east1
gcloud storage cp -r public/* gs://YOUR_BUCKET
gcloud storage buckets update gs://YOUR_BUCKET --web-main-page-suffix=index.html
gcloud storage buckets add-iam-policy-binding gs://YOUR_BUCKET \
  --member=allUsers --role=roles/storage.objectViewer
```

(Option B needs an HTTPS load balancer in front for a custom domain over HTTPS.)

## TODO

- Real photos (from Instagram/TikTok) for the hero and about sections
- Group chat invite link (currently points to Instagram DMs)
- Confirm regular Friday-night session time and courts
- Full visual design pass
