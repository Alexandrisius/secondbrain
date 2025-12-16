import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeManager } from "@/components/ThemeManager";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "NeuroCanvas - The Generative Second Brain",
  description: "Infinite canvas for chaining AI prompts visually. Build your thinking interface.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var storage = localStorage.getItem('secondbrain-settings');
                  var theme = 'dark';
                  if (storage) {
                    var parsed = JSON.parse(storage);
                    if (parsed.state && parsed.state.theme) {
                      theme = parsed.state.theme;
                    }
                  }
                  
                  var isDark = theme === 'dark';
                  if (theme === 'system') {
                    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  }
                  
                  if (isDark) {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch (e) {
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeManager />
        {children}
      </body>
    </html>
  );
}
