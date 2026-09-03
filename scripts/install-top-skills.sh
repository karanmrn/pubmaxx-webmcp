#!/usr/bin/env bash
# Reinstall top Agent Skills for Cursor (global). Safe to re-run.
set -euo pipefail
REPOS=(
  mvanhorn/last30days-skill
  vercel-labs/skills
  vercel-labs/agent-skills
  vercel-labs/agent-browser
  anthropics/skills
  openai/skills
  supabase/agent-skills
  mattpocock/skills
  obra/superpowers
  leonxlnx/taste-skill
  remotion-dev/skills
  pbakaus/impeccable
  shadcn/ui
  firecrawl/cli
  get-convex/agent-skills
  scrapegraphai/just-scrape
  posthog/skills
  posthog/ai-plugin
  clerk/skills
  prisma/skills
)
for repo in "${REPOS[@]}"; do
  echo "==> $repo"
  npx --yes skills add "$repo" -g -a cursor --skill '*' -y
done
npx --yes skills update -g -y
echo "Installed $(ls "$HOME/.agents/skills" | wc -l) skills"
