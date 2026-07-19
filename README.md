# IngRouter

A minimal, dependency-free HTTP router for Deno built on the Web Standard
`Request` / `Response` APIs. It supports route registration, middleware
chains, and nested sub-routers (mounting) with a single shared config.

## Features

- Web Standard `Request` / `Response` (no framework lock-in)
- Method + exact-path matching
- Middleware chains (left-to-right, then handler)
- Nested routing via `mount()` with automatic prefix flattening
- Single shared config on the root router

## Installation

Published on JSR. Import it with the JSR URL or your preferred registry alias:

```ts
import Router from "jsr:@your-scope/ing-router@1";
```

## Quick start

```ts
import Router from "jsr:@your-scope/ing-router@1";

const app = new Router({ routerType: "array" });

app.add("GET", "/health", () => new Response("ok"));

const res = await app.handle(new Request("http://localhost/health"), "/health");
// res.status === 200, body "ok"
```

`handle(req, pathname)` requires you to pass the pathname separately from the
`Request`. In a server entrypoint you typically derive it from the request URL:

```ts
Deno.serve(async (req) => {
  const pathname = new URL(req.url).pathname;
  return await app.handle(req, pathname);
});
```

## Configuration

The root router is created once with a config object. This config is the
single shared config for the whole router tree.

```ts
type RouterConfig = {
  routerType?: "array" | "map";
};

const app = new Router({ routerType: "array" });
```

Notes:

- `routerType` defaults to `"array"` when omitted.
- The config is set once at construction. Sub-routers passed to `mount()` do
  not need their own config; only the root instance's config is used.
- `routerType` (`"array"` vs `"map"`) and the internal `routesMap` are planned
  features currently in development. Today they have **no effect** on routing:
  all routes are stored and matched using the array strategy regardless of the
  configured value.

## Routes and handlers

```ts
type Handler = (req: Request, ctx: Context) => Response | Promise<Response>;
type Context = Record<string, unknown>;
```

Register a route with `add(method, path, ...fns)`. The last function is the
handler; any functions before it are middlewares.

```ts
app.add("GET", "/users/123", (req, ctx) => {
  return new Response("user 123");
});
```

### Matching behavior

- Matching is **exact** on both method and path. A route registered at
  `"/users"` does NOT match `"/users/123"`.
- If no route matches, `handle` returns `404` with body
  `"Ing Router: Not Found"`.
- If a handler or middleware throws, `handle` catches it, logs the error, and
  returns `500` with body `"Ing Router: Internal Server Error"`.

## Middleware

Middlewares are functions that receive `(req, ctx, next)`. Call `next()` to
continue the chain; the handler runs last.

```ts
type Middleware = (
  req: Request,
  ctx: Context,
  next: () => Promise<Response>,
) => Promise<Response>;

const auth: Middleware = async (req, ctx, next) => {
  const ok = req.headers.get("authorization");
  if (!ok) return new Response("unauthorized", { status: 401 });
  return next();
};

app.add("GET", "/secret", auth, (req, ctx) => {
  return new Response("secret");
});
```

A middleware may short-circuit the chain by returning a `Response` without
calling `next()`.

## Nested routing (mounting)

A sub-router is just another `Router` instance. `mount(prefix, subRouter)`
flattens the sub-router's routes into the parent under the given prefix. All
routes end up on the single root instance, so there is one config and one
`handle` call.

```ts
const api = new Router();
api.add("GET", "/users/123", () => new Response("u123"));

const app = new Router();
app.mount("/api", api);
// now reachable at "/api/users/123"
```

Slashes are normalized, so `mount("/api/", api)` with `add("GET", "x", ...)`
produces the path `"/api/x"`.

### Multi-level nesting

Nesting composes arbitrarily. Populate the leaf router first, then mount it
into its parent, then mount that parent into the root:

```ts
const hello = new Router();
hello.add("GET", "/world", () => new Response("hi"));

const api = new Router();
api.mount("/hello", hello); // "/hello/world"

const app = new Router();
app.mount("/api", api); // "/api/hello/world"
```

The resulting route `"/api/hello/world"` belongs to `app` and is reachable
through `app.handle(req, "/api/hello/world")`.

### Organizing across files

Keep dependencies one-directional: leaf routers never import their parents.

`hello.ts`:

```ts
import Router from "jsr:@your-scope/ing-router@1";
const hello = new Router();
hello.add("GET", "/world", () => new Response("hi"));
export default hello;
```

`api.ts`:

```ts
import Router from "jsr:@your-scope/ing-router@1";
import hello from "./hello.ts";
const api = new Router();
api.mount("/hello", hello);
export default api;
```

`server.ts`:

```ts
import Router from "jsr:@your-scope/ing-router@1";
import api from "./api.ts";
const app = new Router({ routerType: "array" });
app.mount("/api", api);
```

Because ES module imports evaluate leaf-first, `api` is fully populated before
it is mounted into `app`.

## Important: mount is eager

`mount()` reads the sub-router's routes at the moment it is called and copies
them (with the prefix) into the parent. Routes added to the sub-router
_after_ mounting are NOT captured. Always populate a sub-router before
mounting it, and mount inner routers before outer ones.

```ts
const api = new Router();
const app = new Router();
app.mount("/api", api);
api.add("GET", "/late", () => new Response("x")); // too late; not captured
```

## Inspecting routes

```ts
app.getRoutes(); // Array<{ method: Method; path: string }>
app.printRoutes(); // logs a formatted table to stdout
```

## API reference

### `new Router(config?: RouterConfig)`

Creates a router. `routerType` defaults to `"array"`.

### `add(method, path, ...fns)`

Registers a route. `method` is one of `GET`, `POST`, `PUT`, `DELETE`,
`PATCH`, `OPTIONS`, `HEAD`. The final argument is the `Handler`; preceding
arguments are `Middleware`. Throws if no handler is provided.

### `mount(prefix, subRouter)`

Flattens `subRouter`'s routes into this router under `prefix`, normalizing
leading/trailing slashes. Eager: reads `subRouter` at call time.

### `handle(req, pathname): Promise<Response>`

Matches `req.method` and `pathname` exactly against registered routes, runs
middlewares then the handler, and returns a `Response`. Returns `404` on no
match and `500` on handler/middleware errors.

### `getRoutes(): Array<{ method: Method; path: string }>`

Returns a copy of all registered routes, including mounted (prefixed) ones.

### `printRoutes(): void`

Prints a formatted table of all routes to stdout.

## License

MIT

This project is open source. Maintained by [Ingenium Solutions](https://ingsolutions.xyz);
