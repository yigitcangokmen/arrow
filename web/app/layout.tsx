import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Footer } from "../components/Footer.tsx";
import { Nav } from "../components/Nav.tsx";
import "./tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arrow",
  description:
    "Inspect before you pay: the buyer's AI reads the sealed data inside a TEE, and only a capped verdict (≤5.67 bits on the output channel) comes back to the buyer.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Runs before the page is painted: ?theme=light|dark, then localStorage["arrow-theme"], else the system setting.
const THEME_SCRIPT = `(function(){try{var t=new URLSearchParams(location.search).get("theme");if(t!=="light"&&t!=="dark"){try{t=localStorage.getItem("arrow-theme")}catch(e){t=null}}if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <Nav />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
