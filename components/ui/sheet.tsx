import type * as React from "react";
import MobileSharedSheet from "@/components/mobile/MobileSharedSheet";

export type SheetProps = React.ComponentProps<typeof MobileSharedSheet>;

export function Sheet(props: SheetProps) {
  return <MobileSharedSheet {...props} />;
}
