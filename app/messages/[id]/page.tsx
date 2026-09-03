import type { Metadata } from "next";

import MessageThread from "@/components/messages/MessageThread";
import SiteNav from "@/components/nav/SiteNav";

import MessagesInboxClient from "../MessagesInboxClient";

import "../messages.css";

// A single conversation's thread (PRD E4). Thin SERVER shell: it owns the page
// metadata and unwraps the route id, then hands it to the client MessageThread,
// which owns the fetch + realtime/polling + composer. The thread reads the
// viewer's self-asserted handle and refetches through the participant-gated API,
// so a non-participant hitting this URL sees a friendly "not found" (never
// another pair's messages) — see the courtesy note in lib/messages.ts +
// migration 0019.
//
// A direct-message thread is private to its two participants, so it is noindex,
// follow:false. The metadata carries NO conversation content — only the static
// "Messages" title — so nothing about the thread can leak into a preview.
export const metadata: Metadata = {
  title: "Messages",
  description: "A private PUBMAXX conversation.",
  robots: { index: false, follow: false },
};

export default async function MessageThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  return (
    <div className="lp messagesPage">
      <SiteNav />
      <main id="main" className="container messagesMain messagesMainThread">
        <div className="messagesSplit">
          <aside className="messagesInboxPane" aria-label="Inbox">
            <MessagesInboxClient activeConversationId={id} />
          </aside>
          <section className="messagesThreadPane" aria-label="Conversation">
            <MessageThread conversationId={id} />
          </section>
        </div>
      </main>
    </div>
  );
}
