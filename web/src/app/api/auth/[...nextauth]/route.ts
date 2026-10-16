/** Auth.js supplies its own CSRF-protected OAuth and account endpoints. */
import { handlers } from "@/auth";
export const runtime = "nodejs";
export const { GET, POST } = handlers;
