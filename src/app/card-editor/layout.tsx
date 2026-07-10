import { Montserrat, Raleway, Oswald, Dancing_Script } from "next/font/google";

// These 4 font families are ONLY used here — as literal font-family names picked from the
// PropsPanel font dropdown and rendered onto the react-konva canvas (CardEditorClient.tsx). They
// used to load in the root layout, which meant every page on the site (album views, home, guest
// pages) paid for 4 extra render-critical font fetches that only this one owner-only tool needs.
// Scoping them to this route's own layout keeps them out of every other page's critical path.
const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"], display: "swap" });
const raleway = Raleway({ variable: "--font-raleway", subsets: ["latin"], display: "swap" });
const oswald = Oswald({ variable: "--font-oswald", subsets: ["latin"], display: "swap" });
const dancingScript = Dancing_Script({ variable: "--font-dancing", subsets: ["latin"], display: "swap" });

export default function CardEditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${montserrat.variable} ${raleway.variable} ${oswald.variable} ${dancingScript.variable} contents`}>
      {children}
    </div>
  );
}
