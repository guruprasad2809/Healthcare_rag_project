# Deploying on Google Cloud (one VM)

This runs the whole application on one Compute Engine virtual machine with Docker:

```
Internet ──► Caddy (ports 80/443) ──► app (Node.js, port 3000) ──► Qdrant
                                        │
                                        └──► Gemini API
```

- **Caddy** is the web entry point. With a domain name it sets up HTTPS by itself.
- **app** is this project (backend + frontend) built from the `Dockerfile`.
- **Qdrant** stores the vectors. It is not reachable from the internet.
- Models, the document list and the vectors are kept on Docker volumes, so they survive restarts.

Run the commands in **Cloud Shell** (the `>_` button at the top of console.cloud.google.com),
which already has `gcloud`, or install the gcloud CLI on your computer.

## 1. Project and billing

1. Create a project in the Google Cloud console and link a billing account.
2. In Cloud Shell, select it and enable Compute Engine:

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable compute.googleapis.com
```

## 2. Create the VM

```bash
# A fixed public IP address
gcloud compute addresses create healthcare-rag-ip --region=asia-south1

# The VM: 2 CPUs, 8 GB memory, 30 GB disk, Debian 12
gcloud compute instances create healthcare-rag \
  --zone=asia-south1-a \
  --machine-type=e2-standard-2 \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB \
  --address=healthcare-rag-ip \
  --tags=healthcare-rag-web

# Allow web traffic to it
gcloud compute firewall-rules create healthcare-rag-allow-web \
  --allow=tcp:80,tcp:443 --target-tags=healthcare-rag-web --source-ranges=0.0.0.0/0

# Show the IP address (note it down)
gcloud compute addresses describe healthcare-rag-ip --region=asia-south1 --format='value(address)'
```

`asia-south1` is Mumbai. The embedding model needs the 8 GB of memory; a smaller machine
may run out. Check the monthly price of `e2-standard-2` in the Google Cloud pricing
calculator before you create it.

## 3. Install Docker on the VM

```bash
gcloud compute ssh healthcare-rag --zone=asia-south1-a
```

Then, on the VM:

```bash
sudo apt-get update && sudo apt-get install -y git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```

Connect again with the same `gcloud compute ssh` command so the Docker permission applies.

## 4. Get the code and set the secrets

```bash
git clone https://github.com/guruprasad2809/Healthcare_rag_project.git
cd Healthcare_rag_project
cp .env.example .env
nano .env
```

In `.env` set at least these two lines, then save (Ctrl+O, Enter) and exit (Ctrl+X):

```
GEMINI_API_KEY=your_gemini_key
APP_PASSWORD=a_long_password_you_choose
```

The login name is `admin` unless you change `APP_USERNAME`. `.env` stays on the VM; it is
never committed to Git.

## 5. Start the application

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f app
```

The first start builds the image and downloads the models, which takes a few minutes. Wait
for `Embedding model ready` and `Reranker ready`, then press Ctrl+C (this only stops the
log view, not the app).

Open `http://YOUR_VM_IP` in a browser and log in with `admin` and your password.

## 6. Load documents

Upload files in the page, or load the 15 sample documents:

```bash
docker compose -f docker-compose.prod.yml exec app npm run ingest:samples
```

## 7. HTTPS with a domain name (recommended)

Without HTTPS the password travels unencrypted, so use plain HTTP only for short tests.

1. At your domain provider, add an **A record** (for example `rag.example.com`) pointing to the VM's IP.
2. In `.env` on the VM set `SITE_ADDRESS=rag.example.com`.
3. Restart: `docker compose -f docker-compose.prod.yml up -d`

Caddy then gets and renews the certificate by itself. Open `https://rag.example.com`.

## Day-to-day commands

Run these on the VM, inside the `Healthcare_rag_project` folder.

| Task | Command |
|---|---|
| See what is running | `docker compose -f docker-compose.prod.yml ps` |
| Read the app's log | `docker compose -f docker-compose.prod.yml logs --tail 100 app` |
| Apply a change to `.env` | `docker compose -f docker-compose.prod.yml up -d` |
| Update to the newest code | `git pull && docker compose -f docker-compose.prod.yml up -d --build` |
| Stop the application | `docker compose -f docker-compose.prod.yml down` |

## Running RAGAS against the deployed app

Run the evaluation from your own computer and point it at the server:

```bash
python ragas_evaluate.py --sample 15 --api-url http://YOUR_VM_IP --password your_app_password
```

To show the results in the deployed Evaluation tab, copy the result files to the VM
(run this on your computer, from the project folder):

```bash
gcloud compute scp evaluation/results/ragas_* healthcare-rag:~/Healthcare_rag_project/evaluation/results/ --zone=asia-south1-a
```

## Saving money

```bash
gcloud compute instances stop healthcare-rag --zone=asia-south1-a    # pause (disk and IP still billed)
gcloud compute instances start healthcare-rag --zone=asia-south1-a   # resume; the app starts by itself
```

To remove everything:

```bash
gcloud compute instances delete healthcare-rag --zone=asia-south1-a
gcloud compute addresses delete healthcare-rag-ip --region=asia-south1
gcloud compute firewall-rules delete healthcare-rag-allow-web
```

## Good to know

- **Speed:** the VM has no GPU, so the models run on the CPU, like on a laptop.
- **Gemini limits:** free-tier daily limits apply to the deployed app too.
- **Backups:** documents can always be uploaded again. To keep the index itself, snapshot the VM's disk in the console.
- **Health data:** this setup is for demos and coursework. Do not upload real patient records; that needs proper access control, audit logs and legal agreements.
