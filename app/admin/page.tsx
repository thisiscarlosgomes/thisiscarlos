import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  isOwnerSessionValueValid,
  VOICE_NOTES_OWNER_COOKIE,
} from "@/lib/voice-notes/auth";
import { BlogEditor } from "./post-editor";
export default async function AdminPage() {
  const jar = await cookies();
  if (!isOwnerSessionValueValid(jar.get(VOICE_NOTES_OWNER_COOKIE)?.value || ""))
    redirect("/lg?next=/admin");
  return <BlogEditor />;
}
