# AARAMBH 2026 - Component Inventory

A public component inventory for **AARAMBH WCE-HACKATHON 2026**, presented by the Department of Electrical Engineering, Walchand College of Engineering.

## Design theme

The UI is styled from the supplied event pamphlet:

- deep black-purple background with a technical grid
- violet and magenta circuit traces
- bright yellow action buttons and event highlights
- large white poster-style event lettering
- AARAMBH and WCE-HACKATHON 2026 event language throughout

The inventory data comes from the supplied quotation. Repeated invoice lines were combined into a single component record, so the website lists **121 component types** and **1,812 total units**. Freight is excluded.

## What visitors and the owner can do

- Everyone can view the component name and available quantity.
- Everyone can search, filter limited quantities, sort the inventory, and switch the colour accent.
- Only the owner can sign in and change a quantity.
- Quantity updates go through a server-side protected endpoint and save to `inventory.json`.

---

## 1. Run and check the website on your computer

### Prerequisite

Install Node.js 18 or later. Check it in PowerShell:

```powershell
node --version
```

### Start the website

1. Open **PowerShell**.
2. Go to the website folder:

   ```powershell
   cd "C:\Users\ASUS\Documents\Codex\2026-10-04\create-an-code-for-wqebsite-this\outputs\hackathon-inventory"
   ```

3. Set your private owner password for this PowerShell session. Replace the example with a strong password that only you know:

   ```powershell
   $env:ADMIN_PASSWORD = "replace-this-with-a-long-private-password"
   ```

4. Start the Node server:

   ```powershell
   node server.js
   ```

5. Leave this PowerShell window open. It should display:

   ```text
   Hackathon Inventory is running at http://localhost:3000
   ```

6. In Chrome, Edge, or another browser, open:

   ```text
   http://localhost:3000
   ```

To stop the local website, return to the PowerShell window and press `Ctrl + C`.

### Public-view checklist

Check these items in the browser:

1. Confirm the opening screen shows **AARAMBH** and **WCE-HACKATHON 2026** in the purple/yellow poster style.
2. Scroll to the inventory and confirm it says **121 components in view**.
3. Search for `ESP32`. Six matching component cards should appear.
4. Select **Limited** to show components with two units or fewer.
5. Select **Most units** from the sort menu. Large-quantity resistor/capacitor items should move towards the top.
6. Click the sparkle button in the top-right corner to switch the accent palette.
7. Confirm that normal component cards do not show edit controls in public read mode.

### Owner-view checklist

1. Select **Owner access** in the top-right corner.
2. Enter the exact password set in `ADMIN_PASSWORD`.
3. Confirm that the **+**, **-**, and number controls appear for each component.
4. Change one quantity, wait for the “quantity saved” message, and refresh the browser page.
5. Confirm the new quantity is still there.
6. Select **Sign out** and confirm the quantity controls disappear again.

### Check that public visitors cannot update data

With the owner mode signed out, this optional PowerShell command should return `401` (unauthorised):

```powershell
try {
  Invoke-WebRequest -Method Patch -Uri "http://localhost:3000/api/inventory/cmp-001" -ContentType "application/json" -Body '{"quantity":1}'
} catch {
  $_.Exception.Response.StatusCode.value__
}
```

### Where local changes are saved

Local edits are stored in:

```text
data\inventory.json
```

For testing, restart the server after an owner edit and refresh the page. If the changed quantity remains, persistence is working correctly.

---

## 2. Deploy the website on Vercel

The frontend is served as static files, and `api/[...path].js` provides the inventory and owner-session API. Inventory edits are stored in Vercel Blob so they survive serverless invocations and deployments.

1. In the Vercel dashboard, import the GitHub repository and leave the project root at the repository root. The project does not need a build command.
2. Create a **Blob** store in the Vercel project and connect it to this project. Vercel adds `BLOB_READ_WRITE_TOKEN` to the project environment.
3. In **Project Settings → Environment Variables**, add `ADMIN_PASSWORD` with a long, unique owner password. Do not add it to the repository.
4. Deploy (or redeploy) the project. The first inventory request seeds the Blob store from `data/inventory.json`; subsequent owner quantity changes save to the Blob.
5. Open the deployment URL, verify public inventory loads, sign in with `ADMIN_PASSWORD`, change a test quantity, and refresh to confirm it persists.

The inventory Blob is publicly readable because the inventory itself is public; only the API can write it. Keep the Blob write token and `ADMIN_PASSWORD` private. For local preview, continue using `node server.js`; local quantity changes are saved to `data/inventory.json`.

## 3. Host the website online with Render

This website cannot be hosted as a simple static page because it has a Node server and saves owner quantity changes. Avoid GitHub Pages and static-only hosting for this version.

This guide uses **Render Web Services** because it can run the Node server and attach a persistent disk. Render documents that ordinary service filesystems are temporary; only files on a persistent disk survive restarts and deploys. [Render persistent disk documentation](https://render.com/docs/disks) and [Render web service documentation](https://render.com/docs/web-services).

### A. Put the project on GitHub

1. Create a new empty GitHub repository, for example `aarambh-inventory`.
2. In PowerShell, stay in this project folder and run:

   ```powershell
   git init
   git add .
   git commit -m "Create Aarambh 2026 inventory website"
   ```

3. On GitHub, copy the repository HTTPS address.
4. Replace the sample address below with your own and run:

   ```powershell
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/aarambh-inventory.git
   git push -u origin main
   ```

Do not put your real owner password into a project file or commit it to GitHub.

### B. Create the Render service

1. Create or sign in to your Render account.
2. In the Render dashboard, choose **New +** and then **Web Service**.
3. Connect your GitHub account, select the `aarambh-inventory` repository, and select the `main` branch.
4. Use these settings:

   | Render field | Value |
   | --- | --- |
   | Runtime | `Node` |
   | Build command | `npm install` |
   | Start command | `npm start` |
   | Root directory | Leave blank when this project is at the repository root |

5. Under **Advanced**, add these environment variables:

   | Name | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `ADMIN_PASSWORD` | A long, unique password that only you know |
   | `DATA_DIR` | `/var/data` |

   Do not set `PORT`; Render provides it automatically and the server already reads it.

6. Still under **Advanced**, add a persistent disk:

   | Disk setting | Value |
   | --- | --- |
   | Mount path | `/var/data` |
   | Size | 1 GB is more than enough for this small JSON inventory |

   The server uses `DATA_DIR` to create `/var/data/inventory.json` the first time it starts. Future owner updates are written there and will survive deploys/restarts.

7. Choose a suitable paid plan that supports a persistent disk, then select **Create Web Service**.
8. Wait for the deploy status to become **Live**. Render will give you an address such as `https://aarambh-inventory.onrender.com`.

### C. Verify the hosted website

1. Open the Render URL in a normal browser window. Check the public view, search, filters, and mobile layout.
2. Sign in with the exact `ADMIN_PASSWORD` set in Render; verify that quantity controls appear.
3. Change a test quantity and refresh the page. It must remain changed.
4. In the Render dashboard, use the service restart control, wait for the service to become Live again, refresh the website, and confirm the quantity is still changed. This final check proves the persistent disk is configured correctly.
5. If the quantity is reset after a restart, verify both `DATA_DIR=/var/data` and the disk mount path `/var/data` before changing any other setting.

### D. Optional custom domain

Once the Render URL works, open the service’s **Settings** page and add your college/event domain. Render supplies HTTPS/TLS for its web services; follow the DNS records shown in the dashboard.

### Railway alternative

Railway also works if you create a web service, add the same three environment variables, and attach a Volume at `/var/data`. Railway documents that deployments use temporary storage unless a volume is attached. [Railway volume documentation](https://docs.railway.com/volumes).

---

## Project files

- `index.html` - page content and Aarambh event text
- `styles.css` - pamphlet-inspired responsive visual theme
- `app.js` - search, filters, session state, and quantity controls
- `data/inventory.json` - initial component name and quantity data
- `server.js` - local Node server, owner authentication, and protected updates
- `api/[...path].js` - Vercel API, owner authentication, and Blob persistence

For production, always keep `NODE_ENV=production`, use HTTPS, and keep `ADMIN_PASSWORD` private.
