# CampusRide: college bus fee check (local demo)

This folder contains the College Bus Transport app: Express/MySQL backend, schema and fake seed data, hashed demo passwords, role-protected APIs, and a responsive role-based browser interface.

## Environment found

- Node.js `v24.14.0` and npm `11.9.0` are installed. PowerShell blocks the `npm` script shim, so use `npm.cmd` in PowerShell.
- The `mysql` client was not found on PATH. This does not prove MySQL Server is absent; its Windows service/client install location still needs checking.
- The original workspace was empty. App files are being kept in `bus-app`.

## Start this first slice

In PowerShell:

```powershell
cd C:\Users\Sayaa\Desktop\CollegeBusTransport\bus-app
npm.cmd install
npm.cmd start
```

Open `http://localhost:3000`. `/api/health` checks MySQL, required tables, and fake demo records. Sign in as Admin, Bus Staff, or Student to open that role's interface.

This remains the normal HTTP development path. For phone camera testing, use the HTTPS steps below; HTTPS is opt-in and does not replace the HTTP command.

## MySQL setup (when MySQL Server is available)

1. Copy `.env.example` to `.env` and enter the local MySQL username and password in `.env`. Never commit `.env`.
2. Import the schema using MySQL Workbench, or from PowerShell:

   ```powershell
   mysql -u YOUR_MYSQL_USER -p < database/schema.sql
   ```

3. Run `npm.cmd run seed` to insert fake records and hashed passwords. Demo accounts are `admin` / `admin-demo-123`, `staff` / `staff-demo-123`, `student-paid` / `student-demo-123`, and `student-pending` / `student-demo-123`.

### Staff and expanded demo records

For an existing database, run the idempotent portal migration before seeding:

```powershell
npm.cmd run migrate:portal-data
npm.cmd run seed
```

The seed retains the original admin, bus staff, and two student accounts, then adds eight fake students (`student-680379` through `student-680386`) and five staff passenger accounts (`staff-stf001` through `staff-stf005`). Their demo passwords are `student-demo-123` and `staff-demo-123`, respectively. These staff passenger records are informational and do not grant bus staff verification permissions. Each fake student has a six-digit roll number and a simulated annual-fee balance. No payment is processed or added to the `payments` table.

Migration and seed operations make JSON backups under `database/backups/` before data changes. To clear saved verification history, run the explicit one-time command below; it backs up and deletes only `scan_records`, does not reset its auto-increment value, and leaves payments and other records alone:

```powershell
node database/clear-verification-history.js --confirm-clear
```

Do not run that command if you want to retain existing verification history.

The health endpoint returns only missing setting names, database error codes, missing table names, or missing demo record categories. It never returns the database password.

The demo password values are deliberately simple and must only be used on a local demo. Login sessions use the in-memory Express session store, which resets on server restart and is not suitable for production.

## Passenger registration and sign-in

Apply the idempotent registration migration to an existing database before starting the updated app:

```powershell
node database/backup-database.js
npm.cmd run migrate:registration
```

Choose Admin, Student, or Staff on the sign-in form. Students sign in with their six-digit roll number and staff passengers with their staff ID. Existing seeded student/staff passwords continue to work. New passenger registrations are pending until an admin approves them and assigns a bus and a stop on the requested route. Applicants can check the request status from the sign-in page. Demo bus and route records are supplied by the existing seed; registration does not add transport records.

## Browser features

- Admin: student roster, name/roll search, fee-status filter, summary cards with eligible and pending counts, and recent scans. A separate Manual test tab has barcode scanning and manual roll-number verification. Dashboard activity refreshes every five seconds.
- Bus Staff: barcode scanning, manual roll-number verification, and recent verification history. The scanner asks you to confirm the decoded text before submitting it.
- Student: the signed-in account's own fee status, amount due, bus, and stop. The server fetches the record by that account's linked student ID; students cannot query another student's ID.
- Verification attempts are saved with database timestamps. Unknown IDs remain unknown and are not shown as fee-pending. A database error asks for manual review.

The exact format printed on the college ID has not been identified or tested. ZXing checks common formats, including Code 128, Code 39, Code 93, ITF, Codabar, EAN/UPC, QR, Data Matrix, Aztec, and PDF417. Use a test card or fake barcode first; compare the decoded roll number to the printed roll, and use manual entry if they differ. Real phone-camera behavior still needs device testing.

No real student/payment information belongs in this prototype. Payment, if added, is simulated only. A static barcode cannot prove who is holding the card. This app is for trusted local classroom demos, not public internet use.

## Local HTTPS and phone camera testing

Install mkcert in PowerShell, then reopen PowerShell so the command is on PATH. The upstream project documents Chocolatey and Scoop on Windows; this machine also has WinGet, which can use the `FiloSottile.mkcert` package ID:

```powershell
winget install --exact --id FiloSottile.mkcert
mkcert -version
```

Connect the laptop and phone to the same trusted Wi-Fi or hotspot. In the project folder, run:

```powershell
npm.cmd run cert:dev
```

The script lists active IPv4 addresses and asks you to select the laptop's Wi-Fi/hotspot address. Choose the address for the network shared with the phone, not a VPN or virtual adapter. It uses mkcert to trust its local CA in Windows and create an ignored local certificate with `localhost`, loopback, and that selected IP in its subject alternative names. HTTPS binds only to the selected local IP. If the laptop gets a different address later, rerun certificate creation while connected to the network you will use.

Start the HTTPS app in another PowerShell window:

```powershell
npm.cmd run start:https
```

Open `https://<the-selected-laptop-IP>:3000` on the phone. The app's API and static assets use relative same-origin paths, so they remain on HTTPS. To keep using HTTP on the laptop, stop the HTTPS process and run `npm.cmd start`, then open `http://localhost:3000`.

Windows Firewall may prompt on first network access. Allow Node.js only on the **Private** network profile if Windows asks and that is the network you trust. Do not disable the firewall, allow Public networks, or configure router port forwarding. Some hotspots isolate connected devices; if the phone cannot reach the laptop, check that both devices are on the same non-isolated network.

### Trusting the local CA on the phone

The phone does not automatically trust mkcert's CA. In PowerShell, find its CA folder and copy only the public CA certificate to a transfer location outside this repository:

```powershell
$mkcertCaRoot = (mkcert -CAROOT).Trim()
$desktopPath = [Environment]::GetFolderPath('Desktop')
Copy-Item (Join-Path $mkcertCaRoot 'rootCA.pem') (Join-Path $desktopPath 'CampusRide-dev-rootCA.pem')
```

Transfer `CampusRide-dev-rootCA.pem` to the phone using USB. **Never copy `rootCA-key.pem` or `.local-https/server-key.pem` to the phone or anyone else.** Installing a root CA grants trust to certificates issued by that CA, so remove the phone's test CA after testing.

- **iPhone/iPad:** Open the transferred CA file and install the downloaded profile from Settings. Then go to **Settings > General > About > Certificate Trust Settings** and enable full trust for the development root. iOS does not automatically enable SSL trust for manually installed root profiles. [Apple's steps](https://support.apple.com/en-au/102390)
- **Android:** In Settings, open **Security & privacy > More security settings > Encryption & credentials > Install a certificate > CA certificate** (names vary by Android maker/version), select the transferred root certificate, and follow the device prompts. Google documents manual certificate installation and notes that some menu steps vary by Android version. [Pixel certificate steps](https://support.google.com/pixelphone/answer/2844832?hl=en)

After installing and trusting it, browse to the HTTPS IP URL and confirm the browser shows a secure connection without a certificate warning. Grant camera permission to the browser for that site, sign in as Bus Staff, start the camera, and scan the actual six-digit ID barcode. Confirm the decoded value before submitting. If the phone/browser still shows a trust warning, stop there; do not bypass it. Some device/browser policies do not accept user-installed roots. Use a phone/browser that supports the installed CA, a managed development device with the CA trusted in its system store, or an organization-managed CA and private local DNS name that the phone already trusts. Keep the app on the local network and do not port-forward it.

The HTTPS server, mkcert certificates, and generated private key are local development assets. The project ignores `.local-https/`. Camera permission, certificate trust, and the real college ID format still require testing on the actual phone and card. No camera frames are saved.

## Current limits

The exact barcode printed on the college ID and phone-camera behavior need real-device testing. Admin create/edit/fee-update operations, student announcements and change requests, and simulated payments are not part of the current browser interface.


Demo student rolls are six-digit numeric values: paid `680377` and pending `680378`. For an existing database, run `npm.cmd run migrate:rolls` before `npm.cmd run seed`. The migration creates a JSON backup in `database/backups/`, preserves internal student IDs, and updates linked scan-history roll snapshots.
