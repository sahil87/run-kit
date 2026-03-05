import type { Metadata } from "next";
import "./globals.css";
import { ChromeProvider, BottomSlot } from "@/contexts/chrome-context";
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
          <div className="h-screen flex flex-col">
            {/* Top chrome — fixed height, shrink-0 */}
            <div className="shrink-0">
              <div className="max-w-4xl mx-auto w-full px-6">
                <TopBarChrome />
              </div>
            </div>

            {/* Content — flex-1, scrollable */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="max-w-4xl mx-auto w-full px-6 min-h-full flex flex-col">
                {children}
              </div>
            </div>

            {/* Bottom slot — shrink-0, rendered by future changes via context */}
            <BottomSlot />
          </div>
        </ChromeProvider>
      </body>
    </html>
  );
}
