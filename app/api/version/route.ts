import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function currentDeploymentId(): string | null {
  const deploymentId =
    process.env.NEXT_DEPLOYMENT_ID ??
    process.env.VERCEL_DEPLOYMENT_ID ??
    process.env.NEXT_PUBLIC_SW_VERSION;
  return typeof deploymentId === "string" && deploymentId ? deploymentId : null;
}

export function GET(): NextResponse {
  return NextResponse.json(
    { deploymentId: currentDeploymentId() },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "CDN-Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": "no-store",
      },
    },
  );
}
