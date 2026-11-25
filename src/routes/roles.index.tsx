import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /roles moved to / on 6 Oct 2026. This keeps every link that was already sent working.
 *
 * Three briefings, the welcome email and the lemlist follow-up all point at /roles, some of them at
 * /roles?industry=... , so the filters have to survive the hop. Everything in the query string is
 * passed through untouched rather than validated here, because this route's only job is to forward;
 * the front page is what decides which parameters mean anything.
 */
export const Route = createFileRoute("/roles/")({
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/", search, replace: true });
  },
});
