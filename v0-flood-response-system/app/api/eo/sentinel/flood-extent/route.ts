import { NextRequest, NextResponse } from "next/server";
import { getFloodExtentGeoJSON } from "../sentinel-logic";

export async function GET(req: NextRequest) {
  const timestamp = req.nextUrl.searchParams.get("timestamp");
  const result = getFloodExtentGeoJSON(timestamp);
  if (!result) {
    return NextResponse.json({ error: "No data available" }, { status: 404 });
  }
  return NextResponse.json(result);
}
