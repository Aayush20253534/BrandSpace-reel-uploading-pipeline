# ADR-001: Modular monolith with workers

Status: Accepted

Use one TypeScript monorepo with a web/API process and worker process. Shared domain
packages define boundaries. Do not introduce microservices until operational scale or
independent deployment requirements justify them.
