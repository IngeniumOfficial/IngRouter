export type Context = Record<string, unknown>;

export type Method =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "OPTIONS"
  | "HEAD";

export type Middleware = (
  req: Request,
  ctx: Context,
  next: () => Promise<Response>,
) => Promise<Response>;

export type Handler = (
  req: Request,
  ctx: Context,
) => Response | Promise<Response>;

export type RouterConfig = {
  routerType?: "array" | "map";
};

class Router {
  constructor(config?: RouterConfig) {
    this.config = { ...config, routerType: config?.routerType || "array" };
  }

  config: RouterConfig = {};

  private routes: Array<{
    method: Method;
    path: string;
    handler: Handler;
    middlewares: Middleware[];
    prefix?: string;
  }> = [];

  private routesMap: Map<{ method: Method; path: string }, Handler> = new Map();

  /**
   * Register a route with HTTP method, optional middlwares, and a handler.
   * Middlewares execute left-to-right, then handler.
   *
   * @param method HTTP method
   * @param path USE path to match
   * @param fns Middleware functions followed by a Handler as the last argument
   *
   * @example
   *   router.add("POST", "/schedule/create", authMw, jsonParser, createHandler);
   */

  add(method: Method, path: string, ...fns: Array<Middleware | Handler>): void {
    if (fns.length === 0) {
      throw new Error(`Route ${method} ${path} must have at least one handler`);
    }

    const handler = fns[fns.length - 1] as Handler;
    const middlewares = fns.slice(0, -1) as Middleware[];

    this.routes.push({ method, path, handler, middlewares });
  }

  async handle(req: Request, pathname: string): Promise<Response> {
    const method = req.method as Method;

    console.log(`[Router] Incoming request: ${method} ${pathname}`);
    console.log(`[Router] Routes count: ${this.routes.length}`);

    for (const { method: routeMethod, path, handler, middlewares } of this
      .routes) {
      // Match HTTP method first
      if (method !== routeMethod) continue;

      // Match path prefix
      if (pathname !== path) continue;

      // Extract remaining path after the matched prefix (if needed for wildcards)
      //   const relativePath = pathname.slice(path.length);
      const ctx: Context = {};

      let index = 0;
      const next = async (): Promise<Response> => {
        try {
          if (index < middlewares.length) {
            return await middlewares[index++](req, ctx, next);
          }
          return await handler(req, ctx);
        } catch (error) {
          console.error(`Ing Router: Route ${method} ${path} error:`, error);
          return new Response("Ing Router: Internal Server Error", {
            status: 500,
          });
        }
      };

      return await next();
    }

    return new Response("Ing Router: Not Found", { status: 404 });
  }

  /**
   * Handle mounting
   */
  mount(prefix: string, sub: Router): void {
    for (const r of sub.routes) {
      // Strip trailing slash
      const base = prefix.replace(/\/+$/, "");

      // Strip leading slash of path
      const p = r.path.replace(/^\/+/, "");
      this.routes.push({
        ...r,
        path: base + "/" + p,
        prefix,
      });
    }
  }

  /**
   * Get a copy of all registered routes.
   */
  getRoutes(): Array<{ method: Method; path: string }> {
    return this.routes.map(({ method, path }) => ({ method, path }));
  }

  /**
   * Print all registered routes to stdout in a formatted table.
   */
  printRoutes(): void {
    const routes = this.getRoutes();
    if (routes.length === 0) {
      console.log("No routes registered.");
      return;
    }

    const maxMethodWidth = Math.max(...routes.map((r) => r.method.length), 6);
    const maxPathWidth = Math.max(...routes.map((r) => r.path.length), 20);

    const separator = "-".repeat(maxMethodWidth + maxPathWidth + 7);

    console.log("\n\x1b[1m Registered API Routes:\x1b[0m");
    console.log(separator);
    console.log(
      `\x1b[1m${"METHOD".padEnd(maxMethodWidth)}\x1b[0m  \x1b[1m${"PATH".padEnd(maxPathWidth)}\x1b[0m`,
    );

    for (const { method, path } of routes) {
      console.log(
        `${method.padEnd(maxMethodWidth)}  ${path.padEnd(maxPathWidth)}`,
      );
    }

    console.log(separator);
    console.log(`Total: ${routes.length} route(s)\n`);
  }
}

export default Router;
