/**
 * Auth.js owns OAuth, CSRF and encrypted JWT cookies. The repository owns only
 * the engineer's profile, so adding another persistence backend does not require
 * an Auth.js adapter. Provider-account ids are stable and namespaced; matching
 * email addresses never silently link identities across providers.
 */
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { repo } from "@/lib/server/repo";
import { checkAuthConfig, providers } from "@/lib/server/session";
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  checkAuthConfig();
  const enabled = providers();
  return {
    providers: [ ...(enabled.includes("github") ? [GitHub] : []), ...(enabled.includes("google") ? [Google] : []) ],
    session: { strategy: "jwt" },
    callbacks: {
      async jwt({ token, account, user }) {
        if (account && user) {
          const id = `${account.provider}:${account.providerAccountId}`;
          await repo().users.upsert({ id, email: user.email, name: user.name ?? "Engineer", image: user.image });
          token.sub = id;
        }
        return token;
      },
      session({ session, token }) { if (session.user && token.sub) session.user.id = token.sub; return session; },
    },
  };
});
