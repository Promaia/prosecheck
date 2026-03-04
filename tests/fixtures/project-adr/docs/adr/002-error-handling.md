# 2. Use structured error handling

## Status

Accepted

## Context

We need a consistent error handling strategy across the codebase.

## Decision

All errors must use the AppError class hierarchy.

## Rules

All thrown errors must be instances of AppError or its subclasses.
Do not throw plain Error objects or string literals. Each error must
include a machine-readable error code and a human-readable message.

## Consequences

Consistent error handling across the codebase. Error codes can be
used for programmatic error handling by consumers.
