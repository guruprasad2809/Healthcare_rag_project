# Deploying on Azure App Service (from GitHub, no Docker)

```
Browser ──► Azure App Service (Node.js: backend + frontend) ──► Qdrant Cloud
                         │
                         └──► Gemini API
```

- **Azure App Service** runs the app directly from this GitHub repository. It builds with
  `npm install` and starts with `node backend/src/server.js`. HTTPS is included.
- **Qdrant Cloud** stores the vectors. App Service cannot run a database next to the app.
- Models and the document list are saved under `/home/storage`, which App Service keeps
  across restarts and deployments.

## 1. Create a Qdrant Cloud cluster

1. Sign up at cloud.qdrant.io and create a **free** cluster.
2. Copy the cluster **URL** (it looks like `https://xxxx.cloud.qdrant.io`) and create an **API key**.

## 2. Create the Web App

In the Azure portal (portal.azure.com), choose **Create a resource → Web App**.

| Setting | Value |
|---|---|
| Resource group | Create new, for example `healthcare-rag-rg` |
| Name | A unique name, for example `healthcare-rag-yourname`. The site becomes `https://<name>.azurewebsites.net` |
| Publish | Code |
| Runtime stack | Node 22 LTS |
| Operating system | Linux |
| Region | Central India (or the nearest region your subscription allows) |
| Pricing plan | **Basic B2** (3.5 GB memory). Free F1 and Basic B1 do not have enough memory for the embedding model |

Leave the other tabs at their defaults and click **Review + create → Create**.

## 3. Add the settings

Open the Web App, then **Settings → Environment variables → App settings**. Add each of
these with **+ Add**, then click **Apply**:

| Name | Value |
|---|---|
| `GEMINI_API_KEY` | your Gemini key |
| `APP_PASSWORD` | a long password you choose (login name is `admin`) |
| `QDRANT_URL` | your Qdrant Cloud URL with `:6333` at the end, for example `https://xxxx.cloud.qdrant.io:6333` |
| `QDRANT_API_KEY` | your Qdrant Cloud API key |
| `STORAGE_DIR` | `/home/storage` |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` |

Optional, only if you want values different from the defaults: `GEMINI_MODEL`,
`RERANKER_MODEL`, `RETRIEVAL_CANDIDATES` and the other names listed in `.env.example`.

Then open **Settings → Configuration → General settings** and set:

- **Startup Command:** `node backend/src/server.js`
- **Always on:** On (keeps the models loaded)

Click **Save**.

## 4. Connect GitHub

Open **Deployment → Deployment Center**.

1. **Source:** GitHub. Sign in and authorize when asked.
2. Just under the source, click **Change provider** and choose **App Service Build Service**.
   This builds on Azure itself and needs no extra permissions.
3. **Organization:** your GitHub user. **Repository:** `Healthcare_rag_project`. **Branch:** `main`.
4. Click **Save**.

The first build starts by itself and takes several minutes. Watch it under the **Logs** tab
of the Deployment Center. From now on every push to `main` deploys automatically.

If connecting GitHub is not allowed on your subscription, choose **Source: External Git**
instead, with repository `https://github.com/guruprasad2809/Healthcare_rag_project.git`
and branch `main`. That works for public repositories; press **Sync** to deploy again
after a change.

## 5. Open the app

Go to `https://<name>.azurewebsites.net` and log in with `admin` and your password.

The first start downloads the models, so the status line shows "models are loading" for a
few minutes before it turns to "Ready". Then upload your documents in the page.

## Checking and fixing

| What | Where |
|---|---|
| Build output | Deployment Center → Logs |
| The app's own log | Monitoring → Log stream |
| Quick status | `https://<name>.azurewebsites.net/api/health` (no login needed) |

| Problem | Likely cause and fix |
|---|---|
| "Application Error" page, log shows the app being killed or restarting | Not enough memory. Use plan B2 or larger (App Service plan → Scale up) |
| Status stays on "Qdrant is offline" | Wrong `QDRANT_URL` or `QDRANT_API_KEY`. The URL needs `https://` and `:6333` |
| "Gemini API key missing" | `GEMINI_API_KEY` is not set, or the app was not restarted after adding it |
| Build fails in the Deployment Center | Open the failed log entry; check that `SCM_DO_BUILD_DURING_DEPLOYMENT` is `true` |
| Upload of a large file fails after a few minutes | App Service stops any request after about 230 seconds. Upload files one at a time, or split very large files |

After changing any setting, App Service restarts the app by itself.

## Running RAGAS against the deployed app

From your own computer:

```bash
python ragas_evaluate.py --sample 15 --api-url https://<name>.azurewebsites.net --password your_app_password
```

To show results in the deployed Evaluation tab, add the `ragas_scores_*.csv` and
`ragas_summary_*.json` files to `evaluation/results/` in the repository (GitHub: Add file →
Upload files). The next deployment includes them.

## Cost

The B2 plan is billed for as long as it exists, whether or not anyone uses the app, and
draws down any credit on your subscription.

- To pause spending: **App Service plan → Scale up → Free F1**. The app will not run
  properly on F1, but your settings are kept. Scale back to B2 when you need it.
- To remove everything: delete the resource group `healthcare-rag-rg`.

## Good to know

- **Speed:** there is no GPU, so the models run on the CPU, like on a laptop.
- **Gemini limits:** free-tier daily limits apply to the deployed app too.
- **Health data:** this setup is for demos and coursework. Do not upload real patient records.
