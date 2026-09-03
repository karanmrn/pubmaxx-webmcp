"use client";

import Image from "next/image";
import { useState } from "react";

import { avatarInitialFromHandle } from "@/lib/profiles";
import { useReconnectRecovery } from "@/lib/useReconnectRecovery";

type HandleAvatarProps = {
  handle: string;
  avatarUrl?: string | null;
  displayName?: string;
  className?: string;
  imageClassName?: string;
  size?: number;
};

/**
 * Handle-backed avatar with initials fallback on missing, hidden, or broken images.
 */
export default function HandleAvatar({
  handle,
  avatarUrl,
  displayName,
  className,
  imageClassName,
  size = 40,
}: HandleAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initial = avatarInitialFromHandle(handle, displayName);
  const showImage = Boolean(avatarUrl) && failedUrl !== avatarUrl;

  useReconnectRecovery(
    Boolean(avatarUrl) && failedUrl === avatarUrl,
    () => setFailedUrl(null),
  );

  if (showImage) {
    return (
      <Image
        key={avatarUrl}
        className={imageClassName ?? className}
        src={avatarUrl!}
        alt=""
        width={size}
        height={size}
        unoptimized
        onError={() => setFailedUrl(avatarUrl ?? null)}
      />
    );
  }

  // `size` is the IMAGE's box and nothing else. The initials fallback wears the
  // consumer's own class, so its stylesheet owns the circle - an inline width
  // here would beat every one of them, including the profile hero's responsive
  // clamp and the feed row's 36px.
  return (
    <span className={className} aria-hidden="true">
      {initial}
    </span>
  );
}
