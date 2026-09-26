// Shared by the browser and the server. Backdrops and wardrobe are combined
// into "looks"; each look becomes one prompt for the image model.

export const BACKDROPS = [
  {
    id: "studio-gray",
    name: "Studio Gray",
    blurb: "Seamless charcoal paper, soft key light",
    prompt:
      "a seamless mid-charcoal studio paper backdrop with a gentle radial falloff behind the head, classic three-point studio lighting with a large soft key light from camera left",
    tones: ["#3b3f45", "#1d2025"],
  },
  {
    id: "glass-office",
    name: "Glass Office",
    blurb: "Bright modern office, creamy bokeh",
    prompt:
      "a bright modern glass-walled office, heavily out of focus with creamy bokeh, daylight from large windows, shallow depth of field at f/2",
    tones: ["#c9d3d6", "#8e9ea4"],
  },
  {
    id: "city-terrace",
    name: "City Terrace",
    blurb: "Rooftop, golden hour skyline",
    prompt:
      "an outdoor city rooftop terrace at golden hour, softly blurred skyline behind, warm natural backlight with a subtle rim on the hair",
    tones: ["#e0b98a", "#8a6a55"],
  },
  {
    id: "library",
    name: "Library",
    blurb: "Warm wood and bookshelves",
    prompt:
      "a warm wood-panelled library with softly blurred bookshelves, tungsten ambient light balanced with a soft window key",
    tones: ["#7a5a42", "#3a2a20"],
  },
  {
    id: "studio-white",
    name: "Studio White",
    blurb: "Clean high-key, crisp and bright",
    prompt:
      "a clean high-key white studio backdrop, bright even lighting, crisp and airy, the kind used for corporate team pages",
    tones: ["#f4f2ee", "#d9d6d0"],
  },
  {
    id: "botanical",
    name: "Botanical",
    blurb: "Soft greenery, natural light",
    prompt:
      "a softly blurred background of lush green foliage and plants, diffuse natural light, calm and fresh",
    tones: ["#9bb08c", "#4d6446"],
  },
];

export const OUTFITS = [
  { id: "navy-suit", name: "Navy Suit", prompt: "a tailored navy suit jacket over a crisp white dress shirt", colors: ["#1c2a44", "#f3f1ec"] },
  { id: "charcoal-blazer", name: "Charcoal Blazer", prompt: "a charcoal wool blazer over a light blue open-collar shirt", colors: ["#34373c", "#bcd0e2"] },
  { id: "white-shirt", name: "Crisp White Shirt", prompt: "a crisp, well-pressed white button-up shirt, top button open", colors: ["#f1efea", "#f1efea"] },
  { id: "black-turtleneck", name: "Black Turtleneck", prompt: "a fine-knit black turtleneck", colors: ["#151619", "#151619"] },
  { id: "camel-knit", name: "Camel Knit", prompt: "a soft camel-coloured knit sweater over a white collared shirt", colors: ["#b88a5a", "#f1efea"] },
  { id: "oxford", name: "Smart Casual", prompt: "a light blue oxford shirt with a navy crew-neck sweater layered over it", colors: ["#26324d", "#b8cbe3"] },
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
    features: ["3 shoots", "Up to 24 headshots", "4 looks per shoot", "AI photo check & grading"],
  },
  {
    id: "professional",
    name: "Professional",
    price: 39,
    shoots: 6,
    popular: true,
    features: ["6 shoots", "Up to 48 headshots", "4 looks per shoot", "AI photo check & grading", "Best value per shoot"],
  },
  {
    id: "executive",
    name: "Executive",
    price: 49,
    shoots: 12,
    features: ["12 shoots", "Up to 96 headshots", "4 looks per shoot", "AI photo check & grading", "Great for small teams"],
  },
];

export function lookFor(backdropId, outfitId) {
  const backdrop = BACKDROPS.find((b) => b.id === backdropId);
  const outfit = OUTFITS.find((o) => o.id === outfitId);
  if (!backdrop || !outfit) return null;
  return { id: `${backdrop.id}__${outfit.id}`, backdrop, outfit };
}
