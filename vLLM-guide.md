# GLM-4.5-Air on Akash (RTX 4090) — End-to-End Deployment Guide (with vLLM)

This guide walks a junior developer from zero → a production-style deployment of **GLM-4.5-Air** on the **Akash** compute marketplace using **vLLM**. It includes:

* whether you need a Hugging Face key,
* exactly **which model weights** to grab (with links),
* an **Akash SDL** you can paste into Console,
* step-by-step deployment, testing, and scaling with **replicas**,
* plain-English explanations of **placement**, **profiles**, **attributes**, and other SDL bits.

---

## Do I need a Hugging Face API key?

**Short answer:**

* For **public** model repos (like the ones we’ll use), you can download **without** a token.
* In practice, add a token anyway: authenticated downloads are **less likely to get rate-limited** and are sometimes required for “gated/private” repos. You can generate a **Hugging Face User Access Token** and use `hf auth login` in CI/containers.

Helpful docs:

* HF CLI login: [https://huggingface.co/docs/huggingface_hub/en/guides/cli](https://huggingface.co/docs/huggingface_hub/en/guides/cli)
* HF rate limits (why tokens help): [https://huggingface.co/docs/hub/en/rate-limits](https://huggingface.co/docs/hub/en/rate-limits)
* HF env vars (`HF_TOKEN` / `HUGGING_FACE_HUB_TOKEN`): [https://huggingface.co/docs/huggingface_hub/en/package_reference/environment_variables](https://huggingface.co/docs/huggingface_hub/en/package_reference/environment_variables)

---

## What you’ll deploy

* **Model**: **GLM-4.5-Air** (12B active MoE), **4-bit AWQ** quantization (fits well on a single **RTX 4090** 24 GB).
* **Server**: **vLLM OpenAI-compatible API** with GLM-4.5 parsers (tool-use + “thinking” mode).
* **Platform**: **Akash** (decentralized GPU marketplace). You’ll define your workload in an **SDL** (YAML) and let Akash match you to a provider.

---

## Pick the model weights (best value for 4090)

**Recommended (vLLM-ready, 4-bit AWQ):**

* `cpatonn/GLM-4.5-Air-AWQ-4bit` — model card + files:
  [https://huggingface.co/cpatonn/GLM-4.5-Air-AWQ-4bit](https://huggingface.co/cpatonn/GLM-4.5-Air-AWQ-4bit)
  (You can open “**Files and versions**” to see all shards.)

**Alternative (also works with vLLM):**

* `cpatonn/GLM-4.5-Air-GPTQ-4bit` — GPTQ flavor:
  [https://huggingface.co/models?search=cpatonn%2FGLM-4.5-Air-GPTQ-4bit](https://huggingface.co/models?search=cpatonn%2FGLM-4.5-Air-GPTQ-4bit) (open the model card result)

**Official full-precision (reference / not for a 24 GB card):**

* `zai-org/GLM-4.5-Air` — BF16/FP8 shards (large):
  [https://huggingface.co/zai-org/GLM-4.5-Air](https://huggingface.co/zai-org/GLM-4.5-Air)

**Project GitHub (release notes, tips & issues):**

* [https://github.com/zai-org/GLM-4.5](https://github.com/zai-org/GLM-4.5)

> Why AWQ? vLLM has **first-class AWQ support**, making 4-bit models easy to serve on consumer GPUs. GPTQ also works; AWQ tends to be the go-to at 4-bit.

---

## Prerequisites

1. **Wallet + a little AKT**

   * Set up a wallet (Keplr/Leap), fund it with AKT, open **Akash Console**.
     Docs: Quickstart (Console): [https://akash.network/docs/getting-started/quickstart-guides/akash-console/](https://akash.network/docs/getting-started/quickstart-guides/akash-console/)

2. **Decide your server image**

   * We’ll use **`vllm/vllm-openai:nightly`** so GLM-4.5 features and parsers are present. (Nightlies are the quickest route for GLM-specific flags.)

3. **Hugging Face token (optional but recommended)**

   * Create a token and pass it as `HF_TOKEN` (or `HUGGING_FACE_HUB_TOKEN`). Prevents 429/rate limits and lets you pull gated repos if needed.

4. **Faster downloads (optional)**

   * Enable **hf_transfer** for faster HF downloads: set `HF_HUB_ENABLE_HF_TRANSFER=1`. (Power-user tool; speeds up large multi-file repos.)

---

## The SDL you’ll paste into Akash Console (single replica on 1× RTX 4090)

> **What is SDL?** It’s a YAML manifest telling Akash *what to run*, *what resources you need*, and *how many replicas*. Think of it as Akash’s “docker-compose”.

```yaml
version: "2.0"

services:
  vllm:
    image: vllm/vllm-openai:nightly
    env:
      # OPTIONAL but recommended:
      - HF_TOKEN=${HF_TOKEN}
      - HUGGING_FACE_HUB_TOKEN=${HF_TOKEN}
      # Faster Hub transfers (optional):
      - HF_HUB_ENABLE_HF_TRANSFER=1
      # Where HF cache lives (inside the container)
      - HF_HOME=/root/.cache/huggingface
    command:
      - vllm
      - serve
      - cpatonn/GLM-4.5-Air-AWQ-4bit
      - --dtype
      - float16
      - --max-model-len
      - "8192"
      - --gpu-memory-utilization
      - "0.90"
      - --tool-call-parser
      - glm45
      - --reasoning-parser
      - glm45
      # You can add: --max-num-seqs 32 --max-num-batched-tokens 8192 (tune for concurrency)
    expose:
      - port: 8000
        to:
          - global: true   # Akash exposes a public endpoint

profiles:
  compute:
    vllm:
      resources:
        cpu:
          units: 8
        memory:
          size: 64Gi
        gpu:
          units: 1
          attributes:
            vendor:
              nvidia:
                - model: rtx4090   # require RTX 4090
        storage:
          size: 100Gi              # ephemeral disk for HF cache + logs

  placement:
    any:
      pricing:
        vllm:
          denom: uakt
          amount: 100

deployment:
  vllm:
    any:
      profile: vllm
      count: 1
```

**Why these flags?**

* `--tool-call-parser glm45` and `--reasoning-parser glm45` enable GLM-specific tool-use & “thinking” parsing in vLLM.
* `--gpu-memory-utilization 0.90` helps pack more batch/context while avoiding OOM.
* You can tune **concurrency** with `--max-num-seqs` & `--max-num-batched-tokens` later. See vLLM engine args.

**Where “4090” is enforced:**
The `gpu.attributes.vendor.nvidia.model: rtx4090` line tells Akash to place your workload only on providers offering that GPU. (Akash SDL’s compute profile is where you specify CPUs, RAM, disk, and **GPU model**.)

---

## Step-by-step deployment (Akash Console)

1. **Open Console & connect wallet**

   * [https://akash.network/deploy/](https://akash.network/deploy/) → **Launch Akash Console** → connect Keplr/Leap.

2. **Create a deployment**

   * Choose “Create Deployment”, paste the **SDL** above, name it (e.g., `glm45-air-vllm`).
   * Click **Create Deployment** → Console will ask you to **deposit** a small amount of AKT.

3. **Bid selection**

   * After posting your SDL, providers respond with bids. Pick one that meets your GPU (4090), memory & price. **Accept** the bid to create a **lease**.

4. **Verify it’s running**

   * In Console’s **Lease** view, wait for **Ready Replicas = 1** and grab the **public URL** for port **8000**. (Console shows replica counts and status as they come up.)

5. **First test (health & chat)**

   * Health (may vary by image):

     ```
     curl -s http://<your-endpoint>:8000/ | head
     ```
   * OpenAI-style chat call:

     ```bash
     curl http://<your-endpoint>:8000/v1/chat/completions \
       -H "Content-Type: application/json" \
       -d '{
         "model": "cpatonn/GLM-4.5-Air-AWQ-4bit",
         "messages":[{"role":"user","content":"Explain RAFT in 3 bullets."}],
         "extra_body": {
           "chat_template_kwargs": {"enable_thinking": false}  // faster, fewer tokens
         }
       }'
     ```

     (GLM-4.5 support & examples: vLLM’s blog/recipes.)

6. **If model downloads seem slow**

   * Ensure your container has **`HF_TOKEN`** (prevents rate limiting).
   * Consider enabling **hf_transfer** (already in env above). Docs: hf_transfer / env vars.

---

## Understanding the SDL fields (plain-English)

* **`services`**: each block is a containerized app (here, one called `vllm`).
* **`image`**: the Docker image to run.
* **`env`**: environment variables passed into the container (HF token, download acceleration, cache path).
* **`command`**: the process to run. We launch **vLLM** to serve the **GLM-4.5-Air AWQ** model.
* **`expose`**: which ports to publish (**`global: true`** makes a public endpoint).
* **`profiles.compute`**: your **resource request**: CPU, RAM, **GPU model**, disk.
* **`profiles.placement`**: **pricing & constraints** per “datacenter profile.” Think of it as where and how you’re willing to run, plus your price ceiling.
* **`deployment`**: **how many copies** (replicas) of each service to run **per placement** and which compute profile they use. The **`count`** field is the magic knob for replicas. The docs explicitly discuss changing `count` to scale.

---

## Scaling for multiple users (replicas & placements)

You told me you’ll have **~20 people** talking to the model at once. Here’s the pattern:

### A) “More replicas on one provider”

* **What it means:** Set `deployment.<service>.<placement>.count` to **>1**. Akash will run **N identical pods** behind one provider’s gateway; their Kubernetes service will load-balance traffic among them.
* **Why it helps:** vLLM is great at batching, but 20 simultaneous chats can still spike latency on one GPU. **2–3 replicas** smooth the spikes.
* **How to do it:** change `count: 1` → `count: 3` and update the deployment. Akash docs reference **count** as the scale lever.

**Example (3 replicas on the same provider):**

```yaml
deployment:
  vllm:
    any:
      profile: vllm
      count: 3    # run 3 copies (3 GPUs) on this provider
```

### B) “Cross-provider” (multi-placement)

* **What it means:** Split replicas across **different providers/regions** by adding **multiple placements** and assigning a **count** to each.
* **Why it helps:** **High availability** and regional latency control. You’ll get **multiple public endpoints** (one per provider). If you want a single URL, put an external load-balancer/CDN in front (NGINX, Cloudflare).
* **SDL idea:** you can name placements (e.g., `east`, `west`) and set attributes or pricing per placement. This is how you do multi-datacenter in a single SDL (no need to create multiple separate deployments unless you prefer it).

**Example (2 + 2 split across two placements):**

```yaml
profiles:
  placement:
    west:
      attributes:
        region: us-west
      pricing:
        vllm: { denom: uakt, amount: 110 }
    east:
      attributes:
        region: us-east
      pricing:
        vllm: { denom: uakt, amount: 110 }

deployment:
  vllm:
    west: { profile: vllm, count: 2 }   # 2 replicas in "west"
    east: { profile: vllm, count: 2 }   # 2 replicas in "east"
```

> **Tip:** Akash docs & guides frequently show changing `count` to scale a service (Kafka/Grafana examples), and their HTTP options page even calls out behavior differences when `count: 1`.

### C) When to “upgrade the GPU” instead

* A **single L40S (48 GB)** gives more **KV-cache headroom** for long contexts, but **doesn’t double** raw decode speed vs a 4090. For 20 chatters, replicas usually scale more predictably. Keep vLLM. (vLLM parallelism/scaling docs are worth a skim.)

---

## Tuning concurrency (vLLM knobs you’ll actually touch)

* `--max-num-seqs` — how many sequences can be processed concurrently.
* `--max-num-batched-tokens` — overall batch size in tokens per step.
* Start modestly (e.g., `--max-num-seqs 32`) and **watch VRAM**. On 24 GB, 8–16k context and moderate batches work well with 4-bit AWQ. Full list of engine args: vLLM docs.

> Tip: If latency matters more than deep reasoning, have the client send
> `"extra_body": {"chat_template_kwargs": {"enable_thinking": false}}` — fewer “thinking” tokens → higher throughput. GLM-4.5×vLLM docs show this toggle.

---

## Operating notes

* **Ephemeral disk**: 60–100 GB is fine for AWQ shards + cache. If you need persistence across redeploys, read **Persistent Storage** and map a volume.
* **Logs**: use Akash Console lease logs to watch the first download & load; the model pulls from Hugging Face on first boot.
* **Rate limits**: if you see 429s while downloading weights, ensure you’re using a **HF token**.
* **Faster HF pulls**: keep `HF_HUB_ENABLE_HF_TRANSFER=1` if your network is decent; it often speeds multi-file repos.

---

## Quick “copy me” links (weights & docs)

* **Model weights (recommended):**
  `cpatonn/GLM-4.5-Air-AWQ-4bit` — [https://huggingface.co/cpatonn/GLM-4.5-Air-AWQ-4bit](https://huggingface.co/cpatonn/GLM-4.5-Air-AWQ-4bit) (click **Files and versions** to see all shards)

* **Alternative weights:**
  `cpatonn/GLM-4.5-Air-GPTQ-4bit` — see model card from search results: [https://huggingface.co/models?search=cpatonn%2FGLM-4.5-Air-GPTQ-4bit](https://huggingface.co/models?search=cpatonn%2FGLM-4.5-Air-GPTQ-4bit)

* **Official full-precision reference:**
  `zai-org/GLM-4.5-Air` — [https://huggingface.co/zai-org/GLM-4.5-Air](https://huggingface.co/zai-org/GLM-4.5-Air)

* **Project GitHub:**
  [https://github.com/zai-org/GLM-4.5](https://github.com/zai-org/GLM-4.5)

* **vLLM GLM-4.5 recipe / blog:**
  [https://docs.vllm.ai/projects/recipes/en/latest/GLM/GLM-4.5.html](https://docs.vllm.ai/projects/recipes/en/latest/GLM/GLM-4.5.html)
  [https://blog.vllm.ai/2025/08/19/glm45-vllm.html](https://blog.vllm.ai/2025/08/19/glm45-vllm.html)

* **Akash SDL & scaling docs:**
  SDL overview (what `profiles` / `deployment` / `count` mean): [https://akash.network/docs/getting-started/stack-definition-language/](https://akash.network/docs/getting-started/stack-definition-language/)
  Scaling by `count`: examples in Kafka/Grafana guides
  [https://akash.network/docs/guides/tooling/kafka/](https://akash.network/docs/guides/tooling/kafka/)
  [https://akash.network/docs/guides/data-analysis/grafana/](https://akash.network/docs/guides/data-analysis/grafana/)
  HTTP options page mentions behavior when `count: 1`:
  [https://akash.network/docs/network-features/deployment-http-options/](https://akash.network/docs/network-features/deployment-http-options/)

* **Akash Console quickstart:**
  [https://akash.network/docs/getting-started/quickstart-guides/akash-console/](https://akash.network/docs/getting-started/quickstart-guides/akash-console/)

* **HF tokens & transfer accel:**
  [https://huggingface.co/docs/huggingface_hub/en/guides/cli](https://huggingface.co/docs/huggingface_hub/en/guides/cli)
  [https://huggingface.co/docs/hub/en/rate-limits](https://huggingface.co/docs/hub/en/rate-limits)
  [https://huggingface.co/docs/huggingface_hub/en/package_reference/environment_variables](https://huggingface.co/docs/huggingface_hub/en/package_reference/environment_variables)
  [https://huggingface.co/docs/hub/en/models-downloading#faster-downloads](https://huggingface.co/docs/hub/en/models-downloading#faster-downloads)

---

## FAQ

**Q: Can I deploy one SDL per provider instead of multi-placement?**
A: Yes—**separate deployments** are fine and keep endpoints isolated. **Multi-placement in a single SDL** is just a convenience for managing **one logical app** across multiple providers. Both approaches are valid on Akash. (SDL supports **multiple placements** with separate `count` values.)

**Q: Does vLLM support these AWQ/GPTQ quantizations?**
A: Yes—vLLM supports both **AWQ** and **GPTQ** models; use recent vLLM builds for best performance.

---

If you want, I can tailor the SDL for **2–3 replicas** on 4090s right now (and add a tiny NGINX in front), or bump context limits for your use case.