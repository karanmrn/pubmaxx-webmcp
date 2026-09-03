import { useCallback, useRef, useState } from "react";

import type { TabKey } from "@/lib/venueInspectorTabs";

type TabDef = { key: TabKey; label: string; shortLabel: string };

export function useInspectorTabs(
  initialTab: TabKey,
  venueId: string,
  TABS: TabDef[],
  onTabSelect?: (key: TabKey) => void,
) {
  // Active tab is local state (Pints is the primary content, so the default).
  // Like presence above, the panel isn't remounted between venues, so a stale
  // tab could linger — React's adjust-state-during-render pattern resets it when
  // the venue id changes (mirrors presenceVenueId). NEVER setState in an effect
  // here (react-hooks/set-state-in-effect is an error in this repo).
  const [tab, setTab] = useState<TabKey>(initialTab);
  const tabKey = `${venueId}:${initialTab}`;
  const [tabResetKey, setTabResetKey] = useState(tabKey);
  if (tabResetKey !== tabKey) {
    setTabResetKey(tabKey);
    setTab(initialTab);
  }

  // Refs to the tab buttons so arrow keys can move focus as selection moves
  // (roving tabindex / APG tabs pattern).
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    overview: null,
    photos: null,
    pints: null,
    menu: null,
    story: null,
    ask: null,
    "getting-home": null,
  });

  const selectTab = useCallback(
    (next: TabKey) => {
      setTab(next);
      onTabSelect?.(next);
      tabRefs.current[next]?.focus();
    },
    [onTabSelect],
  );

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, current: TabKey) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = TABS.findIndex((t) => t.key === current);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + delta + TABS.length) % TABS.length;
    selectTab(TABS[nextIndex].key);
  }

  return { tab, selectTab, onTabKeyDown, tabRefs };
}
