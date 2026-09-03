import type { Metadata } from "next";

import PlanComposer from "@/components/plan/PlanComposer";
import SiteNav from "@/components/nav/SiteNav";

import "./plan.css";

export const metadata: Metadata = {
  title: "Sort the outing · PUBMAXXING",
  description: "Put the pubs in order, pick a time, and send one link to the crew.",
};

export default function NewPlanPage() {
  return (
    <main id="main" className="planPage planPage--composer">
      {/* Standard site navigation — /plan is a shared-link surface and must
          never be a dead end (the old masthead was a wordmark only). SiteNav
          carries the brand, so the masthead keeps just the context line. */}
      <SiteNav />
      <header className="planPage__masthead">
        <span>Sort the outing</span>
        <span>London · Tonight</span>
      </header>
      <section className="planPage__intro">
        <p className="planPage__eyebrow">One link for the whole group.</p>
        <h1>Describe the outing. We’ll put it in order.</h1>
        <p>Get three to six useful stops, change anything you don&rsquo;t fancy, then send one plan the whole crew can open without an account.</p>
      </section>
      <PlanComposer />
    </main>
  );
}
