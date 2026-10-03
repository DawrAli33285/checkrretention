# Start here (developer handoff)

This zip is the complete rebuilt PrognostiCare Staff Retention app: React front end + Express API, deployed as one Vercel project.

## Do these first
1. Rotate every key from the old `backendtwo` code: MongoDB user, Cloudinary, Gmail app password, RapidAPI, both People Data Labs keys, Social Searcher, Stripe, Airtable, JWT secret.
2. Create a NEW MongoDB Atlas database (Vercel > Storage > MongoDB Atlas works). Do not reuse the old database.

## Test login
- Email: `shipmate2134@gmail.com`  Password: `12345678`
- Locally this is already set in the included `.env` file and is created on the first run.
- On Vercel, add `ADMIN_EMAIL=shipmate2134@gmail.com` and `ADMIN_PASSWORD=12345678` to the environment variables before the first deploy.
- If an administrator already exists on that database, set it with: `npm run seed:admin -- shipmate2134@gmail.com 12345678`
- This password is for testing only. Change it under Account (top right) before any client uses the app.

## Try it locally first (no setup)
`npm install` then `npm run dev`, open http://localhost:5173, sign in with the test login above, add a client under Admin > Clients & users, sign in as the client and upload `samples/current_staff_sample.csv`.

## Deploy
3. Push this folder to a new private GitHub repo and import it into Vercel. Vercel detects Vite; no build settings to change.
4. In Vercel > Settings > Environment Variables set `MONGODB_URI` (required), plus `SETUP_TOKEN` and `APP_URL` (recommended). In MongoDB Atlas > Network Access allow 0.0.0.0/0.
5. Deploy, then open `/api/health`. It should show `"ok": true` and `"db": "connected"`.
6. Open the app. The first screen creates the administrator account (it asks for the SETUP_TOKEN if you set one).

## Test
7. As admin, add a test client with credits and set the client's job site address (Admin > Clients & users > Edit).
8. Sign in as the client and run `samples/current_staff_sample.csv`, then `samples/prehire_sample.csv`.
9. Upload the staff file again and confirm the monthly-limit message.
10. Download the Excel report from a finished run.

Without `PDL_API_KEY` and `RAPIDAPI_KEY` the app runs in clearly labeled demo mode (simulated social signals). Do not add live keys or real client data until Roosevelt confirms.

## Read next
- `README.md`: full setup, local development, how scoring works, compliance notes
- `CHANGES.md`: everything fixed or removed compared with the old code
- Tests: `npm test` (add `TEST_MONGODB_URI=mongodb://...` to include the full API test).
