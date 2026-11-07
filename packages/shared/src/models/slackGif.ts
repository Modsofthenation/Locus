import { isPublicGifUrl, type SlackGifHit } from "./slack.js";

const POST_RENDITIONS = [
  "downsized",
  "downsized_medium",
  "downsized_large",
  "fixed_height",
  "original",
  "preview_gif",
] as const;

const PREVIEW_RENDITIONS = [
  "fixed_height_small",
  "fixed_height",
  "downsized",
  "preview_gif",
  "original",
] as const;

const TOKEN_ALIASES: Record<string, string[]> = {
  lol: ["laugh", "haha"],
  lmao: ["laugh", "lol"],
  haha: ["laugh", "lol"],
  doggo: ["dog"],
  puppy: ["dog"],
  kitty: ["cat"],
  k: ["ok", "thumbs"],
  yup: ["yes"],
  nope: ["no"],
  idk: ["shrug"],
  thx: ["thank"],
  ty: ["thank"],
  thanks: ["thank"],
};

type CatalogGif = SlackGifHit & { tags: string[] };

function gif(id: string, title: string, tags: string[]): CatalogGif {
  return {
    id,
    title,
    tags,
    url: `https://media.giphy.com/media/${id}/giphy.gif`,
    preview: `https://media.giphy.com/media/${id}/giphy.gif`,
  };
}

/** Curated fallback when no Giphy key is set, or live search returns nothing. */
export const GIF_CATALOG: CatalogGif[] = [
  gif("l0MYt5jPR6QX5pnqM", "Thumbs up", ["thumbs", "ok", "yes", "approve", "good"]),
  gif("26u4cqi2I30qjvdjk", "High five", ["highfive", "yes", "team", "celebrate"]),
  gif("111ebonMs90YLu", "Yes", ["yes", "nod", "agree", "yup"]),
  gif("YrLNhgOjtEtny", "No", ["no", "nope", "shake", "deny"]),
  gif("3oEjI6SIIHBdRiGnM6", "Wow", ["wow", "omg", "surprised"]),
  gif("xT5LMHxhOfsc4FAjlK", "Laughing", ["lol", "laugh", "haha", "lmao", "funny"]),
  gif("JIX9t2j0ZTN9S", "Cat typing", ["cat", "kitty", "typing", "coding", "work"]),
  gif("mlvseq9yvZhba", "Cat", ["cat", "kitty", "meow"]),
  gif("3o7aCTPPm4OHfRLSH6", "Dog", ["dog", "puppy", "doggo", "goodboy"]),
  gif("l3q2K5jinAlChoCLS", "This is fine", ["fine", "fire", "chaos", "incident"]),
  gif("13GIgrGdslD9oQ", "Mind blown", ["wow", "mind", "blown", "amazing"]),
  gif("5GoVLqeAOo6PK", "Dancing", ["dance", "party", "celebrate"]),
  gif("5xtDarE85P9RM5V0VqE", "Party", ["party", "parrot", "celebrate", "ship"]),
  gif("l0MYz3j1H5z0s5n3q", "Excited", ["party", "excited", "hype"]),
  gif("26ufnwz3wDUli7GU0", "Clapping", ["clap", "applause", "bravo", "nice"]),
  gif("YB86ZffUhRmve", "Love", ["love", "heart", "hearts"]),
  gif("26gsjCZp8K7eB5QQc", "Happy", ["happy", "smile", "joy"]),
  gif("26ufdipQqU2lhNA4g", "Sad", ["sad", "cry", "unhappy"]),
  gif("l0HlvtIPzOw2pEAFa", "Wave", ["wave", "hi", "hello", "hey"]),
  gif("l0MYEqvG6Gm5Qv2Lu", "Thank you", ["thank", "thanks", "thx", "ty"]),
  gif("26BRuo6sLetdllPAQ", "Shrug", ["shrug", "idk", "dunno", "whatever"]),
  gif("3o7TKSjRrfIHjcjsUw", "Waiting", ["wait", "waiting", "soon"]),
  gif("26u4lOMA8JKSnL9Uk", "Thinking", ["think", "hmm", "consider"]),
  gif("26n6WywJyh39n1sRy", "Confused", ["confused", "huh", "what"]),
  gif("26ufcV1pNmgKmtuwg", "Facepalm", ["facepalm", "fail", "oops", "sigh"]),
  gif("3oEjHCWdFjpJxSWdyE", "Cool", ["cool", "sunglasses", "nice"]),
  gif("l0MYC0LajbaPoEADu", "Sunglasses", ["cool", "sunglasses"]),
  gif("26tPplGWjN0xLybiU", "Fire", ["fire", "lit", "hot"]),
  gif("l4FGuhL4U2WyjdLLG", "Coding", ["code", "coding", "dev", "programming"]),
  gif("l0MYzbiiPeM7giqkw", "Popcorn", ["popcorn", "watching", "drama"]),
  gif("3o7aD2d7hy9MxyCqgU", "Coffee", ["coffee", "tea", "morning"]),
  gif("3oEduSbSGqQiNFf5nO", "Please", ["please", "beg", "ask"]),
  gif("3o7aCSPqNNrmN1Kfu8", "Cheers", ["cheers", "toast", "celebrate"]),
  gif("26gsjRAzvTRG5I87C", "Hi", ["hi", "hello", "wave"]),
  gif("11sJL2eikUmNhS", "Ship it", ["ship", "shipping", "deploy", "done"]),
];

export function isPostableGifUrl(url: string): boolean {
  if (!isPublicGifUrl(url)) return false;
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (/\.mp4$/i.test(path) || /\.webp$/i.test(path)) return false;
    if (/\.(gif|png|jpe?g)$/i.test(path)) return true;
    const host = new URL(url).hostname.toLowerCase();
    return host === "giphy.com" || host.endsWith(".giphy.com") || host.endsWith(".tenor.com");
  } catch {
    return false;
  }
}

function renditionUrl(
  images: Record<string, unknown>,
  keys: readonly string[],
  allow: (url: string) => boolean,
): string | undefined {
  for (const key of keys) {
    const raw = images[key];
    if (!raw || typeof raw !== "object") continue;
    const url = (raw as { url?: unknown }).url;
    if (typeof url === "string" && allow(url)) return url;
  }
  return undefined;
}

export function parseGiphyHit(raw: unknown): SlackGifHit | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : undefined;
  const title = typeof value.title === "string" && value.title.trim() ? value.title.trim() : "GIF";
  const images =
    value.images && typeof value.images === "object"
      ? (value.images as Record<string, unknown>)
      : {};
  const url = renditionUrl(images, POST_RENDITIONS, isPostableGifUrl);
  if (!id || !url) return undefined;
  const preview = renditionUrl(images, PREVIEW_RENDITIONS, isPostableGifUrl) || url;
  return { id, title, url, preview };
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function tokenMatches(hayTokens: string[], needle: string): boolean {
  const options = [needle, ...(TOKEN_ALIASES[needle] ?? [])];
  return options.some((option) =>
    hayTokens.some((token) => token === option || token.startsWith(option)),
  );
}

export function searchGifCatalog(query: string): SlackGifHit[] {
  const needles = tokens(query);
  const matched = needles.length
    ? GIF_CATALOG.filter((row) => {
        const hay = tokens(`${row.title} ${row.tags.join(" ")}`);
        return needles.every((needle) => tokenMatches(hay, needle));
      })
    : GIF_CATALOG;
  return matched.map(({ id, title, url, preview }) => ({ id, title, url, preview }));
}
