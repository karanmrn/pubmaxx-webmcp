"use client";

import { useEffect } from "react";

import { isNativeApp } from "@/lib/nativePlatform";
import { syncNativeSystemBars, type NativeTheme } from "@/lib/nativeSystemBars";

function activeTheme(): NativeTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Native-only, renderless bridge that follows the site's manual theme toggle. */
export default function NativeSystemBars(): null {
  useEffect(() => {
    if (!isNativeApp()) return;

    const apply = () => void syncNativeSystemBars(activeTheme());
    apply();

    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return null;
}
