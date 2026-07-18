import { vi } from "vitest";

export class RedirectSignal extends Error {
  constructor(public url: string) {
    super(`REDIRECT:${url}`);
    this.name = "RedirectSignal";
  }
}

export class NotFoundSignal extends Error {
  constructor() {
    super("NOT_FOUND");
    this.name = "NotFoundSignal";
  }
}

type CookieValue = { value: string };
const cookieStore = new Map<string, CookieValue>();

export const fakeCookies = {
  get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name)!.value } : undefined),
  set: (name: string, value: string) => {
    cookieStore.set(name, { value });
  },
  delete: (name: string) => {
    cookieStore.delete(name);
  },
  has: (name: string) => cookieStore.has(name),
};

/** Call between tests so one test's simulated login doesn't leak into the next. */
export function resetFakeCookies() {
  cookieStore.clear();
}

vi.mock("next/headers", () => ({
  cookies: async () => fakeCookies,
  headers: async () => new Headers(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  notFound: () => {
    throw new NotFoundSignal();
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

vi.mock("server-only", () => ({}));
