# Error responses use the shared ApiError class

All error responses returned from API route handlers must use the
ApiError class. Do not throw plain Error objects or return ad-hoc
error shapes.

# API routes must validate input with Zod

All API route handlers must validate request bodies and query
parameters using Zod schemas before processing.
