import {
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
} from "@tanstack/react-router";
import { ChromeProvider, ContentSlot, BottomSlot } from "@/contexts/chrome-context";
import { SessionProvider } from "@/contexts/session-context";
import { TopBarChrome } from "@/components/top-bar-chrome";
import { Dashboard } from "@/pages/dashboard";
import { Project } from "@/pages/project";
import { Terminal } from "@/pages/terminal";

const rootRoute = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <ChromeProvider>
      <SessionProvider>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-2 focus:bg-bg-primary focus:text-text-primary"
        >
          Skip to content
        </a>
        <div className="app-shell flex flex-col" style={{ height: "var(--app-height, 100vh)" }}>
          <div className="shrink-0">
            <div className="max-w-4xl mx-auto w-full px-3 sm:px-6">
              <TopBarChrome />
            </div>
          </div>
          <ContentSlot>
            <Outlet />
          </ContentSlot>
          <BottomSlot />
        </div>
      </SessionProvider>
    </ChromeProvider>
  );
}

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Dashboard,
});

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$project",
  component: Project,
});

const terminalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$project/$window",
  component: Terminal,
  validateSearch: (search: Record<string, unknown>) => ({
    name: (search.name as string) || undefined,
  }),
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  projectRoute,
  terminalRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
