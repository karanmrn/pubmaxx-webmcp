import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const IconButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size = "icon", variant = "secondary", ...props }, ref) => (
    <Button ref={ref} size={size} variant={variant} className={cn("shrink-0 rounded-[var(--radius-pill)]", className)} {...props} />
  ),
);
IconButton.displayName = "IconButton";
