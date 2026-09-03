"use client";

import { PASSWORD_HINT, passwordRuleResults } from "@/lib/passwordPolicy";

import "./passwordPolicyHint.css";

type PasswordPolicyHintProps = {
  /** What the person has typed so far. */
  value: string;
  /** Wired to the field's `aria-describedby`, so the rules are read with it. */
  id?: string;
};

/**
 * The rules under a password field.
 *
 * BEFORE anybody types it is one hint sentence, so the policy is something you
 * read rather than something you fail. From the first character it becomes the
 * same rules as ticks. Both come from `lib/passwordPolicy.ts`, so the promise
 * and the check can never drift apart.
 */
export default function PasswordPolicyHint({
  value,
  id,
}: PasswordPolicyHintProps): React.JSX.Element {
  const rules = passwordRuleResults(value);

  return (
    <div className="passwordPolicyHint" id={id}>
      {value.length === 0 ? (
        <p>{PASSWORD_HINT}</p>
      ) : (
        <ul className="passwordPolicyRules">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className={rule.met ? "isMet" : undefined}
              data-rule={rule.id}
              data-met={rule.met ? "yes" : "no"}
            >
              <span aria-hidden="true">{rule.met ? "✓" : "•"}</span>
              <span>{rule.label}</span>
              <span className="srOnly">{rule.met ? " done" : " not yet"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
