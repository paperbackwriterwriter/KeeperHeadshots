// Shared by the browser and the server. Backdrops and wardrobe are combined
// into "looks"; each look becomes one prompt for the image model.

export const BACKDROPS = [
  {
    id: "studio-gray",
    name: "Studio Gray",
    blurb: "Seamless gray paper, soft key light",
    prompt:
      "a seamless mid-grey paper backdrop with a soft, graduated glow behind the head that falls off smoothly to deep charcoal at the edges",
    light:
      "classic studio lighting: a large octabox as the key light, 45 degrees to camera-left and slightly above eye level; a white reflector camera-right for gentle fill (about a 2:1 ratio); a soft strip light behind the subject for a subtle rim on the hair and shoulders so they separate cleanly from the background",
    tones: ["#3b3f45", "#1d2025"],
  },
  {
    id: "glass-office",
    name: "Glass Office",
    blurb: "Bright modern office, creamy bokeh",
    prompt:
      "a bright, modern glass-walled office rendered as soft, creamy bokeh at f/2, with hints of windows, light and plants but nothing sharp or distracting and no legible text or logos",
    light:
      "soft, diffused window daylight from camera-left as the key, balanced with gentle fill so both sides of the face are well exposed; the background sits about one stop brighter than the face but keeps its detail and is never blown out",
    tones: ["#c9d3d6", "#8e9ea4"],
  },
  {
    id: "city-terrace",
    name: "City Terrace",
    blurb: "Rooftop, golden hour skyline",
    prompt:
      "an outdoor rooftop terrace at golden hour, with a city skyline far behind, softly out of focus",
    light:
      "the low sun behind and to one side of the subject as a warm rim light on the hair and shoulders, while a large diffused reflector lights the face evenly from the front; the face is correctly exposed and the sky keeps its warm colour and detail (never blown out to white)",
    tones: ["#e0b98a", "#8a6a55"],
  },
  {
    id: "library",
    name: "Library",
    blurb: "Warm wood and bookshelves",
    prompt:
      "a warm, wood-panelled library with bookshelves softly out of focus and a table lamp glowing in the background",
    light:
      "soft window light from camera-left as the key with warm tungsten practicals in the background; rich but natural colour, with no orange cast on the skin",
    tones: ["#7a5a42", "#3a2a20"],
  },
  {
    id: "studio-white",
    name: "Studio White",
    blurb: "Clean high-key, crisp and bright",
    prompt:
      "a clean, bright white seamless studio backdrop, evenly lit to a pure white-to-very-light-grey, with no visible edges or props",
    light:
      "high-key clamshell lighting: a large beauty dish or octabox slightly above the face and a reflector below for soft, even, flattering light with minimal shadows; crisp and airy",
    tones: ["#f4f2ee", "#d9d6d0"],
  },
  {
    id: "botanical",
    name: "Botanical",
    blurb: "Soft greenery, natural light",
    prompt:
      "lush green foliage and plants softly out of focus, fresh and natural",
    light:
      "open-shade natural light with a soft reflector for fill; natural skin tones with no green colour cast on the face",
    tones: ["#9bb08c", "#4d6446"],
  },
];

export const OUTFITS = [
  { id: "navy-suit", name: "Navy Suit", prompt: "a tailored navy wool suit jacket with notch lapels over a crisp white dress shirt with the collar open (no tie); fitted shoulders and a clean, wrinkle-free drape", colors: ["#1c2a44", "#f3f1ec"] },
  { id: "charcoal-blazer", name: "Charcoal Blazer", prompt: "a tailored charcoal wool blazer with a fine visible weave over a light-blue open-collar dress shirt; sharp shoulders, symmetrical collar", colors: ["#34373c", "#bcd0e2"] },
  { id: "white-shirt", name: "Crisp White Shirt", prompt: "a crisp, well-pressed white button-up dress shirt with the top button open and a structured collar; no jacket", colors: ["#f1efea", "#f1efea"] },
  { id: "black-turtleneck", name: "Black Turtleneck", prompt: "a fitted fine-gauge black merino turtleneck with a smooth, even texture", colors: ["#151619", "#151619"] },
  { id: "camel-knit", name: "Camel Knit", prompt: "a soft camel-coloured fine-knit crew-neck sweater with a crisp white shirt collar showing at the neckline", colors: ["#b88a5a", "#f1efea"] },
  { id: "oxford", name: "Smart Casual", prompt: "a light-blue oxford button-down shirt with a navy crew-neck sweater layered over it, collar points neat and symmetrical", colors: ["#26324d", "#b8cbe3"] },
  { id: "suit-tie", name: "Suit & Tie", prompt: "a tailored charcoal wool suit with a crisp white dress shirt and a conservative silk tie in deep navy, neatly knotted and centred; sharp shoulders, pressed lapels and a clean, formal finish", colors: ["#2e3136", "#1c2a44"] },
  { id: "white-coat", name: "White Coat", prompt: "a crisp, well-fitted white physician's lab coat, clean and pressed, worn open over a light-blue collared dress shirt; no name badge, embroidery, logos, pens or stethoscope", colors: ["#f4f4f1", "#bcd0e2"] },
  { id: "scrubs", name: "Medical Scrubs", prompt: "clean, well-fitted navy-blue medical scrubs with a V-neck top; no name badge, embroidery, logos or stethoscope", colors: ["#23324f", "#23324f"] },
];

// The flow caps a single shoot so every run finishes in a few minutes.
export const MAX_LOOKS = 4;
export const TAKES_PER_LOOK = 2;
export const MAX_SELFIES = 6;
export const MIN_SELFIES = 1;

// What each one-time package buys. A paid shoot allows MAX_LOOKS looks,
// TAKES_PER_LOOK takes each (8 headshots).
export const PACKAGES = [
  {
    id: "starter",
    name: "Starter",
    price: 29,
    shoots: 3,
    features: ["3 shoots", "Up to 24 headshots", "4 looks per shoot", "AI photo check & grading", "LinkedIn & Teams square crops"],
  },
  {
    id: "professional",
    name: "Professional",
    price: 39,
    shoots: 6,
    popular: true,
    features: ["6 shoots", "Up to 48 headshots", "4 looks per shoot", "AI photo check & grading", "LinkedIn & Teams square crops", "Our most popular package"],
  },
  {
    id: "executive",
    name: "Executive",
    price: 49,
    shoots: 12,
    features: ["12 shoots", "Up to 96 headshots", "4 looks per shoot", "AI photo check & grading", "LinkedIn & Teams square crops", "Best value per shoot", "Great for small teams"],
  },
];

export function lookFor(backdropId, outfitId) {
  const backdrop = BACKDROPS.find((b) => b.id === backdropId);
  const outfit = OUTFITS.find((o) => o.id === outfitId);
  if (!backdrop || !outfit) return null;
  return { id: `${backdrop.id}__${outfit.id}`, backdrop, outfit };
}

// How finished headshots download. Every headshot is always available in both
// shapes; this only sets the default for the download buttons.
export const PHOTO_FORMATS = [
  { id: "portrait", name: "Portrait 3:4", blurb: "Full-resolution, for websites, print, business cards and résumés" },
  { id: "square", name: "Square 1:1", blurb: "Framed for round profile photos on LinkedIn, Teams, Slack and social media" },
  { id: "both", name: "Both", blurb: "Each headshot as a portrait and a square" },
];
export const DEFAULT_PHOTO_FORMAT = "both";
export const photoFormat = (id) => (PHOTO_FORMATS.some((f) => f.id === id) ? id : DEFAULT_PHOTO_FORMAT);
