# Writing Policy Docs

Policies are markdown documents that guide the AI's decisions. Each policy is tied to a category (e.g., `pihole`, `plex`) and is included in the AI's prompt when evaluating incidents of that category.

## Where to find them

Ops → Settings → **Policies**. Click any policy to open the markdown editor.

## What a good policy looks like

Be explicit and concrete. The AI reads the markdown verbatim. Include:

- **What this policy applies to** — specific situations or domain categories
- **What action the AI should recommend** — `whitelist`, `deny`, `escalate`, `diagnose`, etc.
- **Concrete examples** — domains, symptoms, URLs
- **Edge cases** — "if X, escalate instead of auto-acting"

Example (safe categories for Pi-hole):

```markdown
# Safe categories — auto-approve

**Applies to:** Pi-hole unblock requests for domains in these categories.

- Shopping (amazon.com, target.com, walmart.com, etc.)
- News (nytimes.com, cnn.com, bbc.com, etc.)
- Social media (reddit.com, twitter.com, facebook.com, etc.)
- Streaming (netflix.com, youtube.com, spotify.com, etc.)
- Education (wikipedia.org, khanacademy.org, etc.)

**Action:** whitelist
**Confidence threshold for auto-execution:** 0.85
```

## What makes a bad policy

- Vague phrasing: "be careful with ambiguous domains" — what does that mean? Escalate or deny?
- Missing action: tells the AI what to think about but not what to do
- Conflicting rules in the same policy: pick one

## Multiple policies per category

HIM sends all **enabled** policies for the incident's category to the AI. Use this to stack:

- `pihole/safe_categories` → auto-approve obvious cases
- `pihole/dangerous_categories` → auto-deny malware/ads
- `pihole/unknown_domains` → escalate ambiguous

The AI's job is to apply the right policy to the current incident.

## Iterating with the re-evaluate button

If Claude gives a recommendation that's too cautious (or too permissive), read the `Reasoning` field in the incident detail. Often you'll notice: "Claude didn't consider X" or "Our policy doesn't mention Y". Edit the policy, then click **Re-evaluate with Claude** on the incident — Claude re-reads with the updated policy and usually corrects itself.

## Disabling vs deleting

- **Disable** (toggle off) if you're not sure you want this policy anymore — it stops being included in prompts but stays editable
- **Delete** if you're sure — gone for good, audit log records who deleted it

## Custom categories

Add categories for anything your setup has: UPS monitoring, NAS alerts, automation failures, media requests. Each custom category can have its own set of policies.
