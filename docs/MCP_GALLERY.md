# MCP gallery decision (W5)

## Schema (verified in upstream)

`src/vs/base/common/product.ts` defines:

```ts
mcpGallery?: {
  serviceUrl, itemWebUrl, publisherUrl,
  supportUrl, privacyPolicyUrl, termsOfServiceUrl, reportUrl
}
```

Pan verified the **schema exists**. She did **not** verify what a conforming service must return.

## Decision (2026-08-01 · Toph)

| Choice | |
|--------|--|
| **Ship `mcpGallery` now?** | **No** — not until a real endpoint contract is proven |
| **Why** | Inventing a URL that 404s is worse than absence; chamber MCP servers (CAIRN, etc.) already run outside this gallery |
| **Intent** | JourdanLabs engine shelf as MCP gallery remains the differentiated opportunity |
| **Next** | Research Open VSX–style MCP registry contract OR stand a minimal static catalog service; then set `product.json` `mcpGallery` |

## Extensions gallery (done)

`extensionsGallery` points at **Open VSX** only. Microsoft Marketplace is not configured (ToS + product honesty).

## Record

This file is the gate artifact for “MCP gallery decision made and recorded either way.”
