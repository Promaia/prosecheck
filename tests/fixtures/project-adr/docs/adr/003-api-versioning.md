# 3. API versioning strategy

## Status

Accepted

## Context

We need to version our API to support backwards compatibility.

## Decision

Use URL-based versioning with `/v1/`, `/v2/` prefixes.

## Consequences

Clear versioning visible in URLs. Old versions can be maintained
alongside new ones.
