import { analyticsCollectionAllowed } from "@/lib/analytics";
import { initializePosthog } from "@/lib/posthogClient";

initializePosthog(analyticsCollectionAllowed());
