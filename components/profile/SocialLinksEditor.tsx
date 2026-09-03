"use client";

import { FormEvent, useEffect, useState } from "react";

import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import {
  SOCIAL_OAUTH_PROVIDERS,
  SOCIAL_PROVIDERS,
  socialProviderLabel,
  socialProviderMark,
  socialProviderPlaceholder,
  type PublicSocialConnection,
  type SocialProvider,
} from "@/lib/socialConnections";
import { type SocialProviderCapabilities } from "@/lib/socialProviderCapabilities";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";

type LoadState = "loading" | "ready" | "unavailable";

const NO_SOCIAL_PROVIDERS = Object.fromEntries(
  SOCIAL_PROVIDERS.map((provider) => [provider, {
    manual_link: false,
    oauth_identity: false,
    read_selected_content: false,
    publish: false,
  }]),
) as Record<SocialProvider, SocialProviderCapabilities>;

/**
 * OAuth buttons for certified providers. Environment keys cannot make an
 * uncertified provider action visible.
 */
export function SocialConnectionActions({
  providers,
  onConnect,
}: {
  providers: Record<SocialProvider, SocialProviderCapabilities>;
  onConnect: (provider: SocialProvider) => void;
}): React.JSX.Element | null {
  const available = SOCIAL_OAUTH_PROVIDERS.filter(
    (provider) => providers[provider].oauth_identity,
  );
  if (available.length === 0) return null;
  return (
    <div className="socialLinksOauth">
      {available.map((provider) => (
        <button type="button" key={provider} onClick={() => onConnect(provider)}>
          Connect {socialProviderLabel(provider)}
        </button>
      ))}
    </div>
  );
}

/**
 * The owner's own link rows. Each one is a public handle they typed in and can
 * remove in one tap, so this editor writes straight through to the public card
 * on /u/[handle] with nothing in between.
 */
export default function SocialLinksEditor(): React.JSX.Element | null {
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const [connections, setConnections] = useState<PublicSocialConnection[]>([]);
  const [providers, setProviders] = useState<Record<SocialProvider, SocialProviderCapabilities>>(
    NO_SOCIAL_PROVIDERS,
  );
  const [state, setState] = useState<LoadState>("loading");
  const [provider, setProvider] = useState<SocialProvider>("instagram");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  // Bumped after every write, so the list a person sees is always the list the
  // server holds rather than an optimistic guess about what it accepted.
  const [loadNonce, setLoadNonce] = useState(0);

  useEffect(() => {
    if (!socialFriendsLaunchEnabled) return;
    const controller = new AbortController();
    async function load() {
      const response = await authedActionFetch("/api/social-connections", {
        signal: controller.signal,
      }).catch(() => null);
      if (controller.signal.aborted) return;
      if (!response?.ok) {
        setState("unavailable");
        return;
      }
      const body = (await response.json().catch(() => null)) as {
        connections?: PublicSocialConnection[];
        providers?: Record<SocialProvider, SocialProviderCapabilities>;
      } | null;
      if (controller.signal.aborted) return;
      setConnections(body?.connections ?? []);
      setProviders(body?.providers ?? NO_SOCIAL_PROVIDERS);
      setState("ready");
    }
    void load();
    return () => controller.abort();
  }, [loadNonce, socialFriendsLaunchEnabled]);

  async function addLink(event: FormEvent) {
    event.preventDefault();
    if (!socialFriendsLaunchEnabled || busy || !value.trim() || !providers[provider].manual_link) return;
    setBusy(true);
    setNotice("");
    const response = await authedActionFetch(`/api/social-connections/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "manual", value }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { error?: unknown } | null;
    if (response?.ok) {
      setValue("");
      setNotice(`${socialProviderLabel(provider)} added.`);
      setLoadNonce((nonce) => nonce + 1);
    } else {
      setNotice(errorMessageFrom(body, "That link could not be saved. Try again."));
    }
    setBusy(false);
  }

  async function connectOAuth(target: SocialProvider) {
    if (!socialFriendsLaunchEnabled || busy) return;
    setBusy(true);
    setNotice("");
    const response = await authedActionFetch(`/api/social-connections/${target}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "oauth" }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as {
      authorizeUrl?: string;
      error?: unknown;
    } | null;
    if (response?.ok && body?.authorizeUrl) {
      window.location.assign(body.authorizeUrl);
      return;
    }
    setNotice(errorMessageFrom(body, "That connection is unavailable."));
    setBusy(false);
  }

  async function removeLink(target: SocialProvider) {
    if (!socialFriendsLaunchEnabled || busy) return;
    setBusy(true);
    setNotice("");
    const response = await authedActionFetch(`/api/social-connections/${target}`, {
      method: "DELETE",
    }).catch(() => null);
    if (response?.ok) {
      setNotice(`${socialProviderLabel(target)} removed.`);
      setLoadNonce((nonce) => nonce + 1);
    } else {
      setNotice("That link could not be removed. Try again.");
    }
    setBusy(false);
  }

  if (!socialFriendsLaunchEnabled) return null;

  const linked = connections.filter((connection) => connection.profileUrl);
  const linkedProviders = new Set(linked.map((connection) => connection.provider));

  return (
    <section className="socialLinks" aria-labelledby="social-links-title">
      <h3 id="social-links-title" className="socialLinksTitle">
        Link your socials
      </h3>
      <p className="socialLinksLede">Add the accounts you want people to find you on.</p>

      <SocialConnectionActions
        providers={providers}
        onConnect={(target) => void connectOAuth(target)}
      />

      {state === "unavailable" ? (
        <p className="socialLinksNote" role="status">
          Your links could not be loaded. Try again in a moment.
        </p>
      ) : null}

      {linked.length ? (
        <ul className="socialLinksList">
          {linked.map((connection) => (
            <li key={connection.provider} className="socialLinksRow">
              <span className="socialLinksMark" aria-hidden="true">
                {socialProviderMark(connection.provider)}
              </span>
              <span className="socialLinksRowText">
                <span className="socialLinksRowLabel">
                  {socialProviderLabel(connection.provider)}
                </span>
                <a
                  className="socialLinksRowHandle"
                  href={connection.profileUrl}
                  target="_blank"
                  rel="me noopener noreferrer"
                >
                  {connection.username ?? connection.profileUrl}
                </a>
              </span>
              <button
                type="button"
                className="socialLinksRemove"
                onClick={() => void removeLink(connection.provider)}
                disabled={busy}
                aria-label={`Remove ${socialProviderLabel(connection.provider)}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form className="socialLinksForm" onSubmit={addLink}>
        <label className="socialLinksField">
          <span className="socialLinksFieldLabel">Service</span>
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value as SocialProvider)}
            disabled={busy}
          >
            {SOCIAL_PROVIDERS.map((option) => (
              <option
                key={option}
                value={option}
                disabled={!providers[option].manual_link}
              >
                {socialProviderLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <label className="socialLinksField socialLinksFieldWide">
          <span className="socialLinksFieldLabel">Username or link</span>
          <input
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={socialProviderPlaceholder(provider)}
            autoComplete="off"
            spellCheck={false}
            maxLength={300}
            disabled={busy}
          />
        </label>
        <button
          type="submit"
          className="socialLinksAdd"
          disabled={busy || !value.trim() || !providers[provider].manual_link}
        >
          {linkedProviders.has(provider) ? "Replace" : "Add"}
        </button>
      </form>

      {notice ? (
        <p className="socialLinksNote" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
