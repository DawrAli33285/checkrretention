# Start here

PrognostiCare Staff Retention, version 2.3. React front end + Express API, deployed as one Vercel project
(live at https://checkrretention.vercel.app).

## Fix the sign-in on the live site (do this first)

Version 2.3 fixes the sign-in problem. The cause: the app only created the `ADMIN_EMAIL` account when the
database had **no** administrator at all. The live database already has one, so `ADMIN_EMAIL` /
`ADMIN_PASSWORD` were ignored and that login was refused. The app also refused any password shorter than
10 characters. Now the `ADMIN_EMAIL` account is created or repaired on every server start, and passwords
need 8 characters.

1. **Replace the code.** Copy this folder over the repository connected to the `checkrretention` Vercel
   project (keep that repository's `.git` folder) and push. Vercel builds it automatically.
2. **Set the administrator login.** In Vercel > `checkrretention` > Settings > Environment Variables, for
   **Production** (and Preview if you use it), set:
   - `ADMIN_EMAIL` = `shipmate2134@gmail.com`
   - `ADMIN_PASSWORD` = `12345678`
   - Keep the existing `MONGODB_URI` as it is.
3. **Redeploy.** Vercel > Deployments > the latest deployment > Redeploy. A change to environment
   variables only takes effect after a redeploy.
4. **Check it.** Open https://checkrretention.vercel.app/api/health. It must show `"db": "connected"` and
   `"adminLogin": "set from ADMIN_EMAIL / ADMIN_PASSWORD"`.
5. **Sign in** at https://checkrretention.vercel.app/login with that email and password. You land on Admin.

If sign-in is still refused, open Vercel > `checkrretention` > Logs and look for a line starting with
`Sign-in refused for`. It states the reason (no account with this email, wrong password, locked after
repeated failures). A lockout clears after 15 minutes, on the next deploy, or when an admin sets a new
password for that account.

## Give a client access

1. Admin > Clients & users > **Add user**: the client's email, a temporary password (8+ characters),
   their organization and starting credits. Role: Client.
2. Click **Edit** on that client and fill in the **Job site** address (commute distance is measured to it).
3. Send the client the sign-in link (https://checkrretention.vercel.app/login), their email and the
   temporary password. They can change it under Account (top right).
4. Forgot password: Admin > Clients & users > Edit > "Set a new password". This also lifts any lockout.

Clients only see their own uploads and results. Admin pages are blocked for them.

## About the administrator password

`ADMIN_PASSWORD` in Vercel is the source of truth for the `ADMIN_EMAIL` account: to change that password,
change the variable and redeploy (the Account page explains this too). `12345678` is a test password.
Change it in Vercel before clients use the app.

## Run it on your own computer (optional)

`npm install` then `npm run dev`, open http://localhost:5173 and sign in with the login in `.env`.
With `MONGODB_URI` blank, a private local database is started for you.

## Read next
- `CHANGES.md`: what changed in each version
- `README.md`: full setup, how scoring works, compliance notes
- Tests: `npm test` (add `TEST_MONGODB_URI=mongodb://...` to include the full API and sign-in tests)
