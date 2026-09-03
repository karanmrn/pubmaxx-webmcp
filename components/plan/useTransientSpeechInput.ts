"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

import { useEffect, useRef, useState } from "react";

import { getSpeechRecognitionCtor, type SpeechRecognitionLike } from "@/lib/pintDropSpeech";

/** Browser dictation for a transient field. Audio and transcripts never leave component state. */
export function useTransientSpeechInput(value: string, onChange: (value: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");

  useEffect(() => {
    queueMicrotask(() => setSupported(getSpeechRecognitionCtor() !== null));
    return () => recognitionRef.current?.stop();
  }, []);

  function stop() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }

  function toggle() {
    if (listening) {
      stop();
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    setError("");
    try {
      const recognition = new Ctor();
      recognition.lang = "en-GB";
      recognition.interimResults = true;
      recognition.continuous = true;
      baseRef.current = value.trim();
      recognition.onresult = (event) => {
        let transcript = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          transcript += event.results[index]["0"].transcript;
        }
        onChange([baseRef.current, transcript.trim()].filter(Boolean).join(" "));
      };
      recognition.onerror = () => {
        stop();
        setError(
          offlineOrMessage("Could not start dictation. Try typing instead.")
        );
      };
      recognition.onend = stop;
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch {
      stop();
      setError(
        offlineOrMessage("Could not start dictation. Try typing instead.")
      );
    }
  }

  return { supported, listening, error, toggle };
}
