import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const { preparePlanGenerationMock } = vi.hoisted(() => ({
  preparePlanGenerationMock: vi.fn(async () => ({
    response: new Response(JSON.stringify({ delegated: true }), {
      status: 207,
      headers: { "content-type": "application/json" },
    }),
  })),
}));

vi.mock("@/lib/planGeneration.server", () => ({
  loadPlanGenerationBaselineWhatsOn: vi.fn(async () => []),
  preparePlanGeneration: preparePlanGenerationMock,
  runAnchoredGeneration: vi.fn(),
}));

import { POST } from "@/app/api/plans/generate/route";

it("delegates request preparation to the server orchestration boundary", async () => {
  const request = new Request("http://localhost/api/plans/generate", {
    method: "POST",
    body: "{}",
  });

  const response = await POST(request);

  expect(preparePlanGenerationMock).toHaveBeenCalledOnce();
  expect(response.status).toBe(207);
  expect(await response.json()).toEqual({ delegated: true });
});
