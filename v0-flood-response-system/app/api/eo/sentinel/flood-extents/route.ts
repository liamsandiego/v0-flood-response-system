import { NextResponse } from "next/server";
import { getAllFloodExtents } from "../sentinel-logic";

export async function GET() {
  const extents = getAllFloodExtents();
  return NextResponse.json(extents);
}
