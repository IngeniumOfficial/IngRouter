import { assertSpyCalls, spy } from "jsr:@std/testing/mock";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import Router from "./router.ts";
import { Context } from "./router.ts";

/**
 * Constructor and Config
 */

Deno.test("constructor defaults routerType to 'array'", () => {
  const r: Router = new Router();
  assertEquals(r.config.routerType, "array");
});

Deno.test("constructor accepts explicit routerType", () => {
  const r2: Router = new Router({ routerType: "map" });
  assertEquals(r2.config.routerType, "map");
});

/**
 * add()
 */

Deno.test("add throws when no handler is provided", () => {
  const r: Router = new Router();
  let threw = false;
  try {
    r.add("GET", "/x");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("add stores method and path", () => {
  const r: Router = new Router();
  const handler = () => new Response("ok");
  r.add("GET", "/hello", handler);
  assertEquals(r.getRoutes(), [{ method: "GET", path: "/hello" }]);
});

/**
 * handle()
 */

Deno.test("handle returns a 404 when no route matches", async () => {
  const r: Router = new Router();
  const res = await r.handle(new Request("http://x/a"), "/a");
  assertEquals(res.status, 404);
  assertStringIncludes(await res.text(), "Not Found");
});

Deno.test("handle matches exact method + path and runs handler", async () => {
  const r: Router = new Router();
  r.add("GET", "/users", () => new Response("list"));
  const res = await r.handle(new Request("http://x/users"), "/users");
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "list");
});

Deno.test("handle only matches exact path (no prefix matching)", async () => {
  const r: Router = new Router();
  r.add("GET", "/users", () => new Response("list"));
  const res = await r.handle(new Request("http://x/users/123"), "/users/123");
  assertEquals(res.status, 404);
});

Deno.test("middlewares run left-to-right before handler", async () => {
  const r: Router = new Router();
  const order: string[] = [];
  const mw1: any = async (
    _req: Request,
    _ctx: Context,
    next: () => Promise<Response>,
  ) => {
    order.push("mw1");
    return next();
  };
  const mw2: any = async (
    _req: Request,
    _ctx: Context,
    next: () => Promise<Response>,
  ) => {
    order.push("mw2");
    return next();
  };
  const handler: any = () => {
    order.push("handler");
    return new Response("ok");
  };
  r.add("GET", "/m", mw1, mw2, handler);
  await r.handle(new Request("http://x/m"), "/m");
  assertEquals(order, ["mw1", "mw2", "handler"]);
});

Deno.test("middleware can short-circuit the chain", async () => {
  const r: Router = new Router();
  const mw = async (
    _req: Request,
    _ctx: Context,
    _next: () => Promise<Response>,
  ) => new Response("blocked", { status: 401 });
  r.add("GET", "/m", mw, () => new Response("ok"));
  const res = await r.handle(new Request("http://x/m"), "/m");
  assertEquals(res.status, 401);
  assertEquals(await res.text(), "blocked");
});

Deno.test("handler error becomes 500", async () => {
  const r: Router = new Router();
  r.add("GET", "/boom", () => {
    throw new Error("kaboom");
  });
  const res = await r.handle(new Request("http://x/boom"), "/boom");
  assertEquals(res.status, 500);
  assertStringIncludes(await res.text(), "Internal Server Error");
});

/**
 * mount()
 */

Deno.test("mount flattens sub-routes under prefix", async () => {
  const app = new Router({});
  const api = new Router();
  api.add("GET", "/users/123", () => new Response("u123"));
  app.mount("/api", api);

  assertEquals(app.getRoutes(), [
    {
      method: "GET",
      path: "/api/users/123",
    },
  ]);
});

Deno.test("mounted route is reachable via handle", async () => {
  const app = new Router({});
  const api = new Router();
  api.add("GET", "/users/123", () => new Response("u123"));
  app.mount("/api", api);

  const res = await app.handle(
    new Request("http://x/api/users/123"),
    "/api/users/123",
  );

  assertEquals(res.status, 200);
  assertEquals(await res.text(), "u123");
});

Deno.test("mount normalizes trailing slash on prefix", () => {
  const app = new Router({});
  const api = new Router();
  api.add("GET", "/x", () => new Response("ok"));
  app.mount("/api/", api); // trailing slash
  assertEquals(app.getRoutes()[0].path, "/api/x");
});

Deno.test("mount normalizes leading slash on sub-route path", () => {
  const app = new Router({});
  const api = new Router();
  api.add("GET", "x", () => new Response("ok")); // no leading slash
  app.mount("/api", api);
  assertEquals(app.getRoutes()[0].path, "/api/x");
});

Deno.test("sibling prefixes stay distinct under one config", async () => {
  const app = new Router({});
  const a = new Router();
  a.add("GET", "/getStuff", () => new Response("A"));
  const p = new Router();
  p.add("GET", "/getStuff", () => new Response("P"));
  app.mount("/api", a);
  app.mount("/progres", p);

  const r1 = await app.handle(
    new Request("http://x/api/getStuff"),
    "/api/getStuff",
  );
  const r2 = await app.handle(
    new Request("http://x/progres/getStuff"),
    "/progres/getStuff",
  );
  assertEquals(await r1.text(), "A");
  assertEquals(await r2.text(), "P");
});

Deno.test(
  "two-level nesting: app.mount('/api', api) where api.mount('/hello', hello)",
  async () => {
    const hello = new Router();
    hello.add("GET", "/world", () => new Response("hi"));

    const api = new Router();
    api.mount("/hello", hello);

    const app = new Router();
    app.mount("/api", api);

    // route is flattened all the way to /api/hello/world under one config
    assertEquals(app.getRoutes(), [
      {
        method: "GET",
        path: "/api/hello/world",
      },
    ]);

    const res = await app.handle(
      new Request("http://x/api/hello/world"),
      "/api/hello/world",
    );
    assertEquals(res.status, 200);
    assertEquals(await res.text(), "hi");
  },
);

Deno.test(
  "mount is eager: routes added after mount are NOT captured",
  async () => {
    const api = new Router();
    const app = new Router({});
    app.mount("/api", api);
    api.add("GET", "/late", () => new Response("x")); // added AFTER mount

    const res = await app.handle(new Request("http://x/api/late"), "/api/late");
    assertEquals(res.status, 404);
  },
);

Deno.test(
  "multi-file style: leaf populated, then mounted up the chain",
  async () => {
    // simulates hello.ts -> api.ts -> server.ts import ordering
    const hello = new Router();
    hello.add("GET", "/world", () => new Response("hi"));

    const api = new Router();
    api.mount("/hello", hello); // hello already populated

    const app = new Router({});
    app.mount("/api", api); // api already contains /hello/world

    const res = await app.handle(
      new Request("http://x/api/hello/world"),
      "/api/hello/world",
    );
    assertEquals(await res.text(), "hi");
  },
);

Deno.test("single shared config: only the root instance holds config", () => {
  const app = new Router({ routerType: "array" });
  const api = new Router(); // no config
  api.add("GET", "/x", () => new Response("ok"));
  app.mount("/api", api);

  assertEquals(app.config.routerType, "array");
  // the mounted route lives on the single config-bearing instance
  assertEquals(app.getRoutes()[0].path, "/api/x");
});

/**
 * printRoutes()
 */

Deno.test("printRoutes handles empty router without throwing", () => {
  const r = new Router();
  // should not throw
  r.printRoutes();
});

Deno.test("printRoutes runs without throwing for mounted routes", () => {
  const app = new Router({});
  const api = new Router();
  api.add("GET", "/x", () => new Response("ok"));
  app.mount("/api", api);
  // should not throw and should include the prefixed path
  app.printRoutes();
});
