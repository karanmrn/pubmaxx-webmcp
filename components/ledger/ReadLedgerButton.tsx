"use client";

import { useCallback, useEffect, useState } from "react";

import "./readLedgerButton.css";

// The Ledger's voice affordance (issue #25): "Read this page" for the
// Boomer/Gen-X reading surface, using the Web Speech API's speechSynthesis —
// no new dependency. Feature-detected: on a browser/runtime without
// speechSynthesis this renders nothing at all, never a dead button.
//
// React 19 hygiene: speaking state is only ever set from event handlers
// (click, and the utterance's onend/onerror callbacks), never from an effect
// body, so this stays clear of react-hooks/set-state-in-effect.

type ReadLedgerButtonProps = {
  // The full text to read aloud — composed server-side by the page (venue
  // name, heritage note, latest entries) so this component stays a dumb,
  // reusable "speak this string" control.
  text: string;
};

export default function ReadLedgerButton({ text }: ReadLedgerButtonProps) {
  // Hydrate as "unsupported" (matching the server's null render), then enable
  // after mount if the browser has speechSynthesis. This avoids a text mismatch
  // on server-rendered Ledger pages.
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setSupported("speechSynthesis" in window);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleRead = useCallback(() => {
    if (!supported || !text.trim()) return;
    setError("");
    try {
      window.speechSynthesis.cancel(); // clear anything already queued
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => {
        setSpeaking(false);
        setError("Could not read this page. Try again.");
      };
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    } catch {
      setSpeaking(false);
      setError("Could not read this page. Try again.");
    }
  }, [supported, text]);

  const handleStop = useCallback(() => {
    if (!supported) return;
    try {
      window.speechSynthesis.cancel();
    } finally {
      setSpeaking(false);
    }
  }, [supported]);

  if (!supported) return null;

  return (
    <>
      <button
        type="button"
        className="ledgerReadButton"
        onClick={speaking ? handleStop : handleRead}
        aria-pressed={speaking}
      >
        {speaking ? "Stop reading" : "Read this page"}
      </button>
      {error ? <p role="status">{error}</p> : null}
    </>
  );
}
