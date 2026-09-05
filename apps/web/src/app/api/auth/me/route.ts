import { NextResponse } from "next/server";
import { getSessionUserId } from "@/server/auth";
import { prisma } from "@/server/db";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ user: null });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ user: null });

  return NextResponse.json({ user: { id: user.id, name: user.name, avatarUrl: user.avatarUrl } });
}
