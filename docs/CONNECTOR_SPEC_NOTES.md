# What the MCP spec and Claude's connector client actually require

*Checked 2026-10-30, before writing phase 4. Every claim here has a URL. Where
the spec and Claude's client disagree, Claude's client wins, because it is the
only client we have to work with.*

Sources read:

- MCP versioning: <https://modelcontextprotocol.io/specification/versioning>
- MCP authorization (2025-06-18): <https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization>
- MCP Streamable HTTP (2026-07-28): <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http>
- Claude, building a connector: <https://claude.com/docs/connectors/building>
- Claude, connector authentication: <https://claude.com/docs/connectors/building/authentication>

---

## 1. Which protocol revision to build for

The **current** MCP revision is `2026-07-28`. It is not the one to build for.

That revision removed the GET stream, removed protocol-level sessions
(`Mcp-Session-Id`), replaced the `initialize` handshake with per-request
metadata (`io.modelcontextprotocol/protocolVersion` in `_meta`, mirrored into
the `MCP-Protocol-Version` header), and added required `Mcp-Method` and
`Mcp-Name` headers that the server must validate against the body.

Claude's connector client does not speak it. Claude's authentication page says
plainly:

> **Specification version**: Claude follows the 2025-03-26, 2025-06-18, and
> 2025-11-25 authorization specifications

So: **target the `2025-11-25` era** - `initialize` handshake, optional
`Mcp-Session-Id`, Streamable HTTP POST with `Accept: application/json,
text/event-stream`. Do not reject a request for lacking
`MCP-Protocol-Version`; the older clients Claude uses do not always send it.
Being lenient about the newer revision's required headers costs nothing and
keeps the newer clients working too.

Transport: Streamable HTTP. Claude also still supports the deprecated
2024-11-05 HTTP+SSE transport; we do not need to.

## 2. Limits that shape the tool design

| Limit | claude.ai and Desktop |
|---|---|
| Maximum tool result size | ~150,000 characters |
| Tool call timeout | 240 seconds per tool call |

240 seconds is why `generate` is a job with a job id rather than a tool that
waits (M3). 150,000 characters is why `get_screens` summarises and
`render_screen` returns an image rather than a scene graph.

Not supported by Claude, so nothing may depend on them: **resource
subscriptions, sampling, advanced or draft capabilities.**

## 3. What our OAuth server has to do

We are both the resource server and the authorization server.

**Discovery.**

- The MCP server MUST implement RFC 9728 protected resource metadata at
  `/.well-known/oauth-protected-resource`, whose `resource` field **must equal
  the MCP server URL exactly as the user typed it into Claude, path included**.
- `authorization_servers` must list our issuer. Claude **uses only the first
  entry** and does not fall back to later ones.
- The authorization server MUST serve RFC 8414 metadata at
  `/.well-known/oauth-authorization-server`.
- An unauthenticated call MUST answer `401` with a pointer:

  ```http
  HTTP/1.1 401 Unauthorized
  WWW-Authenticate: Bearer resource_metadata="https://host/.well-known/oauth-protected-resource"
  ```

  The `401` is required: **Claude ignores `WWW-Authenticate` on a `200`.**

**Client registration.** Claude registers itself through Dynamic Client
Registration (RFC 7591) at a `registration_endpoint`, as a **public client**.
`/register` takes `application/json`. CIMD is the alternative and needs both
`"client_id_metadata_document_supported": true` and `"none"` in
`token_endpoint_auth_methods_supported`; DCR is simpler for one deployment, so
DCR it is.

**Redirect URIs.** Register exactly:

```
https://claude.ai/api/mcp/auth_callback
```

and accept a **port-agnostic loopback** for Claude Code - both
`http://localhost/callback` and `http://127.0.0.1/callback`, any port. Exact
matching otherwise: the spec requires exact redirect URI matching, and the port
is the one component to ignore.

**PKCE.** Claude sends `code_challenge` with `code_challenge_method=S256` on
every authorization request. S256 is therefore required, not optional, and the
metadata must advertise `"code_challenge_methods_supported": ["S256"]`.

**Resource indicators.** Clients MUST send `resource` (RFC 8707) on both the
authorization and the token request, and the server MUST validate that a token
presented to it was issued for it. Token passthrough is forbidden.

**Token endpoint.** `application/x-www-form-urlencoded`, not JSON - a
JSON-only body parser returns 415 and the flow fails. Refresh tokens must
**rotate** for public clients, returning the new one in the same response that
invalidates the old. An invalid refresh token must answer `invalid_grant`, not
`invalid_request`.

**Latency.** Claude allows 10 seconds for discovery, registration and token,
and 30 seconds for a refresh. Everything on these paths stays Mongo-only.

**Scopes.** Claude requests what `scopes_supported` advertises, plus
`offline_access` when the authorization server metadata lists it - which is how
it asks for a refresh token.

**Network.** Anthropic calls from `160.79.104.0/21`, and from the cloud, not
from the user's machine. Nothing about the connector works against localhost in
production; the MCP Inspector is how it is tested locally.

## 4. The static-credential fallback

Claude's `static_headers` type ("a fixed credential an organization Owner
enters once, sent as a request header") is **beta and limited to some
organizations**, so it cannot be relied on. Our personal access token fallback
reads the same standard header names (`authorization`, `x-api-key`), which
costs nothing and works for the MCP Inspector and for Claude Code regardless.

A token must **never** be read from the query string: the spec prohibits it and
URLs reach logs, proxies and history.

## 5. Consequences for this repo

1. One route, `POST /api/mcp`, Streamable HTTP, `initialize` handshake era.
2. `401` with the `resource_metadata` pointer, never a 200 with a hint.
3. The `resource` field must be built from the request's own URL, because it
   must match what the user typed, and this deployment answers on more than one
   hostname (Vercel preview URLs, the production domain).
4. Tool results are bounded by design, not by hope: 150k characters is the cap.
5. `generate` cannot be synchronous: 240 s < a real build.
