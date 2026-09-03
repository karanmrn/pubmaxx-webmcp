import { redirect } from "next/navigation";

/** Alias for /login so old and spoken "sign in" links land on one page. */
export default function SignInAliasPage(): never {
  redirect("/login");
}
