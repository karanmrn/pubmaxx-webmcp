import type { Metadata } from "next";

import CityChooser from "@/components/city/CityChooser";
import { firstSearchParam } from "@/lib/cityShare";

type ChooseCityPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = {
  title: "Choose your city",
  description:
    "Pick your PUBMAXXING city map: London, Manchester, Glasgow, and more. Listed pint prices, crawls, and the last way home.",
  alternates: { canonical: "/choose-city" },
};

export default async function ChooseCityPage({
  searchParams,
}: ChooseCityPageProps) {
  const sp = searchParams ? await searchParams : undefined;
  const focusSearch = firstSearchParam(sp?.focus) === "search";
  return <CityChooser variant="page" focusSearch={focusSearch} />;
}
