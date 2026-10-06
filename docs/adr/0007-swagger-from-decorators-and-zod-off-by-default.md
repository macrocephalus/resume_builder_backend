# Swagger from controller decorators and the shared Zod schemas, off by default

The OpenAPI document is built by `@nestjs/swagger` from decorators on the controllers. The request
and response schemas in those decorators are the `@cv/shared` Zod schemas (`standardSchema`, and
`z.toJSONSchema` for a body), not DTO classes with `@ApiProperty`: those would repeat the contract
in a second place that drifts from the schemas the api actually validates with.

The docs are served only when `API_DOCS=true` (`pnpm dev` sets it). A forgotten flag keeps them
off, which is the safe side: a production api doesn't publish a map of itself.

## Consequences

- One new dependency, `@nestjs/swagger`; its `swagger-ui-dist` telemetry install script is not
  allowed to run (`allowBuilds` in the root `pnpm-workspace.yaml`).
- Schemas are inlined in each operation; there is no `components.schemas` list.
- The error codes per route are written by hand in `@ApiErrors`, and can fall behind the service;
  docs/api.md stays the contract.
