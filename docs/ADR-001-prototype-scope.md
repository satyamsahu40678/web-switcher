# ADR-001: Local routing feasibility before automatic discovery

Status: adopted for the experimental prototype, 26 October 2026 (Asia/Kolkata).

## Context

The repository began at commit `075bc000eaf203f912c4e610b3f7fbc7746681e9` with only a README. The planning study produced a broader verified-registry design. Browser execution was not available in that first study; the gate and permission behavior therefore require independent validation before the larger application is built.

## Decision

Build a small unpacked MV3 extension with plain packaged JavaScript and no backend. This is a feasibility artifact, not a replacement for the planned TypeScript/React/WXT application or Java service. Shared pure functions make its URL and rule decisions directly testable.

The prototype supports only **user-approved local mappings**. Its settings describe user intent, not proof that two domains share an operator. There is no trusted public catalog or automatic discovery. No example domain from the original request is preinstalled.

Trust classes for the eventual product remain separate:

| Class | Meaning | Prototype support |
| --- | --- | --- |
| Local user mapping | User explicitly chooses a destination | Implemented |
| Reviewed registry mapping | Published by a trusted review process | Planned |
| Owner-signed continuity | Established owner key authorizes an update | Planned |
| Unverified candidate | Search/crawl/community evidence only | Never auto-routed |

## Data flow and controls

1. The settings page validates an origin pair and requests access to the source in a user gesture.
2. The background worker validates the message sender, schema, mapping count and non-chained destinations.
3. A new generation is staged locally, DNR rules are replaced, then the generation is committed. The gate rejects mismatched generations. Startup restores the last committed configuration after interruption.
4. An eligible top-level GET request reaches the packaged gate. Its raw source stays in the local URL fragment and is removed from that address immediately after parsing.
5. The worker checks the exact source, current settings, expiry, source permission and tab loop guard. A navigation decision contains only a configured destination.
6. The gate either navigates or displays a reason for stopping. Sensitive links can offer a user-initiated destination homepage with no original path, query or fragment.
7. An origin-only receipt records a routing attempt. The browser makes the ordinary destination request; the extension does not fetch the site or collect its content.

## Threats and limits

| Threat | Current control | Remaining limitation |
| --- | --- | --- |
| Impostor destination | Explicit user approval; no inferred relationship | User can approve the wrong domain |
| Stale DNR entry | Generation, expiry and pause checks at the gate | Incorrect system clock can affect freshness |
| URL/token leakage | Default homepage policy; drop query/fragment; sensitive-route pause | Optional path preservation may expose unrecognized private path segments |
| Lookalike source | Exact normalized origin; no inferred subdomains | Real domain ownership can change |
| Infinite navigation | Reject local chains; bounded per-tab recent-attempt guard | Back/forward and service-worker cases need broader testing |
| Arbitrary redirect through gate | Destination loaded from current local config; validate source and generation | Gate exposure can reveal extension presence |
| Malicious page mutates settings | Only the extension settings page can issue mutations; no external messaging | Browser/profile compromise is outside this model |
| Configuration corruption/interruption | Fail closed; restart reconciliation | Full repair UI and schema migrations are not implemented |
| Privacy loss from diagnostics | Only origin pairs/timestamps; maximum 20; clear control | Origins themselves can reveal interests |

Unsupported: automatic discovery, identity verification, bookmark rewriting, POST/API/iframe routing, custom production ports, private hosts, source service workers, full deep-link recovery, per-tab undo, browser-store distribution and unsupported-browser claims. Current Chrome/Edge installation, native permission dialogs, suspend/resume and broad navigation tests remain release gates.

## Consequences

The prototype can evaluate the browser mechanism and local UX with a small review surface. Its results cannot establish universal recovery, identity correctness or novelty. Preserve this boundary in UI text, test reports and project descriptions. Extend the implementation only after the remaining P0 gates are assessed.
