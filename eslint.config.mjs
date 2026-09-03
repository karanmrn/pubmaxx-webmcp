import tsParser from "@typescript-eslint/parser";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      // Claude stores complete (including detached) Git worktrees beneath the
      // checkout. They are independent branches, never source owned by this
      // tree, and must not be allowed to fail this tree's lint gate.
      ".claude/worktrees/",
      ".context/**",
      ".firecrawl/**",
      // Scout verification bundles contain vendored build output, not app source.
      ".scout/**",
      ".next/**",
      ".next-*/**",
      ".vercel/**",
      "node_modules/**",
      "coverage/**",
      "public/data/**",
      // Copied from the pinned MapLibre package by predev/prebuild.
      "public/vendor/maplibre/**",
      "data/**",
      // Vendored agent/design skill packs — not app source; upstream uses require() etc.
      "skills/**",
      // Skill-pack reference assets - not app code.
      ".agents/**",
      // Generated verification artifacts — never hand-authored source.
      "test-results/**",
      "playwright-report/**",
      // Local co-dev scratch probes (also gitignored); not part of the app.
      "scratch-*.mjs",
      // Ephemeral local debug captures; not part of the app.
      ".tmp-evidence/**",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
  {
    // eslint-plugin-react still auto-detects React via the removed ESLint 10
    // RuleContext.getFilename() API (jsx-eslint/eslint-plugin-react#3977). Pin
    // the version so detect never runs. Drop once that plugin declares eslint 10.
    settings: {
      react: {
        version: "19",
      },
    },
  },
  {
    // eslint-config-next still parses JS/MJS with a Babel scope manager that
    // lacks ScopeManager#addGlobals (vercel/next.js#89764). Use the TS parser
    // for those extensions only; leave typescript-eslint's TS config alone.
    files: ["**/*.{js,mjs,cjs,jsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  {
    // Code-quality signal, not a build gate. Keeping complexity as a warning
    // surfaces new sprawl without blocking existing code. Ratchet the threshold
    // down as functions get refactored.
    rules: {
      complexity: ["warn", 35],
    },
  },
];

export default eslintConfig;
