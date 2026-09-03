import type { Metadata } from "next";

import SiteNav from "@/components/nav/SiteNav";

import MessagesInboxClient, { MessagesThreadEmptyCopy } from "./MessagesInboxClient";

import "./messages.css";

// Server shell for /messages so the route carries real metadata (the client
// component can't export it). Direct messages are private to the signed-in
// participant, so the inbox is noindex, follow:false.
export const metadata: Metadata = {
  title: "Messages",
  description: "Direct messages with the people you go out with. Signed-in only, and kept low-key.",
  robots: { index: false, follow: false },
};

export default function MessagesInboxPage(): React.JSX.Element {
  return (
    <div className="lp messagesPage">
      <SiteNav />
      <main id="main" className="container messagesMain messagesMainInbox">
        <div className="messagesSplit">
          <aside className="messagesInboxPane" aria-label="Inbox">
            <MessagesInboxClient />
          </aside>
          {/* The pane is neutral here on purpose: what it says depends on the
              viewer, and this page may not server-render per-account content. */}
          <section className="messagesThreadPane messagesThreadEmpty" aria-label="Conversation">
            <MessagesThreadEmptyCopy />
          </section>
        </div>
      </main>
    </div>
  );
}
