"use client";

// The Social Loop's top-level feed axis (Cycle 15 Lane C). "Your lot" shows
// mutual friends' drops + check-ins; "London" is the city-wide public feed.
// Nearby stays hidden until the feed has a real locality to apply. This is a
// re-composition over the same feed cards, not a new surface: it swaps the data
// source, while /feed owns the active tab and fetching.

export type SocialTab = "lot" | "nearby" | "london";

const TABS: { id: SocialTab; label: string; hint: string }[] = [
  { id: "lot", label: "Your lot", hint: "Friends' nights, chronological" },
  { id: "london", label: "London", hint: "The whole city" },
];

export default function SocialTabs({
  active,
  onChange,
}: {
  active: SocialTab;
  onChange: (tab: SocialTab) => void;
}) {
  return (
    <div className="feedSocialTabs" role="tablist" aria-label="Feed">
      {TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            title={tab.hint}
            className={`feedSocialTab${selected ? " isActive" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
