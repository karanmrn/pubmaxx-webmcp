import type { Metadata } from "next";

import SiteNav from "@/components/nav/SiteNav";
import WebMcpNightBoard from "@/components/webmcp/WebMcpNightBoard";

import "./webmcp.css";

export const metadata: Metadata = {
  title: "Agent Night Board · PUBMAXX",
  description: "Build one grounded London Crawl Route with a person and a browser agent.",
  alternates: { canonical: "/webmcp" },
};

export default function WebMcpPage() {
  return (
    <main id="main" className="webmcpPage">
      <SiteNav />
      <WebMcpNightBoard />
    </main>
  );
}
