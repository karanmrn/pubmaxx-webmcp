import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import VisitReportPanel, {
  VISIT_REPORT_PEEK_LIMIT,
  visitReportComposerMode,
  visitReportEmptyCopy,
  visitReportPeekAffordanceLabel,
  visitReportsForPanel,
} from "@/components/visits/VisitReportPanel";
import type { VisitReportDTO } from "@/lib/visitReports";

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  session: null as { access_token: string; user: { id: string } } | null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: authState.user,
    session: authState.session,
  }),
}));

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

function reportStub(id: string): VisitReportDTO {
  return {
    id,
    venueId: "venue-1",
    handle: `drinker-${id}`,
    visitedAt: "2026-08-01",
    createdAt: "2026-08-01T12:00:00.000Z",
    busyness: null,
    noise: null,
    seating: null,
    serviceWait: null,
    note: `Account ${id}`,
  };
}

describe("Visit Report venue surface", () => {
  it("closes authoring fields when an open composer loses its account", () => {
    expect(visitReportComposerMode(true, "account-1")).toBe("open");
    expect(visitReportComposerMode(true, null)).toBe("sign_in_required");
  });

  it("keeps Visit Report drafts account-scoped and rejects expired sessions", () => {
    const panel = source("components/visits/VisitReportPanel.tsx");

    expect(panel).toContain("useAccountScopedDraft");
    expect(panel).toContain("accountComposerAuth");
    expect(panel).toContain("rejectedContributionAuth");
    expect(panel).not.toContain("setRejectedAuth");
  });

  it("asks a signed-out visitor to sign in before mounting any report fields", () => {
    authState.user = null;
    authState.session = null;

    const html = renderToStaticMarkup(
      createElement(VisitReportPanel, {
        venueId: "venue-1",
        venueName: "The Crown",
      }),
    );

    expect(html).toContain("Sign in to contribute");
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain("<textarea");
  });

  it("ships one dated, bounded composer and individual report actions", () => {
    const panel = source("components/visits/VisitReportPanel.tsx");
    const client = source("components/visits/visitReportsClient.ts");

    expect(panel).toContain('type="date"');
    expect(panel).toContain("MAX_VISIT_NOTE");
    expect(panel).toContain("read.reports");
    expect(panel).toContain("reportVisitReport");
    expect(panel).toContain("visitedAt");
    expect(panel).not.toContain("VisitReportSummary");
    expect(panel).not.toContain("summary");
    expect(panel).not.toContain("visitReportHandle");
    expect(client).not.toContain("handle: string");
  });

  it("mirrors the server's visit window in the composer rather than inventing one", () => {
    const panel = source("components/visits/VisitReportPanel.tsx");

    // Both ends of the date input come from the domain core, so the card can
    // never offer a night the route will refuse.
    expect(panel).toContain("earliestVisitedAt");
    expect(panel).toContain("latestVisitedAt");
    expect(panel).toContain("min={earliest}");
    expect(panel).toContain("max={latest}");
    expect(panel).toContain("MAX_VISIT_AGE_DAYS");
  });

  it("keeps a hidden visit report restorable from the moderator surface", () => {
    const admin = source("app/admin/AdminClient.tsx");

    // Hiding never deletes, so the surface that hides a row also lists it back.
    expect(admin).toContain("/api/visit-reports?status=hidden");
    expect(admin).toContain("Hidden visit reports");
    expect(admin).toMatch(/decideVisitReport\(v, "restore", "hidden"\)/);
  });

  it("mounts the shared lane in the map venue sheet", () => {
    const storyTab = source("components/map/inspector/VenueStoryTab.tsx");

    expect(storyTab).toContain(
      'import VisitReportPanel from "@/components/visits/VisitReportPanel"',
    );
    expect(storyTab).toContain("<VisitReportPanel");
  });

  it("keeps the full composer on Lore and a read-only peek on Overview", () => {
    const storyTab = source("components/map/inspector/VenueStoryTab.tsx");
    const overview = source("components/map/inspector/VenueOverviewTab.tsx");
    const inspector = source("components/map/VenueInspector.tsx");

    expect(overview).toContain('mode="peek"');
    expect(overview).toContain("onOpenFull={onOpenVisitReports}");
    expect(overview).toMatch(
      /<VisitReportPanel[\s\S]*active=\{tab === "overview"\}/,
    );
    expect(storyTab).not.toContain('mode="peek"');
    expect(storyTab).toMatch(
      /<VisitReportPanel[\s\S]*active=\{tab === "story"\}/,
    );
    expect(inspector).toContain('onOpenVisitReports={() => selectTab("story")}');
  });

  it("limits the Overview peek to the newest one or two accounts", () => {
    const reports = [
      reportStub("a"),
      reportStub("b"),
      reportStub("c"),
    ];

    expect(VISIT_REPORT_PEEK_LIMIT).toBe(2);
    expect(visitReportsForPanel(reports, "peek")).toEqual(reports.slice(0, 2));
    expect(visitReportsForPanel(reports, "full")).toEqual(reports);
  });

  it("never collapses a failed peek read into an empty visits claim", () => {
    expect(visitReportEmptyCopy("ready")).toBe(
      "No visits have been written up here yet.",
    );
    expect(visitReportEmptyCopy("degraded")).toBe(
      "We couldn't check the visit notes here just now.",
    );
    expect(visitReportEmptyCopy("degraded")).not.toMatch(/no visits/i);
    expect(visitReportPeekAffordanceLabel({ status: "degraded", reports: [] })).toBe(
      "Open Lore",
    );
    expect(visitReportPeekAffordanceLabel({ status: "ready", reports: [] })).toBe(
      "Write yours on Lore",
    );
    expect(
      visitReportPeekAffordanceLabel({
        status: "ready",
        reports: [reportStub("a")],
      }),
    ).toBe("More on Lore");
  });

  it("keeps the Overview peek free of the composer fields", () => {
    authState.user = null;
    authState.session = null;

    const html = renderToStaticMarkup(
      createElement(VisitReportPanel, {
        venueId: "venue-1",
        venueName: "The Crown",
        mode: "peek",
        onOpenFull: () => {},
      }),
    );

    expect(html).toContain("visitReportPanel--peek");
    expect(html).toContain("Open Lore");
    expect(html).not.toContain("Sign in to contribute");
    expect(html).not.toContain("Write yours");
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain("<textarea");
  });

  it("defers the venue read to the opened tab without unmounting the composer", () => {
    const storyTab = source("components/map/inspector/VenueStoryTab.tsx");
    const panel = source("components/visits/VisitReportPanel.tsx");

    // A tab gate that UNMOUNTS discards a half-written account when the viewer
    // steps over to another tab, so the story tab passes the gate as a prop.
    expect(storyTab).toMatch(
      /<VisitReportPanel[\s\S]*active=\{tab === "story"\}/,
    );
    expect(storyTab).not.toMatch(/tab === "story" \? \(\s*<VisitReportPanel/);
    // Peek and full are separate instances; refetch whenever the tab becomes
    // active again so Lore writes do not leave Overview stale.
    expect(panel).toContain("if (!active) return;");
    expect(panel).not.toContain("requested.current");
    expect(panel).toMatch(/\}, \[active, venueId\]/);
  });

  it("keeps all interactive controls thumb-sized at phone width", () => {
    const css = source("components/visits/visitReports.css");

    expect(css).toMatch(/\.visitChip[\s\S]*min-height:\s*44px/);
    expect(css).toMatch(/\.visitReportSubmit[\s\S]*min-height:\s*44px/);
    expect(css).toMatch(/\.visitReportFlag[\s\S]*min-height:\s*44px/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("does not place a venue star score beside a visit account", () => {
    const ledger = source("app/ledger/[id]/page.tsx");
    const barTab = source("app/bar-tab/[id]/page.tsx");
    const discover = source("app/discover/DiscoverPageClient.tsx");

    expect(ledger).not.toContain("VenueRatingPanel");
    expect(barTab).not.toContain("VenueRatingPanel");
    expect(discover).not.toContain("TopRatedPubs");
  });
});
