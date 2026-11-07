# AWS IAM

First-party AWS IAM tools run on the host with vaulted credentials (or instance metadata). Agents only see them after Settings → Integrations has an AWS IAM account that is ready: an access key plus secret, or **Use instance metadata**.

Locus talks to IAM and STS with signed `fetch` (SigV4 + Query XML) on the control plane — the same approach as Fargate placement, with no AWS SDK. Credentials stay in the vault (or IMDS).

## Setup

1. Settings → Integrations → **Add AWS IAM**.
2. Paste an **Access key ID** and **Secret access key**. Optional session token for temporary STS keys. Optional region (default `us-east-1`). Optional **Assume role ARN** so every call runs as that role.
3. Or, when Locus itself runs on EC2/ECS, enable **Use instance metadata (IMDS / ECS task role)** and leave the access key empty. Locus uses IMDSv2 (`169.254.169.254`) or the ECS container credentials URI. `AWS_CONTAINER_CREDENTIALS_FULL_URI` must be link-local or loopback.
4. Optional endpoints (https, or http on loopback):
   - **IAM endpoint** — full URL, path kept. Default `https://iam.amazonaws.com`. Use a VPC interface hostname such as `https://vpce-….iam.amazonaws.com`.
   - **STS endpoint** — full URL for GetCallerIdentity and AssumeRole. Empty uses regional `sts.{region}.amazonaws.com`.
   - **AWS gateway URL** — when IAM/STS are still the AWS defaults, both Query APIs POST to this URL (one proxy that routes on `Action`, or a single API Gateway resource). A non-default IAM or STS endpoint wins over the gateway for that service.
5. Save.

`execute-api.{region}.amazonaws.com` hosts sign as **execute-api** in that region. VPC / IAM / STS hosts keep the native service name. The control plane does not create API Gateway, VPC endpoints, or NAT gateways.

Secret key and session token stay in `~/.locus/secrets.enc`, never in the guest or the prompt. Access key ID, role ARN, and endpoint URLs stay in `config.json`.

## Agent tools

| Tool | What it does |
| --- | --- |
| `aws_sts_identity` | `GetCallerIdentity` — account, ARN, user id |
| `aws_iam_list` | List users, roles, or policies (`resource=user\|role\|policy`) |
| `aws_iam_get` | Get a user, role, managed policy (ARN), or attached role policies |
| `aws_iam_simulate` | `SimulatePrincipalPolicy` — can this principal do these actions? |

All four are reads. They do not wait for Approve / Deny. Responses are JSON parsed from the Query API and treated as untrusted tool output. Large payloads offload to `/workspace/.locus/tool-results/` like Grafana.

Do not curl IAM or STS from `exec`. Do not paste keys into chat.

## Other AWS hops

| Hop | Where |
| --- | --- |
| Fargate RunTask / DescribeTasks / StopTask | Settings → Workers → Fargate → **ECS endpoint** (optional PrivateLink or API Gateway URL) |
| Amazon Bedrock or an OpenAI-compatible API Gateway | Settings → Providers → Amazon Bedrock (or a custom base URL). Set **Access key ID**; the secret is the provider key. Leave Access key ID empty to send Bearer / `x-api-key` instead. |
| AWS MCP / AgentCore HTTP gateway | Settings → MCP → HTTP URL. Env `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`, `AWS_REGION`, `AWS_SIGV4` (service, default `execute-api`). |
| Webhook automations in through API Gateway | Settings → Advanced → **Webhook base URL** = the execute-api origin. Funnel or HTTP integration still targets loopback `/api/hooks` only. Locus unwraps REST/HTTP API proxy events and accepts `x-api-key` as the hook secret. Bind host stays loopback. |

## Cursor CLI

When AWS IAM is configured, the same tools appear on the loopback locus MCP server (`POST /mcp`), next to Grafana / Slack / Jira. Tokens are never written into `.cursor/mcp.json`.

## Automations

On webhook jobs, list `aws_sts_identity` (and any other `aws_iam_*` names) in **Allowed MCP / integration tools**. Empty means no first-party AWS tools on that job. See [webhook-automations.md](webhook-automations.md).
