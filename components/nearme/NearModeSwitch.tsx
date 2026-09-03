"use client";

import { NEAR_MODES, type NearMode } from "@/lib/nearDesk";

import "./nearModeSwitch.css";

const LABELS: Record<NearMode, string> = {
  pint: "Pint",
  desk: "Desk",
};

export default function NearModeSwitch({
  value,
  onChange,
}: {
  value: NearMode;
  onChange: (mode: NearMode) => void;
}) {
  return (
    <div className="nearModeSwitch">
      {/* A radiogroup, not a tablist: a tab owes an associated tabpanel, and
          the answer below is rendered by NearMeNow, which this wave may not
          edit. Two exclusive choices with roving focus is what a radiogroup
          already means. */}
      <div
        className="nearModeSwitchList"
        role="radiogroup"
        aria-label="Near mode"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
          const current = tabs.indexOf(event.target as HTMLButtonElement);
          if (current < 0) return;
          const nextIndex = event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
          event.preventDefault();
          tabs[nextIndex]?.focus();
          tabs[nextIndex]?.click();
        }}
      >
        {NEAR_MODES.map((mode) => {
          const selected = mode === value;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              className="nearModeSwitchTab"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(mode)}
            >
              {LABELS[mode]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
