import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Analytics } from "@vercel/analytics/react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SiteFrame } from "@/components/SiteFrame";

// Both pages sit inside the site's own frame and type, rather than the generated centred card with rounded
// buttons they came with.
function NotFoundComponent() {
  return (
    <SiteFrame>
      <div className="mx-auto max-w-[1180px] px-6 py-20 sm:px-10 sm:py-28">
        <h1 className="font-display max-w-[16ch] text-[40px] leading-[1.02] tracking-[-0.02em] sm:text-[64px]">
          Nothing at this address.
        </h1>
        <p className="mt-5 max-w-[48ch] text-[16px] leading-relaxed text-muted-foreground">
          The page may have moved, or a role it pointed to has left the board.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Link
            to="/"
            className="tap inline-flex items-center border border-foreground px-6 text-[16px] transition-colors hover:bg-foreground hover:text-background"
          >
            See every live role
          </Link>
          <Link
            to="/"
            className="border-b border-foreground pb-[2px] text-[16px] hover:border-primary hover:text-primary"
          >
            Go home
          </Link>
        </div>
      </div>
    </SiteFrame>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <SiteFrame>
      <div className="mx-auto max-w-[1180px] px-6 py-20 sm:px-10 sm:py-28">
        <h1 className="font-display max-w-[16ch] text-[40px] leading-[1.02] tracking-[-0.02em] sm:text-[64px]">
          This page did not load.
        </h1>
        <p className="mt-5 max-w-[48ch] text-[16px] leading-relaxed text-muted-foreground">
          Something went wrong on our side. Trying again usually works.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          <button
            type="button"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="tap inline-flex items-center border border-foreground px-6 text-[16px] transition-colors hover:bg-foreground hover:text-background"
          >
            Try again
          </button>
          <a
            href="/"
            className="border-b border-foreground pb-[2px] text-[16px] hover:border-primary hover:text-primary"
          >
            Go home
          </a>
        </div>
      </div>
    </SiteFrame>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Forward Deployed" },
      {
        name: "description",
        content: "Forward deployed roles, filtered by the industry you already know.",
      },
      { property: "og:site_name", content: "Forward Deployed" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Instrument+Serif&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      // Our own mark, replacing the one that came with the generated project.
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { rel: "alternate icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        {/*
          Added 6 Oct 2026, at the same time the board became the front page, because that redesign
          was decided on judgement with no usage data at all: there was nothing measuring whether a
          visitor reached the roles, signed up, or left. Page views only, no cookie and no consent
          banner needed. It will say nothing useful for weeks at current traffic, which is the point:
          it is here so the version after this one is not another guess.
        */}
        <Analytics />
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
