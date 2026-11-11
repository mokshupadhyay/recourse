import { describeError } from "./claude";

// Wraps a route handler so failures come back as JSON the dashboard can show.
export function handle(fn: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      return await fn(request);
    } catch (error) {
      console.error(error);
      return Response.json({ error: describeError(error) }, { status: 500 });
    }
  };
}
