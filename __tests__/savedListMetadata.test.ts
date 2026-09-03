import { beforeEach, describe, expect, it } from "vitest";

import { generateMetadata } from "@/app/u/[handle]/lists/[listType]/page";
import { __resetMemoryProfiles } from "@/lib/profileStore";
import {
  __resetMemorySavedListFollows,
  __resetMemorySavedPubs,
  savedListFollowsStore,
  savedPubsStore,
} from "@/lib/savedPubsStore";
import { getVenueIndex } from "@/lib/venueIndex";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryProfiles();
  __resetMemorySavedPubs();
  __resetMemorySavedListFollows();
});

async function venueIds(count: number): Promise<string[]> {
  const index = await getVenueIndex();
  return [...index.keys()].slice(0, count);
}

describe("saved-list detail metadata", () => {
  it("publishes an attributed social preview with saved/follower counts and list cover", async () => {
    const [first, second] = await venueIds(2);
    await savedPubsStore().toggleSaved({
      handle: "Sam",
      venueId: first,
      listType: "my locals",
    });
    await savedPubsStore().toggleSaved({
      handle: "sam",
      venueId: second,
      listType: "my locals",
    });
    await savedListFollowsStore().followList("ken", "sam", "my locals");

    const metadata = await generateMetadata({
      params: Promise.resolve({ handle: "Sam", listType: "my%20locals" }),
    });

    expect(metadata.title).toBe("@sam's my locals");
    expect(metadata.description).toBe(
      "@sam's my locals saved list on PUBMAXXING. 2 venues, 1 follower.",
    );
    expect(metadata.openGraph).toMatchObject({
      title: "@sam's my locals",
      description: "@sam's my locals saved list on PUBMAXXING. 2 venues, 1 follower.",
      type: "article",
      url: "/u/sam/lists/my%20locals",
      images: [
        {
          url: "/api/list-card?owner=sam&list=my+locals&venues=2&followers=1",
          width: 1200,
          height: 630,
          alt: "@sam's my locals saved list",
        },
      ],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: "@sam's my locals",
      description: "@sam's my locals saved list on PUBMAXXING. 2 venues, 1 follower.",
      images: ["/api/list-card?owner=sam&list=my+locals&venues=2&followers=1"],
    });
  });
});
