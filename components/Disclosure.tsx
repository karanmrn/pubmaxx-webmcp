import type { ReactNode } from "react";

import "./disclosure.css";

type DisclosureProps = {
  summary: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
};

function classNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export default function Disclosure({
  summary,
  children,
  className,
  bodyClassName,
}: DisclosureProps) {
  return (
    <details className={classNames("contentDisclosure", className)}>
      <summary>{summary}</summary>
      {children ? (
        <div className={classNames("contentDisclosureBody", bodyClassName)}>
          {children}
        </div>
      ) : null}
    </details>
  );
}

export function ProseDisclosure({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <Disclosure
      className={classNames("proseDisclosure", className)}
      summary={
        <>
          <span className="proseDisclosureText">{text}</span>
          <span className="proseDisclosureMore">Show more</span>
          <span className="proseDisclosureLess">Show less</span>
        </>
      }
    />
  );
}
