/**
 * Auth.js owns the session: the CSRF token on the sign-in POST, and the
 * encrypted JWT cookie that carries the account id afterwards. It owns nothing
 * else. The account itself - the address, the hash, the rate limits - belongs
 * to lib/server/credentials.ts, which is why there is no Auth.js adapter here
 * and why `authorize` is three lines.
 *
 * The cookie carries an account id and the profile fields Auth.js puts in a
 * token on its own (name and email). The password and its hash are not in the
 * token, not in the session, and not in what `authorize` returns.
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyPassword } from "@/lib/server/credentials";
import { checkAuthConfig, providers } from "@/lib/server/session";
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  checkAuthConfig();
  return {
    providers: providers().includes("credentials") ? [Credentials({
      credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" } },
      // Auth.js reports every failure here as the same CredentialsSignin, which
      // is what we want: the form must not learn whether the address exists.
      authorize: async (credentials, request) => await verifyPassword(credentials?.email, credentials?.password, request),
    })] : [],
    session: { strategy: "jwt" },
    callbacks: {
      async jwt({ token, user }) {
        if (user?.id) token.sub = user.id;
        return token;
      },
      session({ session, token }) { if (session.user && token.sub) session.user.id = token.sub; return session; },
    },
  };
});
