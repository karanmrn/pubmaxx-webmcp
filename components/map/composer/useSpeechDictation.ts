import { useEffect, useRef, useState } from "react";
import { offlineOrMessage } from "@/lib/apiErrorMessage";

import {
  getSpeechRecognitionCtor,
  type SpeechRecognitionLike,
} from "@/lib/pintDropSpeech";
import type { PintDropsState } from "@/components/map/usePintDrops";

type UseSpeechDictationArgs = {
  note: string;
  setDropForm: PintDropsState["setDropForm"];
  onTranscript: (typedBaseline: string) => void;
};

type UseSpeechDictationResult = {
  speechSupported: boolean;
  listening: boolean;
  error: string;
  toggleListening: () => void;
};

/**
 * Voice-to-text (issue #24): feature-detected, hidden entirely when the
 * browser has no Web Speech API. Reports a failed start so typing remains an
 * honest fallback.
 */
export function useSpeechDictation({
  note,
  setDropForm,
  onTranscript,
}: UseSpeechDictationArgs): UseSpeechDictationResult {
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const noteBeforeListeningRef = useRef("");

  useEffect(() => {
    // Async wrapper so the setState lands in a microtask after hydration —
    // the server render (no window) and first client paint agree, then the
    // mic button appears. Mirrors the feed page's handle-read idiom.
    let active = true;
    async function detectSpeech() {
      const supported = getSpeechRecognitionCtor() !== null;
      if (active) setSpeechSupported(supported);
    }
    void detectSpeech();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // Stop any in-flight recognition on unmount (venue switch/composer close).
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  function startListening() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return; // Feature-detected away — button isn't rendered anyway.
    setError("");
    try {
      const recognition = new Ctor();
      recognition.lang = "en-GB";
      recognition.interimResults = true;
      recognition.continuous = true;
      noteBeforeListeningRef.current = note;
      recognition.onresult = (event) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          transcript += event.results[i]["0"].transcript;
        }
        const base = noteBeforeListeningRef.current;
        const joined = base.trim() ? `${base.trim()} ${transcript}` : transcript;
        onTranscript(base);
        setDropForm((current) => ({ ...current, note: joined }));
      };
      recognition.onerror = () => {
        setListening(false);
        setError(
          offlineOrMessage("Could not start dictation. Try typing instead.")
        );
      };
      recognition.onend = () => {
        setListening(false);
      };
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
      setError(
        offlineOrMessage("Could not start dictation. Try typing instead.")
      );
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function toggleListening() {
    if (listening) stopListening();
    else startListening();
  }

  return { speechSupported, listening, error, toggleListening };
}
