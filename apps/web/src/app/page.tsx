import { redirect } from "next/navigation";
import { getSessionUserId } from "@/server/auth";
import { SignInForm } from "./sign-in-form";

// A live session means the sign-in screen has nothing to offer: reloading "/"
// or opening it in a second tab should land in the app, not ask again. The
// check is server-side so the redirect happens before any HTML is sent,
// rather than as a flash of the wrong page.
export default async function Home() {
  if (await getSessionUserId()) redirect("/chat");
  return <SignInForm />;
}
