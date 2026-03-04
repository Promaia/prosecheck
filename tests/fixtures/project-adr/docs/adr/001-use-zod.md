# 1. Use Zod for all external data validation

## Status

Accepted

## Decision

All external data entering the system (API requests, file reads, environment
variables) must be validated using Zod schemas.
