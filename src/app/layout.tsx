import type { Metadata } from "next";
import "./globals.css";
import { ChromeProvider, ContentSlot, BottomSlot } from "@/contexts/chrome-context";
import { SessionProvider } from "@/contexts/session-context";
import { TopBarChrome } from "@/components/top-bar-chrome";

export const metadata: Metadata = {
  title: "RunKit",
  description: "Web-based agent orchestration dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="h-screen antialiased">
        <ChromeProvider>
          <SessionProvider>
            <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-2 focus:bg-bg-primary focus:text-text-primary">
              Skip to content
            </a>
            <div className="flex flex-col" style={{ height: 'var(--app-height, 100vh)' }}>
              {/* Top chrome — fixed height, shrink-0 */}
              <div className="shrink-0">
                <div className="max-w-4xl mx-auto w-full px-6">
                  <TopBarChrome />
                </div>
              </div>

              {/* Content — flex-1, scrollable (overflow controlled by fullbleed) */}
              <ContentSlot>{children}</ContentSlot>

              {/* Bottom slot — shrink-0, rendered by future changes via context */}
              <BottomSlot />
            </div>
          </SessionProvider>
        </ChromeProvider>
      </body>
    </html>
  );
}
