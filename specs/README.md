# Feature specs

A feature gets a checked-in spec only when it crosses one of two bars:

- **Ambiguity:** multiple materially different implementations are possible,
  and a human should choose between them.
- **Complexity:** the change is more than a few hundred lines.

When either bar is met, add both files under `specs/<feature>/` in the same PR:

- `PRODUCT.md` describes user-visible behaviour, states, boundaries, and copy.
- `TECH.md` describes architecture shape, ownership boundaries, interfaces, and
  the test plan.

Keep each file focused on its own question. Record honest empty, loading,
offline, error, and permission states where they affect the feature. Tie each
technical choice to a product promise or a testable boundary.

Small fixes never get specs. Use the issue, PR description, and tests for those
changes. Do not create a speculative spec folder for work that has not crossed
the bar.
