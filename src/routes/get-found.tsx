import { createFileRoute, redirect } from "@tanstack/react-router";

// The waitlist form that opened a mail client is gone (docs/vision.md, phase 1). Sign-in with a short
// onboarding replaces it in phase 2. Old links land on the home page rather than a 404.
export const Route = createFileRoute("/get-found")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});
