import type { Metadata } from "next";
import { Suspense } from "react";

import MomentCapture from "@/components/moment/MomentCapture";
import "@/components/moment/moment.css";

export const metadata: Metadata = {
  title: "Save a Moment",
  description: "Keep a private PUBMAXX Moment, then decide if it belongs in a Story.",
};

export default function MomentPage(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <main id="main" className="momentPage" aria-busy="true" aria-label="Loading Moment composer">
          <div className="momentMain">
            <div className="momentSkeleton" aria-hidden="true">
              <span className="momentSkeletonEyebrow" />
              <span className="momentSkeletonTitle" />
              <span className="momentSkeletonCanvas" />
              <span className="momentSkeletonRow" />
            </div>
          </div>
        </main>
      }
    >
      <MomentCapture />
    </Suspense>
  );
}
