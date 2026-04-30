import { SKILLS } from "@/lib/skills";

export async function GET() {
  return Response.json({ skills: SKILLS });
}
