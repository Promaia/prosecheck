# 4. Centralized logging

## Status

Accepted

## Context

Logging is inconsistent across modules.

## Decision

Use the shared Logger class for all logging.

## Rules

Never use console.log, console.warn, or console.error directly.
All logging must go through the Logger class which handles
formatting, levels, and output destinations.
