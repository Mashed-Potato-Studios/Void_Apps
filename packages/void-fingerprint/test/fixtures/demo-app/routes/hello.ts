import { db } from "void/db";
export default { fetch() { return new Response(String(env.DB)); } };
